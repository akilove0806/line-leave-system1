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
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/ /g, '\n').trim(), // 單行版處理
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, auth);

// 狀態管理
let userState = {}; // in-memory, 可換 Redis

// 健康檢查
app.get('/', (req, res) => res.send('立發 4.0 活著！🚀'));

// Webhook
app.post('/webhook', middleware({
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_TOKEN
}), async (req, res) => {
  // Verify 假事件放行
  if (req.body.events[0]?.replyToken === '00000000000000000000000000000000' ||
      req.body.events[0]?.replyToken === 'ffffffffffffffffffffffffffffffff') {
    return res.sendStatus(200);
  }

  for (const event of req.body.events) {
    const userId = event.source.userId;
    const message = event.message?.text ? event.message.text.trim().toLowerCase() : "";
    
    if (message === "請假" || message === "我要請假") await startLeaveFlow(event);
    else if (userState[userId] && userState[userId].step === "bind_name") await bindName(event);
    else if (userState[userId] && userState[userId].step === "input") await processLeaveInput(event);
    else if (userState[userId] && userState[userId].step === "confirm") await confirmLeave(event);
    else if (event.type === "postback") await handleApprove(event);
  }
  res.sendStatus(200);
});

// 開始請假流程：先檢查姓名綁定
async function startLeaveFlow(event) {
  const userId = event.source.userId;
  const name = await getBoundName(userId);
  
  if (!name) {
    await client.replyMessage(event.replyToken, { type: 'text', text: "首次使用，請回覆您的真實姓名完成綁定（例如：王小明）" });
    userState[userId] = { step: "bind_name" };
  } else {
    const text = "請按照以下格式填寫請假資訊（用空格分隔）：\n請假 開始時間 結束時間 假別 原因\n\n範例：請假 2025-11-10 09:00 2025-11-10 17:00 特休 參加婚禮\n\n全天請假範例：請假 2025-11-11 特休 私事處理";
    await client.replyMessage(event.replyToken, { type: 'text', text });
    userState[userId] = { step: "input" };
  }
}

// 綁定姓名
async function bindName(event) {
  const userId = event.source.userId;
  const name = event.message.text.trim();
  
  if (!name) {
    await client.replyMessage(event.replyToken, { type: 'text', text: "姓名不能空，請回覆您的真實姓名" });
    return;
  }
  
  await saveBoundName(userId, name);
  await client.replyMessage(event.replyToken, { type: 'text', text: `✅ 姓名綁定完成：${name}\n現在請開始請假流程` });
  
  delete userState[userId];
  await startLeaveFlow(event); // 綁定後繼續請假
}

// 處理輸入（修正解析邏輯：支持全天請假格式）
async function processLeaveInput(event) {
  const userId = event.source.userId;
  const parts = event.message.text.trim().split(" ");
  
  if (parts.length < 4 || parts[0] !== "請假") {
    await client.replyMessage(event.replyToken, { type: 'text', text: "格式錯誤，請重試範例：請假 開始時間 結束時間 假別 原因 或 請假 日期 假別 原因（全天）" });
    return;
  }
  
  let start, end, kind, reason;
  
  if (parts.length === 4) {
    // 全天請假格式：請假 日期 假別 原因
    const date = parts[1];
    start = date + " 08:00";
    end = date + " 17:00";
    kind = parts[2];
    reason = parts.slice(3).join(" ");
  } else if (parts.length >= 6) {
    // 完整格式：請假 開始日期 開始時間 結束日期 結束時間 假別 原因
    start = parts[1] + " " + parts[2];
    end = parts[3] + " " + parts[4];
    kind = parts[5];
    reason = parts.slice(6).join(" ");
  } else {
    await client.replyMessage(event.replyToken, { type: 'text', text: "格式錯誤，請重試" });
    return;
  }
  
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate) || startDate >= endDate) {
    await client.replyMessage(event.replyToken, { type: 'text', text: "時間格式錯誤或開始時間晚於結束時間，請重試" });
    return;
  }
  
  const hours = calcHours(startDate, endDate);
  const summary = `確認請假資訊：\n假別：${kind}\n開始：${start}\n結束：${end}\n時數：${hours} 小時\n原因：${reason}\n\n確認送出？回覆「是」或「否」`;
  await client.replyMessage(event.replyToken, { type: 'text', text: summary });
  
  userState[userId] = { step: "confirm", data: { start, end, kind, reason, hours } };
}

// 確認送出
async function confirmLeave(event) {
  const userId = event.source.userId;
  const message = event.message.text.trim().toLowerCase();
  const state = userState[userId];
  
  if (message === "是") {
    await saveToSheet(userId, state.data);
    await client.replyMessage(event.replyToken, { type: 'text', text: "✅ 已送出！主管會收到通知" });
    await renderLog(event, state.data);
    delete userState[userId];
  } else if (message === "否") {
    await client.replyMessage(event.replyToken, { type: 'text', text: "❌ 已取消，請重新開始" });
    delete userState[userId];
  } else {
    await client.replyMessage(event.replyToken, { type: 'text', text: "請回覆「是」或「否」" });
  }
}

// 計算時數
function calcHours(start, end) {
  let hours = 0;
  let cur = new Date(start);
  while (cur < end) {
    const day = cur.getDay();
    const h = cur.getHours();
    if (day >= 1 && day <= 5) {
      if ((h >= 8 && h < 12) || (h >= 13 && h < 17)) hours += 1;
    }
    cur.setHours(cur.getHours() + 1);
  }
  return hours;
}

// 存入 Sheet
async function saveToSheet(userId, d) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const name = await getBoundName(userId);
  await sheet.addRow({
    提交時間: new Date().toLocaleString('zh-TW'),
    員工姓名: name,
    LINE_ID: userId,
    類型: "請假",
    假別: d.kind,
    開始時間: d.start,
    結束時間: d.end,
    時數: d.hours,
    原因: d.reason,
    主管簽核: "待簽",
    HR簽核: "待簽"
  });
}

// renderLog：使用綁定姓名
async function renderLog(event, d) {
  const userId = event.source.userId;
  const name = await getBoundName(userId);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const lastRow = sheet.rowCount; // 最後一筆 row

  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "假勤卡片", weight: "bold", color: "#ffffff", size: "lg" }], backgroundColor: "#2d88ff" },
    hero: { type: "image", url: "https://i.imgur.com/leave-icon.png", size: "full", aspectRatio: "2:1" },
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: name, weight: "bold", size: "xl" },
        { type: "text", text: "提交了" + d.kind, color: "#666666" },
        { type: "separator", margin: "md" },
        { type: "box", layout: "vertical", margin: "lg", contents: [
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "假別", flex: 2 }, { type: "text", text: d.kind }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "時間", flex: 2 }, { type: "text", text: `${d.start} → ${d.end}` }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "時數", flex: 2 }, { type: "text", text: `${d.hours} 小時`, color: "#ff6b6b" }] }
        ]}
      ]
    },
    footer: {
      type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary", action: { type: "postback", label: "✅ 核准", data: `approve=${lastRow}` } },
        { type: "button", style: "secondary", action: { type: "postback", label: "❌ 駁回", data: `reject=${lastRow}` } }
      ]
    }
  };

  const msg = { type: "flex", altText: "新假來囉！", contents: bubble };
  const supervisors = await getLineIdsByRole("主管");
  for (const id of supervisors) {
    await client.pushMessage(id, msg);
  }
}

// 其他函式（handleApprove, getBoundName, saveBoundName, getLineIdsByRole, pushMessage 等）保持不變...

async function handleApprove(event) {
  const [action, rowStr] = event.postback.data.split("=");
  const row = Number(rowStr);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const rows = await sheet.getRows();
  const targetRow = rows[row - 1]; // 0-index
  targetRow.主管簽核 = action === "approve" ? "核准" : "駁回";
  await targetRow.save();
  
  await client.replyMessage(event.replyToken, { type: "text", text: action === "approve" ? "✅ 已核准" : "❌ 已駁回" });
  
  if (action === "approve") await renderToHR(row);
  else await notifyEmployee(row, "❌ 您的假單被主管駁回");
}

async function getBoundName(userId) {
  await doc.loadInfo();
  const idSheet = doc.sheetsByTitle[ID_SHEET];
  const rows = await idSheet.getRows();
  const row = rows.find(r => r.get('LINE_ID') === userId);
  return row ? row.get('姓名') : null;
}

async function saveBoundName(userId, name) {
  await doc.loadInfo();
  const idSheet = doc.sheetsByTitle[ID_SHEET];
  await idSheet.addRow({
    LINE_ID: userId,
    姓名: name,
    角色: "員工"
  });
}

async function getLineIdsByRole(role) {
  await doc.loadInfo();
  const idSheet = doc.sheetsByTitle[ID_SHEET];
  const rows = await idSheet.getRows();
  return rows.filter(r => r.get('角色') === role).map(r => r.get('LINE_ID'));
}

async function renderToHR(row) {
  // 同 renderLog，但改 header 為 "主管已核准，HR 簽核"，並推給 HR
  // ... (類似邏輯)
}

async function notifyEmployee(row, text) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const rows = await sheet.getRows();
  const userId = rows[row - 1].get('LINE_ID');
  await client.pushMessage(userId, { type: "text", text });
}

app.listen(PORT, () => console.log(`立發 4.0 活在 ${PORT}`));
