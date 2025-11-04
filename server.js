cat > server.js << 'EOF'
const express = require('express');
const line = require('@line/bot-sdk');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// LINE 設定
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(config);

// 暫存請假申請與 row index
const pendingRequests = {}; // { requestId: { userId, row, data } }

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

app.post('/webhook', async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error('Webhook error:', err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type === 'message' && event.message.type === 'text') {
    const userId = event.source.userId;
    const text = event.message.text.trim();

    if (text === '請假') {
      return startLeaveFlow(event, userId);
    }

    const state = getUserState(userId);
    if (state) {
      return handleLeaveStep(event, userId, text, state);
    }
  }

  // 處理按鈕回應
  if (event.type === 'postback') {
    return handlePostback(event);
  }
}

function getUserState(userId) {
  return userStates[userId];
}

const userStates = {};

function startLeaveFlow(event, userId) {
  userStates[userId] = { step: 'startDate' };
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '請輸入開始日期 (YYYY-MM-DD)',
  });
}

async function handleLeaveStep(event, userId, text, state) {
  if (state.step === 'startDate') {
    state.startDate = text;
    state.step = 'endDate';
    return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入結束日期 (YYYY-MM-DD)' });
  }
  if (state.step === 'endDate') {
    state.endDate = text;
    state.step = 'type';
    return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入假別 (事假/病假/公假...)' });
  }
  if (state.step === 'type') {
    state.type = text;
    state.step = 'reason';
    return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入請假原因' });
  }
  if (state.step === 'reason') {
    state.reason = text;
    await submitLeaveRequest(event, userId, state);
    delete userStates[userId];
  }
}

async function submitLeaveRequest(event, userId, state) {
  const sheets = await getSheets();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const profile = await client.getProfile(userId);

  const row = [
    new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    profile.displayName,
    state.startDate,
    state.endDate,
    state.type,
    state.reason,
    '待審核'
  ];

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: '請假紀錄!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  const rowIndex = response.data.updates.updatedRange.match(/A(\d+)/)[1];

  const requestId = `${userId}_${Date.now()}`;
  pendingRequests[requestId] = {
    userId,
    row: parseInt(rowIndex),
    data: { ...state, displayName: profile.displayName }
  };

  const adminId = process.env.ADMIN_LINE_USER_ID;
  if (adminId) {
    await client.pushMessage(adminId, {
      type: 'flex',
      altText: '新請假申請',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '新請假申請', weight: 'bold', size: 'xl' },
            { type: 'text', text: profile.displayName, margin: 'md' },
            { type: 'text', text: `${state.startDate} ~ ${state.endDate}` },
            { type: 'text', text: `假別：${state.type}` },
            { type: 'text', text: `原因：${state.reason}` },
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'postback',
                label: '核准',
                data: `action=approve&id=${requestId}`
              },
              style: 'primary',
              color: '#00B900'
            },
            {
              type: 'button',
              action: {
                type: 'postback',
                label: '駁回',
                data: `action=reject&id=${requestId}`
              },
              style: 'secondary',
              color: '#FF4B4B',
              margin: 'sm'
            }
          ]
        }
      }
    });
  }

  return client.replyMessage(event.replyToken, { type: 'text', text: '已提交請假申請，等待主管審核！' });
}

async function handlePostback(event) {
  const data = Object.fromEntries(event.postback.data.split('&').map(p => p.split('=')));
  const adminId = process.env.ADMIN_LINE_USER_ID;

  if (event.source.userId !== adminId) {
    return client.replyMessage(event.replyToken, { type: 'text', text: '你無權執行此操作。' });
  }

  const requestId = data.id;
  const request = pendingRequests[requestId];
  if (!request) return;

  const sheets = await getSheets();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const status = data.action === 'approve' ? '已核准' : '已駁回';

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `請假紀錄!G${request.row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });

  await client.pushMessage(request.userId, {
    type: 'text',
    text: `您的請假申請已${status}！\n${request.data.startDate} ~ ${request.data.endDate}\n假別：${request.data.type}`
  });

  delete pendingRequests[requestId];

  return client.replyMessage(event.replyToken, { type: 'text', text: `已${status} ${request.data.displayName} 的請假申請。` });
}

app.get('/', (req, res) => {
  res.send('LINE 請假系統運行中（含主管審核）');
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
EOF
