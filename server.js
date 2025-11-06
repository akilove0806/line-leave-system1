require('dotenv').config();
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();

const client = new Client({
  channelAccessToken: process.env.CHANNEL_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, auth);

const LOG_SHEET = "立發人資管理總表";
const ID_SHEET = "LINE_ID對照表";

let userState = {};

app.post('/webhook', middleware(client.config), async (req, res) => {
  for (const event of req.body.events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    const text = event.message?.text?.trim() || "";

    if (text === "請假" || text === "我要請假") await startLeaveFlow(event);
    else if (userState[userId]?.step === "bind_name") await bindName(event);
    else if (userState[userId]?.step === "input") await processLeaveInput(event);
    else if (userState[userId]?.step === "confirm") await confirmLeave(event);
    else if (event.type === "postback") await handleApprove(event);
  }
  res.sendStatus(200);
});

// 開始請假
async function startLeaveFlow(event) {
  await doc.loadInfo();
  const userId = event.source.userId;
  const name = await getBoundName(userId);
  if (!name) {
    await client.replyMessage(event.replyToken, { type: 'text', text: "首次使用，請回覆姓名綁定（如王小明）" });
    userState[userId] = { step: "bind_name" };
  } else {
    await client.replyMessage(event.replyToken, { type: 'text', text: "請假格式：\n請假 日期 假別 原因（如：請假 2025-11-11 特休 私事處理）\n或：請假 開始時間 結束時間 假別 原因" });
    userState[userId] = { step: "input" };
  }
}

// 綁定姓名
async function bindName(event) {
  await doc.loadInfo();
  const userId = event.source.userId;
  const name = event.message.text.trim();
  if (!name) return client.replyMessage(event.replyToken, { type: 'text', text: "姓名不能空" });
  await saveBoundName(userId, name);
  await client.replyMessage(event.replyToken, { type: 'text', text: `綁定完成：${name}\n開始請假` });
  delete userState[userId];
  await startLeaveFlow(event);
}

// 處理輸入
async function processLeaveInput(event) {
  await doc.loadInfo();
  const userId = event.source.userId;
  const parts = event.message.text.trim().split(" ").filter(Boolean);

  if (parts[0] !== "請假" || parts.length < 4) return client.replyMessage(event.replyToken, { type: 'text', text: "格式錯誤，請重試" });

  let start, end, kind, reason;
  if (parts.length === 4) {
    start = parts[1] + " 08:00";
    end = parts[1] + " 17:00";
    kind = parts[2];
    reason = parts[3];
  } else if (parts.length >= 6) {
    start = parts[1] + " " + parts[2];
    end = parts[3] + " " + parts[4];
    kind = parts[5];
    reason = parts.slice(6).join(" ");
  } else {
    return client.replyMessage(event.replyToken, { type: 'text', text: "格式錯誤" });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate) || startDate >= endDate) return client.replyMessage(event.replyToken, { type: 'text', text: "時間錯誤" });

  const hours = calcHours(startDate, endDate);
  const summary = `確認：\n假別：${kind}\n開始：${start}\n結束：${end}\n時數：${hours} 小時\n原因：${reason}\n\n是/否？`;
  await client.replyMessage(event.replyToken, { type: 'text', text: summary });
  userState[userId] = { step: "confirm", data: { start, end, kind, reason, hours } };
}

// 確認
async function confirmLeave(event) {
  await doc.loadInfo();
  const userId = event.source.userId;
  const msg = event.message.text.trim().toLowerCase();
  const state = userState[userId];

  if (msg === "是") {
    await saveToSheet(userId, state.data);
    await client.replyMessage(event.replyToken, { type: 'text', text: "已送出" });
    await renderLog(event, state.data);
    delete userState[userId];
  } else if (msg === "否") {
    await client.replyMessage(event.replyToken, { type: 'text', text: "已取消" });
    delete userState[userId];
  } else {
    await client.replyMessage(event.replyToken, { type: 'text', text: "請回「是」或「否」" });
  }
}

// 計算時數
function calcHours(start, end) {
  let h = 0, cur = new Date(start);
  while (cur < end) {
    const day = cur.getDay(), hour = cur.getHours();
    if (day >= 1 && day <= 5 && ((hour >= 8 && hour < 12) || (hour >= 13 && hour < 17))) h++;
    cur.setHours(cur.getHours() + 1);
  }
  return h;
}

// 存 Sheet
async function saveToSheet(userId, d) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const name = await getBoundName(userId);
  await sheet.addRow([
    new Date().toLocaleString('zh-TW'),
    name,
    userId,
    d.start,
    d.end,
    d.kind,
    d.reason,
    d.hours,
    "待簽",
    "待簽",
    "待處理"
  ]);
}

// renderLog
async function renderLog(event, d) {
  await doc.loadInfo();
  const name = await getBoundName(event.source.userId);
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const rowCount = sheet.rowCount;

  const bubble = { /* 同 GAS 版 */ };
  const msg = { type: "flex", altText: "新假來囉！", contents: bubble };
  const supervisors = await getLineIdsByRole("主管");
  for (const id of supervisors) await client.pushMessage(id, msg);
}

// 其他函式略...

app.listen(process.env.PORT || 3000);
