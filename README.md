cat > README.md << 'EOF'
# LINE 請假系統

一個透過 LINE Bot 提交請假申請，自動寫入 Google 試算表的系統。

## 功能
- 輸入「請假」開始流程
- 填寫：開始日期、結束日期、假別、原因
- 自動寫入 Google Sheets
- 通知管理員（ADMIN_LINE_USER_ID）

## 部署
使用 Render 免費部署，設定 `render.yaml` 即可。

## 環境變數
| Key | 說明 |
|-----|------|
| `LINE_CHANNEL_SECRET` | LINE Bot 的 Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot 的 Channel Access Token |
| `SPREADSHEET_ID` | Google 試算表 ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 服務帳戶 JSON（字串） |
| `ADMIN_LINE_USER_ID` | 管理員 LINE ID（收到通知） |
| `PORT` | 10000 |

## 測試
在 LINE 對 Bot 說：`請假``我要請假`
EOF
