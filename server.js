const TOKEN = "MS8swHYK+bC0SEUgR173zpb9sLKx76Fy2jNZhY/fibGDCjLee7t2klL/3ywPi6vpTTb+LzzpmwhClyC1OYG4yyVFIEGsIdG47iNaENmbaIOMlXmKYdImvj/nPiaAzKPXPctIITVv2CSoKeP6IPz7SAdB04t89/1O/w1cDnyilFU=";
const LOG_SHEET = "立發人資管理總表";
const ID_SHEET = "LINE_ID對照表"; // 假設你的 LINE ID 對照表 Sheet 名稱

function doPost(e) {
  // 防炸保護：e 或 postData 空值直接回 OK
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("OK");
  }
  
  try {
    const json = JSON.parse(e.postData.contents);
    const event = json.events[0];
    if (!event) return ContentService.createTextOutput("OK");
    
    if (event.type === "postback") handleApprove(event);
    if (event.type === "message" && event.message.text === "請假") renderLog(event);
  } catch (error) {
    console.error("Error in doPost: " + error.message);
  }
  return ContentService.createTextOutput("OK");
}

// 一鍵渲染
function renderLog(e) {
  const userId = e.source.userId;
  const profile = getProfile(userId);
  const sheet = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  const lastRow = getLastRow(sheet);
  const data = sheet.getRange(lastRow, 1, 1, 14).getValues()[0];

  const bubble = {
    "type": "bubble",
    "header": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "假勤卡片", "weight": "bold", "color": "#ffffff", "size": "lg" }], "backgroundColor": "#2d88ff" },
    "hero": { "type": "image", "url": "https://i.imgur.com/leave-icon.png", "size": "full", "aspectRatio": "2:1" },
    "body": {
      "type": "box", "layout": "vertical", "contents": [
        { "type": "text", "text": profile.displayName, "weight": "bold", "size": "xl" },
        { "type": "text", "text": "提交了特休", "color": "#666666" },
        { "type": "separator", "margin": "md" },
        { "type": "box", "layout": "vertical", "margin": "lg", "contents": [
          { "type": "box", "layout": "baseline", "contents": [{ "type": "text", "text": "假別", "flex": 2 }, { "type": "text", "text": data[4] }] }, // E 欄
          { "type": "box", "layout": "baseline", "contents": [{ "type": "text", "text": "時間", "flex": 2 }, { "type": "text", "text": `${data[5]} → ${data[6]}` }] }, // F & G 欄
          { "type": "box", "layout": "baseline", "contents": [{ "type": "text", "text": "時數", "flex": 2 }, { "type": "text", "text": `${data[7]} 小時`, "color": "#ff6b6b" }] } // H 欄
        ]}
      ]
    },
    "footer": {
      "type": "box", "layout": "vertical", "contents": [
        { "type": "button", "style": "primary", "action": { "type": "postback", "label": "✅ 核准", "data": `approve=${lastRow}` } },
        { "type": "button", "style": "secondary", "action": { "type": "postback", "label": "❌ 駁回", "data": `reject=${lastRow}` } }
      ]
    }
  };

  const msg = { type: "flex", altText: "新假來囉！", contents: bubble };

  // 推給所有主管
  getLineIdsByRole("主管").forEach(id => pushMessage(id, msg));
  reply(e.replyToken, "✅ 已送出！主管收到卡片");
}

function handleApprove(e) {
  const [action, rowStr] = e.postback.data.split("=");
  const row = Number(rowStr);
  const sheet = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  const result = action === "approve" ? "核准" : "駁回";

  sheet.getRange(row, 10).setValue(result); // J 欄主管簽核
  sheet.getRange(row, 12).setValue(new Date()); // L 欄時間
  reply(e.replyToken, result === "核准" ? "✅ 已核准" : "❌ 已駁回");

  if (result === "核准") renderToHR(row);
  else notifyEmployee(row, "❌ 您的假單被主管駁回");
}

// 工具函式
function getProfile(userId) {
  const url = `https://api.line.me/v2/bot/profile/${userId}`;
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return JSON.parse(res.getContentText());
}

function getLastRow(sheet) {
  return sheet.getLastRow();
}

function getLineIdsByRole(role) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ID_SHEET);
  const ids = sheet.getRange("A2:A").getValues().flat().filter(String);
  const roles = sheet.getRange("C2:C").getValues().flat();
  return ids.filter((id, i) => roles[i] === role);
}

function pushMessage(to, msg) {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ to, messages: [msg] })
  });
}

function reply(token, text) {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ replyToken: token, messages: [{ type: "text", text }] })
  });
}

function renderToHR(row) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  const data = sheet.getRange(row, 1, 1, 14).getValues()[0];
  const bubble = { /* 同 renderLog，但改 header 文字為 "主管已核准，HR 請簽" */ 
    "type": "bubble",
    "header": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "HR 簽核卡片", "weight": "bold", "color": "#ffffff", "size": "lg" }], "backgroundColor": "#2d88ff" },
    // ... 其他同 renderLog ...
  };
  const msg = { type: "flex", altText: "HR 簽核", contents: bubble };
  getLineIdsByRole("HR").forEach(id => pushMessage(id, msg));
}

function notifyEmployee(row, text) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  const userId = sheet.getRange(row, 3).getValue();
  pushMessage(userId, { type: "text", text });
}
