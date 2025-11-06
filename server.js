async function handleApprove(event) {
  const [action, rowStr] = event.postback.data.split("=");
  const row = Number(rowStr);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[LOG_SHEET];
  const rows = await sheet.getRows();
  const targetRow = rows[row - 1];

  if (targetRow.主管簽核 !== "待簽") return client.replyMessage(event.replyToken, { type: 'text', text: "已處理過" });

  const result = action === "approve" ? "核准" : "駁回";
  targetRow.主管簽核 = result;
  targetRow.狀態 = result === "核准" ? "處理中" : "駁回";
  await targetRow.save();

  await client.replyMessage(event.replyToken, { type: 'text', text: result === "核准" ? "✅ 已核准" : "❌ 已駁回" });

  if (result === "核准") {
    await renderToHR(row); // 只核准才通知 HR
  } else {
    await notifyEmployee(row, "❌ 您的假單被主管駁回");
  }
}
