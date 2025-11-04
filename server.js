const express = require('express');
const line = require('@line/bot-sdk');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// LINE 設定
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(config);

// 暫存請假申請與 row index
const pendingRequests = {};
const userStates = {};

// 內建 Service Account JSON（你的）
const BUILTIN_SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "mineral-voyage-477107-c7",
  "private_key_id": "bd673c20d4d6fbb5d7cc049fab37590966109165",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQClqBZXA4sMF2OL\nIQf1fz6kypwv336auioBl0f79F+SjHFCnkoXX4h+c39lpMGu6oxijX1/xgLNCeKv\n2BXxonbIJktL3OSMxltXyH+OoXHs45Bz7w8fOFjXAV+nn+lLI0+4JP1JZoP1ootc\nGOZr/yQv2APmRcfBuOYqtD1iWqrvSd3MVvWeWUQvyd1GwJcZNNyxtzAxQTZMigBc\nyDOQ1/zy+XGr7y/5+L97NOojLdFtXpKAVZuZ09xqNo2Bvk6uPW90NMH+zrLo7T1i\nOojJv6ri+BP8MinM7KyETy5Udfiia+zDzSn2GRJPLdbhs9wFDkW1vDd91vKY2udh\n+YABJd+7AgMBAAECggEAQlFG1EHmXgpU/wNTuNvee8FjAqVR/WZu36EtH7hGtJgF\n1Zoh5jaIIbtiMpJhOYHLfr7PEaJ3R5dgCW6T5l7Yd6sg9LdzRco5Ei0Bp9uJDMFT\neJ4pKyH3KufxX91cW4jA5uLkBYkFZgZTDSUoxe5oEcFEWmDwJeU8O7dZZbEPgmil\ntYoMLJF1P8S5F2EDsMqZeO1aJaRDJVbpB6IrF68cy7vtxmXKiVZL1k0LbX5V6jF+\nlh5pr3JVS+l7yTJtWZOWJcBT1pIkaDg75ytwC4uYAcTvmN9VQtH0jZepI/L06ieb\nCzp6lpalV/PYIFMsNszM6d7M8J5+b+NVV2u8eaShSQKBgQDjJmIYmMyet/FC7lQa\n8lIEdLNx6kW74Je9Gw8NCS3AorR/wbzd+W27eXRVNxKSvoRHzGy+JGGUH/cFY7Cg\nZOVRAa+pFh4FO91+ojVGG5dsIlGpr+GZQUf3vcqA0ADMmJ6nbUv0pO+QqhGkUh6z\nHxBa4eBrM4jHUCotKAmVv5bfCQKBgQC6skrPMH7MKe29Imkgs9ux3zpsSnE1S1xn\nrQEAdUAyf8VhrELFncVAQMHHl5NUftKiZ/LC0AxuqdpysDoZ1R/cR3S0OSybfBU2\ng2n9J3R4K9msEdlbcHjHkpeZmftIr1c+UG92GwLbp/AeIJHfAsGsS61nRw6JIHt6\npQYb+eE1owKBgGmKAfYPuLLeIDjK50UF5dmwJ1f8U54xgg8ZLWsPIrToZBkf+RLh\nu3xpuAWH6xdHccqyTqwh1zythWZ5pS1A89Mph2Z2okgoQod98ma6lyZk47CFybod\nPMT858Pl4RkuqDh+bdYjdDOw8TV5+k2bV0wCuvTUIu8IbjBA9AMh24WRAoGBAIwv\neFDe/zbafPM5tWqi4uJK1hmeRCdacQZAN7JaWFwS6OkQagrtDsHSXi86t5wIpqzg\nFL8HbW5jB+56OQZQq93BofX5wG732w3V224FhET/2DCGLomkiGyCvGbP4omPb5kQ\n2MD8Q0cgcQKOPjoQXdC7+nbEOjvpMg7DfzTeiqa1AoGBANVd2q0ZDBeS/qbuwT7T\nwOYRDDWcptPp2+pjHi+7Il+JIEqB4arPoJcgllm1e8/+nxXry5mBkcgWn31Fx3U6\nG/gMgpUL7CH61Z5X+iCyBpY2ao4DWGo41CLZfuRVbmOT/I5TtRnVgMU2iDTOp4/o\n6q7p4FWttPrV0VqjH0x3HwY/\n-----END PRIVATE KEY-----\n",
  "client_email": "lifahrsystem@mineral-voyage-477107-c7.iam.gserviceaccount.com",
  "client_id": "109593031688459935181",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/lifahrsystem%40mineral-voyage-477107-c7.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

async function getSheets() {
  let credentials = BUILTIN_SERVICE_ACCOUNT;  // 預設用內建
  const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (envJson && envJson.trim() !== '') {
    try {
      credentials = JSON.parse(envJson);
      console.log("Using environment Service Account JSON");
    } catch (e) {
      console.warn("Invalid GOOGLE_SERVICE_ACCOUNT_JSON, using built-in");
    }
  } else {
    console.log("No environment JSON, using built-in Service Account");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// 其餘程式碼不變...
// (handleEvent, submitLeaveRequest, handlePostback 等)

app.post('/webhook', async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type === 'message' && event.message.type === 'text') {
    const userId = event.source.userId;
    const text = event.message.text.trim();

    if (text === '請假') {
      userStates[userId] = { step: 'startDate' };
      return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入開始日期 (YYYY-MM-DD)' });
    }

    const state = userStates[userId];
    if (!state) return;

    if (state.step === 'startDate') {
      state.startDate = text; state.step = 'endDate';
      return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入結束日期 (YYYY-MM-DD)' });
    }
    if (state.step === 'endDate') {
      state.endDate = text; state.step = 'type';
      return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入假別 (事假/病假/公假...)' });
    }
    if (state.step === 'type') {
      state.type = text; state.step = 'reason';
      return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入請假原因' });
    }
    if (state.step === 'reason') {
      state.reason = text;
      await submitLeaveRequest(event, userId, state);
      delete userStates[userId];
    }
  }

  if (event.type === 'postback') {
    return handlePostback(event);
  }
}

async function submitLeaveRequest(event, userId, state) {
  try {
    const sheets = await getSheets();
    const spreadsheetId = '1bB_8XUYpzZWRT0Sld0cXaovNpePayTy2rSGpAOqhxto';
    const profile = await client.getProfile(userId);

    const row = [
      new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      profile.displayName,
      state.startDate,
      state.endDate,
      state.type,
      state.reason,
      '待審核'
    ];

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: '請假紀錄!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    const rowIndex = response.data.updates.updatedRange.match(/A(\d+)/)[1];
    const requestId = `${userId}_${Date.now()}`;
    pendingRequests[requestId] = { userId, row: parseInt(rowIndex), data: { ...state, displayName: profile.displayName } };

    const adminId = process.env.ADMIN_LINE_USER_ID;
    if (adminId) {
      await client.pushMessage(adminId, { /* Flex Message */ });
    }

    return client.replyMessage(event.replyToken, { type: 'text', text: '已提交請假申請，等待主管審核！' });
  } catch (err) {
    console.error("Submit error:", err);
    return client.replyMessage(event.replyToken, { type: 'text', text: '系統錯誤，請稍後再試。' });
  }
}

// handlePostback 略...

app.get('/', (req, res) => res.send('LINE 請假系統運行中'));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
