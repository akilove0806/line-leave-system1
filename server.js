require('dotenv').config();
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
const PORT = process.env.PORT || 3000;

// LINE 設定
const lineConfig = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_TOKEN,
};
const client = new Client(lineConfig);

// Google Sheet 設定
const SHEET_ID = process.env.SHEET_ID;
const doc = new GoogleSpreadsheet(SHEET_ID);
async function initSheet() {
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
}
initSheet();

// 讓 Render 知道健康
app.get('/', (req, res) => res.send('立發 3.0 活著！'));

// Webhook
app.post('/webhook', middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.text === '請假') {
      await startLeaveFlow(event);
    }
    if (event.type === 'postback') {
      await handlePostback(event);
    }
  }
  res.sendStatus(200);
});

// 開始請假
async function startLeaveFlow(event) {
  const profile = await client.getProfile(event.source.userId);
  const row = {
    timestamp: new Date().toLocaleString('zh-TW'),
    name: profile.displayName,
    lineId: event.source.userId,
    type: '請假',
    kind: '特休',
    start: '2025/11/10 09:00',
    end: '2025/11/10 17:00',
    hours: 7,
    reason: '參加婚禮',
    sup: '待簽',
    hr: '待簽'
  };

  // 存 Sheet
  const sheet = doc.sheetsByTitle[process.env.SHEET_NAME];
  const addedRow = await sheet.addRow(row);
  const rowNum = addedRow.rowNumber;

  // 推 Flex 卡片給主管
  await pushToSupervisors(rowNum, row, profile.displayName);
  await client.replyMessage(event.replyToken, { type: 'text', text: '✅ 已送出！主管收到卡片' });
}

// Flex 卡片
async function pushToSupervisors(rowNum, data, name) {
  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '✨ 立發新假單', color: '#FFFFFF', weight: 'bold' }], backgroundColor: '#0066FF' },
    hero: { type: 'image', url: 'https://i.imgur.com/2nT3Y0b.png', size: 'full' },
    body: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: name, size: 'xl', weight: 'bold' },
      { type: 'text', text: `${data.kind}｜${data.hours} 小時`, color: '#666' },
      { type: 'separator', margin: 'lg' },
      { type: 'box', layout: 'baseline', contents: [{ type: 'text', text: '時間' }, { type: 'text', text: `${data.start} ～ ${data.end}` }]},
      { type: 'box', layout: 'baseline', contents: [{ type: 'text', text: '原因' }, { type: 'text', text: data.reason }]},
    ]},
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'button', style: 'primary', action: { type: 'postback', label: '✅ 核准', data: `sup_ok=${rowNum}` }},
      { type: 'button', style: 'secondary', action: { type: 'postback', label: '❌ 駁回', data: `sup_no=${rowNum}` }},
    ]}
  };
  const supervisors = await getLineIdsByRole('主管');
  for (const id of supervisors) {
    await client.pushMessage(id, { type: 'flex', altText: '新假單', contents: bubble });
  }
}

// 簽核
async function handlePostback(event) {
  const data = event.postback.data;
  const [action, row] = data.split('=');
  const sheet = doc.sheetsByTitle[process.env.SHEET_NAME];
  const rows = await sheet.getRows();
  const targetRow = rows[row - 2]; // Sheet 從第 2 列開始

  if (action === 'sup_ok') {
    targetRow.sup = '核准';
    await targetRow.save();
    await client.replyMessage(event.replyToken, { type: 'text', text: '✅ 已核准' });
    await pushToHR(row, targetRow);
  } else {
    targetRow.sup = '駁回';
    await targetRow.save();
    await client.pushMessage(event.source.userId, { type: 'text', text: '❌ 主管駁回' });
  }
}

async function pushToHR(row, data) {
  // 同上，改推給 HR...
}

// 拿 LINE ID
async function getLineIdsByRole(role) {
  const sheet = doc.sheetsByTitle[process.env.ID_SHEET];
  const rows = await sheet.getRows();
  return rows.filter(r => r.get('角色') === role).map(r => r.get('LINE ID'));
}

app.listen(PORT, () => console.log(`立發 3.0 活在 ${PORT}`));
