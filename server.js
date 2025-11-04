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

// Google Sheet（新版 v5+ 寫法）
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, auth);

// 健康檢查
app.get('/', (req, res) => res.send('立發 3.2 活著！'));

// Webhook
app.post('/webhook', middleware({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_TOKEN
}), async (req, res) => {
  for (const event of req.body.events) {
    if (event.type === 'message' && event.message.text === '請假') await startLeave(event);
    if (event.type === 'postback') await handleApprove(event);
  }
  res.sendStatus(200);
});

// 開始請假
async function startLeave(event) {
  await doc.loadInfo(); // 這行一定要！
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

// 推卡片給主管
async function pushCard(rowNum, name) {
  const bubble = {
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

// 簽核
async function handleApprove(event) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['立發人資管理總表'];
  const rows = await sheet.getRows();
  const [action, num] = event.postback.data.split('=');
  const row = rows[Number(num) - 2];
  row.主管簽核 = action === 'ok' ? '核准' : '駁回';
  await row.save();
  await client.replyMessage(event.replyToken, { type: 'text', text: action === 'ok' ? '✅ 已核准' : '❌ 已駁回' });
}

// 拿 LINE ID
async function getIds(role) {
  await doc.loadInfo();
  const idSheet = doc.sheetsByTitle['LINE_ID對照表'];
  const rows = await idSheet.getRows();
  return rows.filter(r => r.get('角色') === role).map(r => r.get('LINE ID'));
}

app.listen(PORT, () => console.log(`立發 3.2 活在 ${PORT}`));
