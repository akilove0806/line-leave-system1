from flask import Flask, request, abort
from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage, QuickReply, QuickReplyButton, PostbackAction, PostbackEvent
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import json
import os
import uuid
from datetime import datetime

app = Flask(__name__)

# 載入環境變數（在 Render 加這些）
CHANNEL_ACCESS_TOKEN = os.environ.get('CHANNEL_ACCESS_TOKEN')
CHANNEL_SECRET = os.environ.get('CHANNEL_SECRET')
GOOGLE_CREDENTIALS = os.environ.get('GOOGLE_CREDENTIALS')

line_bot_api = LineBotApi(CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(CHANNEL_SECRET)

# Google Sheets 設定
credentials_dict = json.loads(GOOGLE_CREDENTIALS)
scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
creds = ServiceAccountCredentials.from_json_keyfile_dict(credentials_dict, scope)
client = gspread.authorize(creds)
sheet = client.open_by_key('1_-XKtS85CCKrLC1A_J0sB5EIE-wpRiFxWRNbOUKdOU0').sheet1  # 使用你的 Sheets ID

# 主管和 HR 的 LINE ID（硬碼或從 DB 取）
SUPERVISOR_ID = 'YOUR_SUPERVISOR_LINE_ID'
HR_ID = 'YOUR_HR_LINE_ID'

@app.route("/webhook", methods=['POST'])
def webhook():
    signature = request.headers['X-Line-Signature']
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)
    return 'OK'

@handler.add(MessageEvent, message=TextMessage)
def handle_message(event):
    text = event.message.text.strip()
    if text.startswith('請假'):
        # 解析輸入，例如 "請假 2025-11-10 到 2025-11-12 事假 理由:生病"
        parts = text.split()
        if len(parts) < 5:
            line_bot_api.reply_message(event.reply_token, TextSendMessage(text='格式錯誤，請用: 請假 開始日期 到 結束日期 假別 [理由]'))
            return
        
        start_date = parts[1]
        end_date = parts[3]
        leave_type = parts[4]
        reason = ' '.join(parts[5:]) if len(parts) > 5 else '無'
        
        # 生成 ID
        leave_id = str(uuid.uuid4())
        
        # 寫入 Sheets
        timestamp = datetime.now().isoformat()
        row = [leave_id, event.source.user_id, leave_type, start_date, end_date, 'pending_supervisor', '', timestamp, reason]
        sheet.append_row(row)
        
        # 通知員工
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text=f'申請提交，ID: {leave_id}'))
        
        # 通知主管
        notify_supervisor(leave_id, start_date, end_date, leave_type, reason)

@handler.add(PostbackEvent)
def handle_postback(event):
    data = event.postback.data
    parts = data.split(':')
    if len(parts) != 2:
        return
    action, leave_id = parts
    
    # 找行
    row_index = find_row_by_id(leave_id)
    if not row_index:
        return
    
    current_status = sheet.cell(row_index, 6).value
    approver_history = sheet.cell(row_index, 7).value or ''
    timestamp = datetime.now().isoformat()
    
    if action == 'approve':
        if current_status == 'pending_supervisor':
            new_status = 'pending_hr'
            approver_history += f'Supervisor approved at {timestamp}; '
            sheet.update_cell(row_index, 6, new_status)
            sheet.update_cell(row_index, 7, approver_history)
            # 通知 HR
            details = get_leave_details(row_index)
            notify_hr(leave_id, *details)
        elif current_status == 'pending_hr':
            new_status = 'approved'
            approver_history += f'HR approved at {timestamp}; '
            sheet.update_cell(row_index, 6, new_status)
            sheet.update_cell(row_index, 7, approver_history)
            # 通知員工
            user_id = sheet.cell(row_index, 2).value
            line_bot_api.push_message(user_id, TextSendMessage(text=f'請假 ID: {leave_id} 已完成'))
    
    elif action == 'reject':
        new_status = 'rejected'
        approver_history += f'Rejected at {timestamp}; '
        sheet.update_cell(row_index, 6, new_status)
        sheet.update_cell(row_index, 7, approver_history)
        # 通知員工
        user_id = sheet.cell(row_index, 2).value
        line_bot_api.push_message(user_id, TextSendMessage(text=f'請假 ID: {leave_id} 被拒絕'))

def notify_supervisor(leave_id, start, end, leave_type, reason):
    message = f'新請假申請 ID: {leave_id}\n日期: {start} 到 {end}\n類型: {leave_type}\n理由: {reason}'
    line_bot_api.push_message(SUPERVISOR_ID, TextSendMessage(
        text=message,
        quick_reply=QuickReply(items=[
            QuickReplyButton(action=PostbackAction(label='批准', data=f'approve:{leave_id}')),
            QuickReplyButton(action=PostbackAction(label='拒絕', data=f'reject:{leave_id}'))
        ])
    ))

def notify_hr(leave_id, start, end, leave_type, reason):
    message = f'主管批准請假 ID: {leave_id}\n日期: {start} 到 {end}\n類型: {leave_type}\n理由: {reason}'
    line_bot_api.push_message(HR_ID, TextSendMessage(
        text=message,
        quick_reply=QuickReply(items=[
            QuickReplyButton(action=PostbackAction(label='批准', data=f'approve:{leave_id}')),
            QuickReplyButton(action=PostbackAction(label='拒絕', data=f'reject:{leave_id}'))
        ])
    ))

def find_row_by_id(leave_id):
    all_rows = sheet.get_all_values()
    for i, row in enumerate(all_rows[1:], start=2):
        if row[0] == leave_id:
            return i
    return None

def get_leave_details(row_index):
    row = sheet.row_values(row_index)
    return row[3], row[4], row[2], row[8]  # start, end, type, reason

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))