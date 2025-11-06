require('dotenv').config();
const express = require('express');
const { Client } = require('@line/bot-sdk');
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

app.post('/webhook', async (req, res) => {
  if (req.body.events[0]?.replyToken?.match(/0{32}|f{32}/)) return res.sendStatus(200);

  for (const event of req.body.events) {
    const userId = event.source.userId;
    const text = event.message?.text?.trim().toLowerCase() || "";

    if (text === "請假" || text === "我要請假") await startLeaveFlow(event);
    else if (userState[userId]?.step === "bind_name") await bindName(event);
    else if (userState[userId]?.step === "input") await processLeaveInput(event);
    else if (userState[userId]?.step === "confirm") await confirmLeave(event);
    else if (event.type === "postback") await handleApprove(event);
  }
  res.sendStatus(200);
});

// 開始請假流程
async function startLeaveFlow(event) {
  const userId = event.source.userId;
  const name = await getBoundName(userId);

  if (!name) {
    await client.replyMessage(event.replyToken, { type: 'text', text: "首次使用，請回覆您的真實姓名完成綁定（例如：王小明）" });
    userState[userId] = { step: "bind_name" };
  } else {
    const msg = "請按照以下格式填寫請假資訊（用空格分隔）：\n請假 開始時間 結束時間 假別 原因\n\n範例：請假 2025-11-10 09:00 2025-11-10 17:00 特休 參加婚禮\n\n全天請假範例：請假 2025-11-11 特休 私事處理";
    await client.replyMessage(event.replyToken, { type: 'text', text: msg });
    userState[userId] = { step: "input" };
  }
}

// 綁定姓名
async function bindName(event) {
  const userId = event.source.userId;
  const name = event.message.text.trim();
  if (!name) return client.replyMessage(event.replyToken, { type: 'text', text: "姓名不能為空" });

  await saveBoundName(userId, name);
  await client.replyMessage(event.replyToken, { type: 'text', text: `姓名綁定完成：${name}\n現在開始請假` });
  delete userState[userId];
  await startLeaveFlow(event);
}

// 處理輸入
async function processLeaveInput(event) {
  const parts = event.message.text.trim().split(" ");
  if (parts.length < 4 || parts[0] !== "請假") {
    return client.replyMessage(event.replyToken, { type: 'text', text: "格式錯誤，請重試範例" });
  }

  let start, end, kind, reason;
  if (parts.length === 4) {
    const date = parts[1];
    start = `${date} 08:00`; end = `${date} 17:00`;
    kind = parts[2]; reason = parts.slice(3).join(" ");
  } else {
    start = `${parts[1]} ${parts[2]}`;
    end = `${parts[3]} ${parts[4]}`;
    kind = parts[5]; reason = parts.slice(6).join(" ");
  }

  const startDate = new Date(start), endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate) || startDate >= endDate) {
    return client.replyMessage(event.replyToken, { type: 'text', text: "時間錯誤，請重試" });
  }

  const hours = calcHours(startDate, endDate);
  const summary = `確認請假資訊：\n假別：${kind}\n開始：${start}\n結束：${end}\n時數：${hours} 小時\n原因：${reason}\n\n確認送出？回覆「是」或「否」`;
  await client.replyMessage(event.replyToken, { type: 'text', text: summary });

  userState[event.source.userId] = { step: "confirm", data: { start, end, kind, reason, hours } };
}

// 確認送出
async function confirmLeave(event) {
  const userId = event.source.userId;
  const msg = event.message.text.trim().toLowerCase();
  const state = userState[userId];

  if (msg === "是") {
    await saveToSheet(userId, state.data);
    await client.replyMessage(event.replyToken, { type: 'text', text: "已送出！主管會收到通知" });
    await renderLog(event, state.data);
    delete userState[userId];
  } else if (msg === "否") {
    await client.replyMessage(event.replyToken, { type: 'text', text: "已取消" });
    delete userState[userId];
  } else {
    await client.replyMessage(event.replyToken, { type: 'text', text: "請回覆「是」或「否」" });
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

// 存入 Sheet（對應 11 欄）
async function saveToSheet(userId, d) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const name = await getBoundName(userId);
  await sheet.addRow([
    new Date().toLocaleString('zh-TW'), // A
    name,                               // B
    userId,                             // C
    d.start,                            // D
    d.end,                              // E
    d.kind,                             // F
    d.reason,                           // G
    d.hours,                            // H
    "待簽",                             // I
    "待簽",                             // J
    "待處理"                            // K
  ]);
}

// renderLog
async function renderLog(event, d) {
  const name = await getBoundName(event.source.userId);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const rowCount = sheet.rowCount;

  const bubble = { /* 同 GAS 版 renderLog */ };
  const msg = { type: "flex", altText: "新假來囉！", contents: bubble };
  const supervisors = await getLineIdsByRole("主管");
  for (const id of supervisors) await client.pushMessage(id, msg);
}

// 其他函式：handleApprove, renderToHR, getBoundName, saveBoundName, getLineIdsByRole 等略（與 GAS 版邏輯相同）

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
