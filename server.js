const express = require('express');
const line = require('@line/bot-sdk');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(config);

const pendingRequests = {};
const userStates = {};

const BUILTIN_SERVICE_ACCOUNT = { /* 你的 JSON */ };

async function getSheets() {
  let credentials = BUILTIN_SERVICE_ACCOUNT;
  const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (envJson && envJson.trim()) {
    try { credentials = JSON.parse(envJson); console.log("Using env JSON"); }
    catch (e) { console.warn("Invalid env JSON, using built-in"); }
  } else {
    console.log("Using built-in Service Account JSON");
  }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

app.post('/webhook', async (req, res) => {
  try {
    console.log("Webhook received:", req.body.events.length, "events");
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userId = event.source.userId;
  const text = event.message.text.trim();
  console.log("User input:", text, "State:", userStates[userId]?.step);

  if (text === '請假') {
    userStates[userId] = { step: 'startDate' };
    return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入開始日期 (YYYY-MM-DD)' });
  }

  const state = userStates[userId];
  if (!state) return;

  if (state.step === 'startDate') { state.startDate = text; state.step = 'endDate'; }
  else if (state.step === 'endDate') { state.endDate = text; state.step = 'type'; }
  else if (state.step === 'type') { state.type = text; state.step = 'reason'; }
  else if (state.step === 'reason') {
    state.reason = text;
    await submitLeaveRequest(event, userId, state);
    delete userStates[userId];
    return;
  }
  client.replyMessage(event.replyToken, { type: 'text', text: getNextPrompt(state.step) });
}

function getNextPrompt(step) {
  const p = { startDate: '請輸入結束日期', endDate: '請輸入假別', type: '請輸入請假原因' };
  return p[step] || '';
}

async function submitLeaveRequest(event, userId, state) {
  try {
    console.log("Submitting leave request for", userId);
    const sheets = await getSheets();
    const profile = await client.getProfile(userId);
    console.log("Profile:", profile.displayName);

    const row = [
      new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      profile.displayName,
      state.startDate,
      state.endDate,
      state.type,
      state.reason,
      '待審核'
    ];

    console.log("Appending row:", row);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: '1bB_8XUYpzZWRT0Sld0cXaovNpePayTy2rSGpAOqhxto',
      range: '請假紀錄!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    console.log("Sheet updated:", response.data.updates.updatedRange);

    const adminId = process.env.ADMIN_LINE_USER_ID;
    if (adminId) {
      await client.pushMessage(adminId, {
        type: 'text',
        text: `新請假申請\n${profile.displayName}\n${state.startDate} ~ ${state.endDate}\n假別：${state.type}\n原因：${state.reason}`
      });
      console.log("Admin notified:", adminId);
    }

    client.replyMessage(event.replyToken, { type: 'text', text: '已提交請假申請，等待主管審核！' });
  } catch (err) {
    console.error("Submit failed:", err.message);
    client.replyMessage(event.replyToken, { type: 'text', text: '提交失敗，請稍後再試。' });
  }
}

app.get('/', (req, res) => res.send('LINE 請假系統運行中'));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
