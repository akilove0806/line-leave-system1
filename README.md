# 請假Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue)](https://www.python.org/)
[![Build Status](https://img.shields.io/github/actions/workflow/status/your-username/awesome-leave-bot/ci.yml)](https://github.com/your-username/awesome-leave-bot/actions)

一個簡單的 LINE Bot 請假系統，讓員工、主管和 HR 透過 LINE 訊息申請與審核請假。記錄儲存在 Google Sheets，易於部署到 Render.com。

![Demo GIF](https://example.com/demo.gif)  <!-- 加截圖或 GIF 示範 -->

## 功能
- 員工提交請假申請（格式：`請假 開始日期 到 結束日期 假別 理由`）。
- 多級審核：主管 → HR。
- 自動通知和記錄留存。
- 易整合 Google Sheets 作為資料庫。

## 安裝
1. Clone Repo：
2. 安裝依賴：
3. 設定環境變數（在 `.env` 或 Render.com）：
- `CHANNEL_ACCESS_TOKEN`: LINE Channel Access Token
- `CHANNEL_SECRET`: LINE Channel Secret
- `GOOGLE_CREDENTIALS`: Google 服務帳戶 JSON

4. 設定 Google Sheets 和 LINE Developers Console（詳見 [docs/setup.md](docs/setup.md)）。

## 用法
1. 運行伺服器：
2. 在 LINE 加 Bot 好友，測試申請：
主管/HR 會收到通知，按鈕審核。完整記錄存入 Sheets。

## 貢獻
歡迎 Pull Request！請遵循以下步驟：
1. Fork Repo。
2. 創建 feature 分支 (`git checkout -b feature/new-feature`)。
3. Commit 變更 (`git commit -m 'Add new feature'`)。
4. Push 到分支 (`git push origin feature/new-feature`)。
5. 開 Pull Request。

詳見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權
本專案使用 MIT License - 詳見 [LICENSE](LICENSE)。

## FAQ
- **Q: 如何自訂審核流程？** A: 修改 `app.py` 中的狀態邏輯。
- **Q: 支援多使用者？** A: 是，透過 LINE ID 驗證。

感謝貢獻者！如有問題，開 Issue。