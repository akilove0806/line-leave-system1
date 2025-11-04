const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.raw({type:'*/*'}));
app.get('/ping',(_,r)=>r.send('OK'));
app.post('/',async(r,s)=>{
  try{
    const res = await fetch(process.env.GAS_URL,{method:'POST',body:r.body});
    s.status(res.status).send(await res.text());
  }catch(e){s.status(500).send('OK')}
});
app.listen(process.env.PORT||3000,()=>console.log('永不睡！'));
