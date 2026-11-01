/* Total Collision — сервер связи.
   Игроки подключаются к нему по WebSocket (порт 443 через HTTPS, проходит через VPN и жёсткие сети).
   Сервер держит комнаты по коду и пересылает сообщения между хостом и гостями.
   Расчёт боя остаётся у хоста (как и раньше). */
'use strict';
const http=require('http');
const {WebSocketServer}=require('ws');
const crypto=require('crypto');
const Acc=require('./accounts.js');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const pwTries=new Map(); // ip|код -> времена неверных попыток
function pwLimited(key,add){ const now=Date.now(); let a=(pwTries.get(key)||[]).filter(t=>now-t<60000); if(add)a.push(now); pwTries.set(key,a); return a.length>=6; }
setInterval(()=>{ const now=Date.now(); for(const [k,a] of pwTries){ if(!a.length||now-a[a.length-1]>120000)pwTries.delete(k); } },120000);
const PORT=process.env.PORT||8080;
const MAX_GUESTS=5;
function ipOf(req){ const f=req&&req.headers&&req.headers['x-forwarded-for']; return (f?String(f).split(',')[0].trim():(req&&req.socket&&req.socket.remoteAddress))||'?'; }
const ALPH='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms=new Map(); // code -> {host, guests:Map(id->ws), seq, token, grace}
const GRACE_MS=60000; // сколько ждём хоста, который обновил страницу

const srv=http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'text/plain; charset=utf-8','access-control-allow-origin':'*'});
  res.end('Total Collision server OK. Комнат: '+rooms.size+' · игроков в сети: '+Acc.onlineCount()+'\n');
});
const wss=new WebSocketServer({server:srv,maxPayload:2*1024*1024});

function code(){ for(let t=0;t<50;t++){ let c=''; for(let i=0;i<5;i++)c+=ALPH[Math.floor(Math.random()*ALPH.length)]; if(!rooms.has(c))return c; } return null; }
const sendT=(ws,o)=>{ if(ws.readyState===1)ws.send(JSON.stringify(o)); };

wss.on('connection',(ws,req)=>{
  ws.isAlive=true; ws.on('pong',()=>{ws.isAlive=true;});
  ws.role=null; ws.room=null; ws.gid=0; ws.msgs=0; ws.t0=Date.now();
  ws.on('message',(data,isBin)=>{
    // первый кадр — рукопожатие
    if(!ws.role){
      if(isBin)return ws.close();
      let m; try{m=JSON.parse(data.toString());}catch(e){return ws.close();}
      if(m.t==='host'){
        const tok=String(m.token||'').slice(0,64);
        if(m.code){ // хост вернулся после обновления страницы
          const r=rooms.get(String(m.code).toUpperCase());
          if(!r||!tok||r.token!==tok||(r.info&&r.info.inGame)){sendT(ws,{t:'err',e:'gone'});return ws.close();}
          if(r.grace){clearTimeout(r.grace);r.grace=null;}
          if(r.host&&r.host!==ws){ const old=r.host; old.room=null; try{old.close();}catch(e){} }
          ws.role='host'; ws.room=r; r.host=ws; sendT(ws,{t:'hosted',code:r.code,resumed:true});
          for(const [gid,g] of r.guests){ sendT(ws,{join:gid}); sendT(g,{t:'srv',e:'rehello'}); }
          return;
        }
        const c=code(); if(!c){sendT(ws,{t:'err',e:'full'});return ws.close();}
        ws.role='host'; ws.room={code:c,host:ws,guests:new Map(),seq:0,token:tok,grace:null,pwh:m.pw?sha(c+String(m.pw).slice(0,32)):''}; rooms.set(c,ws.room); sendT(ws,{t:'hosted',code:c});
      }else if(m.t==='join'){
        const r=rooms.get(String(m.code||'').trim().toUpperCase());
        if(!r){sendT(ws,{t:'nojoin',e:'nf'});return ws.close();}
        if(r.guests.size>=MAX_GUESTS){sendT(ws,{t:'nojoin',e:'full'});return ws.close();}
        if(r.pwh){
          const key=ipOf(req)+'|'+r.code;
          if(pwLimited(key,false)){sendT(ws,{t:'nojoin',e:'rate'});return ws.close();}
          if(m.pw==null||m.pw===''){sendT(ws,{t:'nojoin',e:'pw'});return ws.close();}
          if(sha(r.code+String(m.pw).slice(0,32))!==r.pwh){ pwLimited(key,true); sendT(ws,{t:'nojoin',e:'badpw'});return ws.close(); }
        }
        ws.role='guest'; ws.room=r; ws.gid=++r.seq; r.guests.set(ws.gid,ws); sendT(ws,{t:'joined'});
        if(r.host)sendT(r.host,{join:ws.gid});
      }else if(m.t==='list'){
        const list=[]; for(const r of rooms.values()){ const i=r.info; if(i&&!i.inGame&&r.host&&r.host.readyState===1)list.push({code:r.code,lock:!!r.pwh,name:String(i.name||'').slice(0,24),mode:String(i.mode||'').slice(0,8),n:i.n|0,max:i.max|0,size:i.size|0,ver:String(i.ver||'').slice(0,12)}); }
        sendT(ws,{t:'rooms',list:list.slice(0,50)}); setTimeout(()=>{try{ws.close();}catch(e){}},300);
      }else if(Acc.handshake(ws,m,req)){ ws.role='acct'; }
      else ws.close();
      return;
    }
    if(ws.role==='acct'){ Acc.message(ws,data,isBin); return; }
    const r=ws.room; if(!r)return;
    if(ws.role==='guest'){
      if(isBin)return; // гости шлют только короткие текстовые сообщения
      const txt=data.toString(); if(txt.length>20000)return;
      if(r.host&&r.host.readyState===1)r.host.send('{"from":'+ws.gid+',"m":'+txt+'}'); // txt — уже JSON
    }else{
      if(isBin){ // [u32 кому][данные]; кому=0 — всем
        const b=Buffer.from(data); if(b.length<5)return; const to=b.readUInt32BE(0), body=b.subarray(4);
        if(to===0){ for(const g of r.guests.values())if(g.readyState===1)g.send(body,{binary:true}); }
        else{ const g=r.guests.get(to); if(g&&g.readyState===1)g.send(body,{binary:true}); }
      }else{
        let m; try{m=JSON.parse(data.toString());}catch(e){return;}
        if(m.t==='ping')return;
        if(m.t==='info'){ if(typeof m.pw==='string')r.pwh=m.pw?sha(r.code+m.pw.slice(0,32)):''; r.info={open:!!m.open,inGame:!!m.inGame,name:m.name,mode:m.mode,n:m.n,max:m.max,size:m.size,ver:m.ver}; return; }
        const s=JSON.stringify(m.m);
        if(m.to===0||m.to==null){ for(const g of r.guests.values())if(g.readyState===1)g.send(s); }
        else if(m.kick){ const g=r.guests.get(m.kick); if(g)g.close(); }
        else{ const g=r.guests.get(m.to); if(g&&g.readyState===1)g.send(s); }
      }
    }
  });
  ws.on('close',()=>{
    if(ws.role==='acct'){ Acc.closed(ws); return; }
    const r=ws.room; if(!r)return;
    if(ws.role==='guest'){ r.guests.delete(ws.gid); if(r.host)sendT(r.host,{leave:ws.gid}); }
    else if(ws.role==='host'&&r.host===ws){
      const canWait=r.token&&!(r.info&&r.info.inGame)&&rooms.get(r.code)===r;
      if(!canWait){ rooms.delete(r.code); for(const g of r.guests.values())g.close(4000,'host-left'); return; }
      r.host=null; for(const g of r.guests.values())sendT(g,{t:'srv',e:'hostwait'});
      r.grace=setTimeout(()=>{ if(rooms.get(r.code)===r&&!r.host){ rooms.delete(r.code); for(const g of r.guests.values())g.close(4000,'host-left'); } },GRACE_MS);
    }
  });
  ws.on('error',()=>{});
});
// живость соединений (Render и браузеры закрывают молчащие)
setInterval(()=>{ for(const ws of wss.clients){ if(!ws.isAlive){ws.terminate();continue;} ws.isAlive=false; try{ws.ping();}catch(e){} } },25000);
process.on('SIGTERM',()=>{ Acc.flush(); process.exit(0); });
process.on('SIGINT',()=>{ Acc.flush(); process.exit(0); });
srv.listen(PORT,()=>console.log('Total Collision server on :'+PORT));
