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

// 暫存使用者請假狀態
const userStates = {};

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

app.post('/webhook', async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook error:', err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userId = event.source.userId;
  const text = event.message.text.trim();

  if (text === '請假') {
    userStates[userId] = { step: 'startDate' };
    return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入開始日期 (YYYY-MM-DD)' });
  }

  const state = userStates[userId];
  if (!state) {
    return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入「請假」開始流程。' });
  }

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

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: '請假紀錄!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    const adminId = process.env.ADMIN_LINE_USER_ID;
    if (adminId) {
      await client.pushMessage(adminId, {
        type: 'text',
        text: `新請假申請\n${profile.displayName}\n${state.startDate} ~ ${state.endDate}\n假別：${state.type}\n原因：${state.reason}`,
      });
    }

    delete userStates[userId];
    return client.replyMessage(event.replyToken, { type: 'text', text: '已收到請假申請！' });
  }
}

app.get('/', (req, res) => {
  res.send('LINE 請假系統運行中');
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
EOF
