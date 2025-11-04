require('dotenv').config();
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// LINE
const client = new Client({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_TOKEN,
});

// Google Sheet
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').trim(),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, auth);

// 健康檢查（超重要！）
app.get('/', (req, res) => res.send('立發 3.3 活著！🚀'));

// Webhook（Verify 專用防呆）
app.post('/webhook', middleware({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_TOKEN
}), async (req, res) => {
  // ╔══ Verify 時的假事件，直接放行 ══
  if (req.body.events[0]?.replyToken === '00000000000000000000000000000000' ||
      req.body.events[0]?.replyToken === 'ffffffffffffffffffffffffffffffff') {
    return res.sendStatus(200);
  }
  // ╚═══════════════════════════════

  for (const event of req.body.events) {
    if (event.type === 'message' && event.message.text === '請假') await startLeave(event);
    if (event.type === 'postback') await handleApprove(event);
  }
  res.sendStatus(200);
});

// 開始請假
async function startLeave(event) {
  await doc.loadInfo();
  const profile = await client.getProfile(event.source.userId);
  const sheet = doc.sheetsByTitle['立發人資管理總表'];
  
  const addedRow = await sheet.addRow({
    提交時間: new Date().toLocaleString('zh-TW'),
    員工姓名: profile.displayName,
    LINE_ID: event.source.userId,
    類型: '請假',
    假別: '特休',
    開始時間: '2025/11/10 09:00',
    結束時間: '2025/11/10 17:00',
    時數: 7,
    原因: '參加婚禮',
    主管簽核: '待簽',
    HR簽核: '待簽'
  });

  await pushCard(addedRow.rowNumber, profile.displayName);
  await client.replyMessage(event.replyToken, { type: 'text', text: '✅ 已送出！主管收到卡片' });
}

// 推卡片
async function pushCard(rowNum, name) {
  const bubble = { /* 同之前，超美卡片 */ 
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '✨ 立發新假單', color: '#fff', weight: 'bold' }], backgroundColor: '#0066FF' },
    hero: { type: 'image', url: 'https://i.imgur.com/2nT3Y0b.png', size: 'full' },
    body: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: name, size: 'xl', weight: 'bold' },
      { type: 'text', text: '特休｜7 小時', color: '#666' },
      { type: 'separator', margin: 'lg' },
      { type: 'text', text: '11/10 09:00 ～ 17:00' },
      { type: 'text', text: '原因：參加婚禮' },
    ]},
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'button', style: 'primary', action: { type: 'postback', label: '✅ 核准', data: `ok=${rowNum}` }},
      { type: 'button', style: 'secondary', action: { type: 'postback', label: '❌ 駁回', data: `no=${rowNum}` }},
    ]}
  };
  const supervisors = await getIds('主管');
  for (const id of supervisors) {
    await client.pushMessage(id, { type: 'flex', altText: '新假單', contents: bubble });
  }
}

// 簽核 + 拿 ID 函式（不變）
async function handleApprove(event) { /* 同上 */ }
async function getIds(role) { /* 同上 */ }

app.listen(PORT, () => console.log(`立發 3.3 活在 ${PORT}`));
