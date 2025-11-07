require('dotenv').config();  // 如果本地測試用 .env
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// LINE 配置
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(lineConfig);

// Google Sheets 配置
const sheetsId = process.env.SHEETS_ID;
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const supervisorId = process.env.SUPERVISOR_ID;
const hrId = process.env.HR_ID;

// 連線 Sheets
async function getSheet() {
  const doc = new GoogleSpreadsheet(sheetsId);
  await doc.useServiceAccountAuth(credentials);
  await doc.loadInfo();
  return doc.sheetsByIndex[0];  // 第一個工作表
}

// 找行由 ID
async function findRowById(sheet, leaveId) {
  await sheet.loadCells();
  const rows = await sheet.getRows();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].getCell(0).value === leaveId) {
      return i + 2;  // 行號從 2 開始 (跳過標頭)
    }
  }
  return null;
}

// 取得請假細節
async function getLeaveDetails(sheet, rowIndex) {
  await sheet.loadCells();
  const row = sheet.getRow(rowIndex);
  return {
    start: row[3], end: row[4], type: row[2], reason: row[8]
  };
}

// 通知主管
async function notifySupervisor(leaveId, start, end, leaveType, reason) {
  const message = {
    type: 'text',
    text: `新請假申請 ID: ${leaveId}\n日期: ${start} 到 ${end}\n類型: ${leaveType}\n理由: ${reason}`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '批准', data: `approve:${leaveId}` } },
        { type: 'action', action: { type: 'postback', label: '拒絕', data: `reject:${leaveId}` } }
      ]
    }
  };
  await client.pushMessage(supervisorId, message);
}

// 通知 HR
async function notifyHr(leaveId, start, end, leaveType, reason) {
  const message = {
    type: 'text',
    text: `主管批准請假 ID: ${leaveId}\n日期: ${start} 到 ${end}\n類型: ${leaveType}\n理由: ${reason}`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '批准', data: `approve:${leaveId}` } },
        { type: 'action', action: { type: 'postback', label: '拒絕', data: `reject:${leaveId}` } }
      ]
    }
  };
  await client.pushMessage(hrId, message);
}

// Webhook
app.post('/webhook', middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim();
      if (text.startsWith('請假')) {
        const parts = text.split(/\s+/);
        if (parts.length < 5) {
          await client.replyMessage(event.replyToken, { type: 'text', text: '格式錯誤，請用: 請假 開始日期 到 結束日期 假別 [理由]' });
          continue;
        }
        const startDate = parts[1];
        const endDate = parts[3];
        const leaveType = parts[4];
        const reason = parts.slice(5).join(' ') || '無';

        const leaveId = uuidv4();
        const timestamp = new Date().toISOString();

        const sheet = await getSheet();
        await sheet.addRow([leaveId, event.source.userId, leaveType, startDate, endDate, 'pending_supervisor', '', timestamp, reason]);

        await client.replyMessage(event.replyToken, { type: 'text', text: `申請提交，ID: ${leaveId}` });
        await notifySupervisor(leaveId, startDate, endDate, leaveType, reason);
      }
    } else if (event.type === 'postback') {
      const data = event.postback.data;
      const [action, leaveId] = data.split(':');

      const sheet = await getSheet();
      const rowIndex = await findRowById(sheet, leaveId);
      if (!rowIndex) continue;

      await sheet.loadCells();
      let status = sheet.getCellByA1(`F${rowIndex}`).value;
      let history = sheet.getCellByA1(`G${rowIndex}`).value || '';
      const timestamp = new Date().toISOString();

      if (action === 'approve') {
        if (status === 'pending_supervisor') {
          status = 'pending_hr';
          history += `Supervisor approved at ${timestamp}; `;
          sheet.getCellByA1(`F${rowIndex}`).value = status;
          sheet.getCellByA1(`G${rowIndex}`).value = history;
          await sheet.saveUpdatedCells();

          const details = await getLeaveDetails(sheet, rowIndex);
          await notifyHr(leaveId, details.start, details.end, details.type, details.reason);
        } else if (status === 'pending_hr') {
          status = 'approved';
          history += `HR approved at ${timestamp}; `;
          sheet.getCellByA1(`F${rowIndex}`).value = status;
          sheet.getCellByA1(`G${rowIndex}`).value = history;
          await sheet.saveUpdatedCells();

          const userId = sheet.getCellByA1(`B${rowIndex}`).value;
          await client.pushMessage(userId, { type: 'text', text: `請假 ID: ${leaveId} 已完成` });
        }
      } else if (action === 'reject') {
        status = 'rejected';
        history += `Rejected at ${timestamp}; `;
        sheet.getCellByA1(`F${rowIndex}`).value = status;
        sheet.getCellByA1(`G${rowIndex}`).value = history;
        await sheet.saveUpdatedCells();

        const userId = sheet.getCellByA1(`B${rowIndex}`).value;
        await client.pushMessage(userId, { type: 'text', text: `請假 ID: ${leaveId} 被拒絕` });
      }
    }
  }
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
