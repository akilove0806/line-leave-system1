const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.raw({type:'*/*'}));

app.get('/ping',(_,r)=>r.send('OK'));

app.post('/', async (req, res) => {
  try {
    const gas = await fetch(process.env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: req.body
    });
    const text = await gas.text();
    res.send(text || '{"replyToken":"dummy","messages":[{"type":"text","text":"✅ 已收到"}]}');
  } catch (e) {
    console.error(e);
    res.send('OK');
  }
});

app.listen(process.env.PORT || 3000, () => console.log('永不睡！'));
