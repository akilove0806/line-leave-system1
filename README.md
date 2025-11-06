# Awesome Leave Bot

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
