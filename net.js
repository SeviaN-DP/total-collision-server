/* ===== Сеть: PeerJS (WebRTC), хост считает бой, гости шлют приказы; снимки позиций ===== */
(function(root){
'use strict';
const PB=root.PB, T=PB.t, PI=Math.PI, TAU=Math.PI*2;
const PEER_SRC=['https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js','https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js','https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js'];
let peerLoading=null;
function loadPeer(){
  if(root.Peer)return Promise.resolve();
  if(peerLoading)return peerLoading;
  peerLoading=new Promise((res,rej)=>{ let i=0;
    const next=()=>{ if(i>=PEER_SRC.length){peerLoading=null;return rej(new Error(T('Не удалось загрузить библиотеку соединения (PeerJS). Проверьте интернет.')));}
      const sc=document.createElement('script'); sc.src=PEER_SRC[i++]; sc.onload=()=>res(); sc.onerror=()=>{sc.remove();next();}; document.head.appendChild(sc); };
    next(); });
  return peerLoading;
}
const ALPH='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){let c='';for(let i=0;i<5;i++)c+=ALPH[Math.floor(Math.random()*ALPH.length)];return c;}
const PREFIX='polebrani-';
const PEER_OPTS={debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]}};

function PeerHost(){ this.peer=null; this.conns=new Map(); this.onJoin=null; this.onMsg=null; this.onLeave=null; this.seq=0; this.last=new Map(); }
PeerHost.prototype.start=async function(){
  await loadPeer();
  for(let tries=0;tries<6;tries++){
    const code=makeCode();
    try{ await new Promise((res,rej)=>{ const p=new root.Peer(PREFIX+code,PEER_OPTS); const to=setTimeout(()=>{try{p.destroy();}catch(e){} rej(new Error('timeout'));},9000);
      p.on('open',()=>{clearTimeout(to);this.peer=p;this.code=code;res();}); p.on('error',e=>{clearTimeout(to);try{p.destroy();}catch(_){} rej(e);}); });
      break; }catch(e){ if(tries===5)throw new Error(T('Не удалось создать лобби: ')+(e&&e.type||e.message)); }
  }
  this.peer.on('connection',c=>{
    const id=++this.seq; c.__id=id;
    c.on('open',()=>{this.conns.set(id,c);this.last.set(id,performance.now());});
    c.on('data',d=>{this.last.set(id,performance.now()); if(d&&d.t==='h')return; this.onMsg&&this.onMsg(id,d);});
    const gone=()=>{ if(this.conns.delete(id)){this.last.delete(id);this.onLeave&&this.onLeave(id);} };
    c.on('close',gone); c.on('error',gone);
  });
  this.peer.on('disconnected',()=>{try{this.peer.reconnect();}catch(e){}});
  this.timer=setInterval(()=>{ const now=performance.now(); for(const [id,c] of [...this.conns]){ if(now-(this.last.get(id)||now)>14000){try{c.close();}catch(e){} this.conns.delete(id); this.last.delete(id); this.onLeave&&this.onLeave(id);} } },3000);
  return this.code;
};
PeerHost.prototype.send=function(id,m){const c=this.conns.get(id); if(c&&c.open){try{c.send(m);}catch(e){}}};
PeerHost.prototype.all=function(m){for(const c of this.conns.values()){if(c.open){try{c.send(m);}catch(e){}}}};
PeerHost.prototype.close=function(){clearInterval(this.timer);try{this.peer&&this.peer.destroy();}catch(e){}};

function PeerGuest(){ this.peer=null; this.conn=null; this.onMsg=null; this.onClose=null; }
PeerGuest.prototype.connect=async function(code,hello){
  await loadPeer();
  code=String(code||'').trim().toUpperCase();
  return new Promise((res,rej)=>{
    const p=new root.Peer(undefined,PEER_OPTS); this.peer=p; let done=false;
    const fail=(m)=>{ if(done)return; done=true; try{p.destroy();}catch(e){} rej(new Error(m)); };
    const to=setTimeout(()=>fail(T('Не удалось соединиться. Проверьте код или попросите хоста проверить, что страница открыта.')),14000);
    p.on('error',e=>fail(e&&e.type==='peer-unavailable'?T('Лобби с таким кодом не найдено.'):T('Ошибка соединения: ')+(e&&e.type||e)));
    p.on('open',()=>{
      const c=p.connect(PREFIX+code,{reliable:true,serialization:'binary'}); this.conn=c;
      c.on('open',()=>{ if(done)return; done=true; clearTimeout(to); c.send(hello); this.hb=setInterval(()=>{if(c.open)c.send({t:'h'});},2000); res(); });
      c.on('data',d=>this.onMsg&&this.onMsg(d));
      const closed=()=>{clearInterval(this.hb); if(!done){fail(T('Соединение закрыто.'));} else this.onClose&&this.onClose();};
      c.on('close',closed); c.on('error',closed);
    });
  });
};
PeerGuest.prototype.send=function(m){ if(this.conn&&this.conn.open){try{this.conn.send(m);}catch(e){}} };
PeerGuest.prototype.close=function(){clearInterval(this.hb);try{this.peer&&this.peer.destroy();}catch(e){}};

/* ---------- связь через сервер (WebSocket): основной способ, если задан адрес сервера ---------- */
function serverURL(){
  let u=''; try{ const q=new URLSearchParams(location.search).get('server'); if(q){u=q; try{localStorage.setItem('tc_server',q);}catch(e){}} }catch(e){}
  if(!u){ try{u=localStorage.getItem('tc_server')||'';}catch(e){} }
  if(!u)u=root.__SERVER__||'';
  u=String(u||'').trim(); if(!u||u==='peer')return '';
  return u.replace(/^http:/,'ws:').replace(/^https:/,'wss:').replace(/\/+$/,'');
}
const enc=new TextEncoder(), dec=new TextDecoder();
function packMsg(m,to){ // -> строка (текст) или Uint8Array (бинарный кадр); to != null -> кадр хосту [u32 кому][данные]
  if(m&&m.b&&(m.b instanceof ArrayBuffer||ArrayBuffer.isView(m.b))){
    const body=m.b instanceof ArrayBuffer?new Uint8Array(m.b):new Uint8Array(m.b.buffer,m.b.byteOffset,m.b.byteLength), h=Object.assign({},m); delete h.b;
    const hb=enc.encode(JSON.stringify(h)), off=(to!=null?4:0), out=new Uint8Array(off+4+hb.length+body.length), dv=new DataView(out.buffer);
    if(to!=null)dv.setUint32(0,to); dv.setUint32(off,hb.length); out.set(hb,off+4); out.set(body,off+4+hb.length); return out;
  }
  return null;
}
/* сжатие кадров боя: кадр [u32 0][deflate-raw(обычный кадр)]; дельта-кодирование снимков делает packSnap/applySnap */
async function zdeflate(u8){ if(typeof CompressionStream==='undefined')return null; const cs=new CompressionStream('deflate-raw'), w=cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
async function zinflate(u8){ const ds=new DecompressionStream('deflate-raw'), w=ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
async function zipMsg(m){ const raw=packMsg(m,null); if(!raw)return null; const z=await zdeflate(raw); if(!z)return null; const out=new Uint8Array(4+z.length); out.set(z,4); return out; }
let zChain=Promise.resolve(), zPend=0;
PB.zok=typeof DecompressionStream!=='undefined'&&typeof CompressionStream!=='undefined'&&typeof Response!=='undefined';
function inbound(data,cb){ let m; try{ m=typeof data==='string'?JSON.parse(data):unpackBin(data); }catch(e){return;}
  if(m.zz){ zPend++; zChain=zChain.then(async()=>{ try{ const raw=await zinflate(m.zz); cb(unpackBin(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength))); }catch(e){} zPend--; }); }
  else if(zPend>0){ zChain=zChain.then(()=>{ try{cb(m);}catch(e){} }); } else cb(m); }
function unpackBin(buf){ const u0=new Uint8Array(buf); if(u0.length>=4&&u0[0]===0&&u0[1]===0&&u0[2]===0&&u0[3]===0)return {zz:u0.subarray(4)}; const u=u0, dv=new DataView(u.buffer,u.byteOffset,u.byteLength), hl=dv.getUint32(0); const m=JSON.parse(dec.decode(u.subarray(4,4+hl))); m.b=u.subarray(4+hl); return m; }
function openWS(url,wake){
  return new Promise((res,rej)=>{ let ws; try{ws=new WebSocket(url);}catch(e){return rej(new Error(T('Неверный адрес сервера.')));} ws.binaryType='arraybuffer';
    const to=setTimeout(()=>{try{ws.close();}catch(e){} rej(new Error(T('Сервер не отвечает. Если он только что был в простое, подождите минуту и повторите.')));},wake||60000);
    ws.onopen=()=>{clearTimeout(to);res(ws);}; ws.onerror=()=>{clearTimeout(to);rej(new Error(T('Не удалось подключиться к серверу. Проверьте интернет.')));}; });
}
function waitMsg(ws,types,ms){
  return new Promise((res,rej)=>{ const to=setTimeout(()=>{ws.removeEventListener('message',h);ws.removeEventListener('close',c);rej(new Error(T('Сервер не ответил.')));},ms||15000);
    const h=ev=>{ if(typeof ev.data!=='string')return; let m; try{m=JSON.parse(ev.data);}catch(e){return;} if(types.includes(m.t)){clearTimeout(to);ws.removeEventListener('message',h);ws.removeEventListener('close',c);res(m);} };
    const c=()=>{clearTimeout(to);ws.removeEventListener('message',h);rej(new Error(T('Соединение закрыто.')));};
    ws.addEventListener('message',h); ws.addEventListener('close',c); });
}
function WsHost(){ this.ws=null; this.conns=new Map(); this.onMsg=null; this.onLeave=null; this.onClose=null; this.last=new Map(); this.url=serverURL(); }
WsHost.prototype.start=async function(resumeCode,pw){
  const ws=await openWS(this.url); this.ws=ws; ws.send(JSON.stringify({t:'host',token:this.token||'',code:resumeCode||undefined,pw:pw||undefined}));
  const r=await waitMsg(ws,['hosted','err']).catch(e=>{try{ws.close();}catch(_){} throw e;});
  if(r.t!=='hosted'){ try{ws.close();}catch(_){} const er=new Error(r.e==='gone'?'gone':T('Не удалось создать лобби: сервер занят.')); er.gone=r.e==='gone'; throw er; }
  this.code=r.code;
  const gone=id=>{ if(this.conns.delete(id)){this.last.delete(id);this.onLeave&&this.onLeave(id);} };
  ws.onmessage=ev=>{ if(typeof ev.data!=='string')return; let m; try{m=JSON.parse(ev.data);}catch(e){return;}
    if(m.join){ const id=m.join, self=this; this.conns.set(id,{open:true,send(x){self.sendTo(id,x);},close(){try{ws.send(JSON.stringify({kick:id}));}catch(e){}}}); this.last.set(id,performance.now()); }
    else if(m.leave){ gone(m.leave); }
    else if(m.from){ this.last.set(m.from,performance.now()); if(m.m&&m.m.t==='h')return; this.onMsg&&this.onMsg(m.from,m.m); } };
  ws.onclose=()=>{ clearInterval(this.timer); this.onClose&&this.onClose(); };
  this.timer=setInterval(()=>{ try{ws.send('{"t":"ping"}');}catch(e){} if(this.info)this.setInfo(this.info); const now=performance.now(); for(const [id,c] of [...this.conns]){ if(now-(this.last.get(id)||now)>45000){try{c.close();}catch(e){} gone(id);} } },5000);
  return this.code;
};
WsHost.prototype.sendTo=function(id,m){ const ws=this.ws; if(!ws||ws.readyState!==1)return; const bin=packMsg(m,id); try{ if(bin)ws.send(bin); else ws.send(JSON.stringify({to:id,m})); }catch(e){} };
WsHost.prototype.sendRaw=function(id,u8){ const ws=this.ws; if(!ws||ws.readyState!==1||!this.conns.has(id))return; const out=new Uint8Array(4+u8.length); new DataView(out.buffer).setUint32(0,id); out.set(u8,4); try{ws.send(out);}catch(e){} };
WsHost.prototype.send=function(id,m){ if(this.conns.has(id))this.sendTo(id,m); };
WsHost.prototype.all=function(m){ const ws=this.ws; if(!ws||ws.readyState!==1)return; const bin=packMsg(m,0); try{ if(bin)ws.send(bin); else ws.send(JSON.stringify({to:0,m})); }catch(e){} };
WsHost.prototype.setInfo=function(info){ this.info=info; try{ this.ws&&this.ws.readyState===1&&this.ws.send(JSON.stringify(Object.assign({t:'info'},info))); }catch(e){} };
WsHost.prototype.close=function(){ clearInterval(this.timer); try{this.ws&&(this.ws.onclose=null,this.ws.close());}catch(e){} };

function WsGuest(){ this.ws=null; this.onMsg=null; this.onClose=null; this.url=serverURL(); }
WsGuest.prototype.connect=async function(code,hello,pw){
  code=String(code||'').trim().toUpperCase();
  const ws=await openWS(this.url); this.ws=ws;
  ws.send(JSON.stringify({t:'join',code,pw:pw||undefined}));
  const r=await waitMsg(ws,['joined','nojoin']).catch(e=>{try{ws.close();}catch(_){} throw e;});
  if(r.t!=='joined'){ try{ws.close();}catch(_){} const er=new Error(r.e==='full'?T('Лобби заполнено.'):r.e==='pw'||r.e==='badpw'?T('Нужен пароль лобби.'):r.e==='rate'?T('Слишком много неверных паролей. Подождите минуту.'):T('Лобби с таким кодом не найдено.')); er.needPw=r.e==='pw'||r.e==='badpw'; er.badPw=r.e==='badpw'; throw er; }
  ws.onmessage=ev=>inbound(ev.data,m=>{ this.onMsg&&this.onMsg(m); });
  ws.onclose=()=>{ clearInterval(this.hb); try{this.hw&&this.hw.terminate();}catch(e){} this.onClose&&this.onClose(); };
  this.send(hello);
  // пульс гостя идёт из отдельного потока: в фоновом окне обычные таймеры браузер замедляет, и хост решил бы, что гость отключился
  try{ const url=URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},2000)'],{type:'text/javascript'})); this.hw=new Worker(url); this.hw.onmessage=()=>this.send({t:'h'}); }catch(e){ this.hb=setInterval(()=>this.send({t:'h'}),2000); }
};
WsGuest.prototype.send=function(m){ const ws=this.ws; if(ws&&ws.readyState===1){ try{ws.send(JSON.stringify(m));}catch(e){} } };
WsGuest.prototype.close=function(){ clearInterval(this.hb); try{this.hw&&this.hw.terminate();}catch(e){} try{this.ws&&(this.ws.onclose=null,this.ws.close());}catch(e){} };
async function listRooms(){ const url=serverURL(); if(!url)throw new Error('no-server'); const ws=await openWS(url,40000); ws.send(JSON.stringify({t:'list'})); try{ const r=await waitMsg(ws,['rooms'],20000); return r.list||[]; } finally{ try{ws.close();}catch(e){} } }
PB.serverURL=serverURL;
function Host(){ return serverURL()?new WsHost():new PeerHost(); }
function Guest(){ return serverURL()?new WsGuest():new PeerGuest(); }

/* ---------- снимки ---------- */
function packSnap(sim,team,st){
  const n=sim.sol.length, buf=new ArrayBuffer(n*9), dv=new DataView(buf), vis=sim.vis[team], fog=sim.fog;
  for(let i=0;i<n;i++){ const s=sim.sol[i], o=i*9;
    const v=!fog||s.team===team||vis[i];
    if(!v){ dv.setUint8(o+7,0); continue; }
    dv.setInt16(o,Math.round(s.x*16)); dv.setInt16(o+2,Math.round(s.y*16));
    dv.setUint8(o+4,((s.face+PI)/TAU*255)&255);
    dv.setUint8(o+5,s.alive?Math.max(1,Math.round(Math.max(0,s.hp)/s.maxhp*255)):0);
    dv.setUint8(o+6,1|(s.shield>0?2:0)|((s.w&7)<<2)|(s.moving?32:0)|(s.wall?64:0)|(s.alive?128:0));
    dv.setUint8(o+7,s.gone?255:Math.min(250,Math.round(s.sp/2)));
    { const ag=sim.t-s.lastAtk; dv.setUint8(o+8,ag>=2.5?255:Math.max(0,Math.round(ag*100))); }
  }
  let kf=1, wire=buf;
  if(st){ const cur=new Uint8Array(buf); st.n=st.n||0; kf=(!st.prev||st.prev.length!==cur.length||st.n%30===0)?1:0; st.n++;
    if(!kf){ const pd=new DataView(st.prev.buffer,st.prev.byteOffset,st.prev.byteLength), out=new ArrayBuffer(buf.byteLength), od=new DataView(out), ou=new Uint8Array(out);
      for(let i=0;i<n;i++){ const o=i*9; od.setInt16(o,dv.getInt16(o)-pd.getInt16(o)); od.setInt16(o+2,dv.getInt16(o+2)-pd.getInt16(o+2)); for(let k=4;k<9;k++)ou[o+k]=cur[o+k]^st.prev[o+k]; } wire=out; }
    st.prev=cur; }
  const q=[]; for(const sq of sim.squads){ if(sq.team!==team)continue; const k=sq.order.k; q.push([sq.id,k==='move'?1:k==='attack'?2:0,+sq.cx.toFixed(1),+sq.cy.toFixed(1),+sq.face.toFixed(3),sq.width,sq.run?1:0,sq.fire?1:0,sq.order.target==null?-1:sq.order.target,Math.round(sq.mor),sq.routed?1:0,sq.hf?1:0]); }
  const ev=[]; for(const e of (sim.evbuf||[])){ if(e.e==='s'){ if(!fog||e.tm===team)ev.push([1,+e.x1.toFixed(1),+e.y1.toFixed(1),+e.x2.toFixed(1),+e.y2.toFixed(1),e.k]); }
    else if(e.e==='h'||e.e==='d'){ if(!fog||vis[e.id])ev.push([e.e==='h'?2:3,+e.x.toFixed(1),+e.y.toFixed(1),e.k||0]); }
    else if(e.e==='r'){ const rq=sim.squads[e.sq]; if(rq&&rq.team===team)ev.push([4,e.sq]); }
    else if(e.e==='f')ev.push([5,+e.x.toFixed(1),+e.y.toFixed(1),e.r,e.dur]);
    else if(e.e==='i')ev.push([6,+e.x.toFixed(1),+e.y.toFixed(1),e.r]); }
  return {t:'s',kf,b:wire,tm:+sim.t.toFixed(2),ph:sim.phase,pT:+sim.phaseT.toFixed(1),pt:sim.pt,w:sim.winner,r:sim.reason,q,ev:ev.slice(-90),pl:sim.players.map(p=>[p.ready?1:0,p.gone?1:0])};
}
function undelta(sim,m){
  const u=m.b instanceof ArrayBuffer?new Uint8Array(m.b):new Uint8Array(m.b.buffer,m.b.byteOffset,m.b.byteLength);
  if(m.kf===0){ const base=sim.snapBase; if(!base||base.length!==u.length)return false; const bd=new DataView(base.buffer,base.byteOffset,base.byteLength), ud=new DataView(u.buffer,u.byteOffset,u.byteLength), n=u.length/9;
    for(let i=0;i<n;i++){ const o=i*9; bd.setInt16(o,bd.getInt16(o)+ud.getInt16(o)); bd.setInt16(o+2,bd.getInt16(o+2)+ud.getInt16(o+2)); for(let k=4;k<9;k++)base[o+k]^=u[o+k]; } m.b=base; return true; }
  sim.snapBase=new Uint8Array(u); m.b=sim.snapBase; return true;
}
function applySnap(sim,m,now){
  if(!undelta(sim,m))return [];
  const dv=new DataView(m.b.buffer?m.b.buffer.slice(m.b.byteOffset,m.b.byteOffset+m.b.byteLength):m.b), n=sim.sol.length;
  /* плавность: интервал между кадрами сглаживается, а новый отрезок начинается с того места, где боец показан сейчас (без «скачков» при неровной сети) */
  const gap=sim.snapAt?now-sim.snapAt:0; if(gap>20&&gap<1500){ sim.snapEma=sim.snapEma?sim.snapEma*0.88+gap*0.12:gap; } sim.snapIv=Math.max(90,Math.min(260,(sim.snapEma||100)*1.1));
  const A0=sim.snapAt?Math.max(0,Math.min(1.3,gap/(sim.snapIvPrev||sim.snapIv))):1; sim.snapIvPrev=sim.snapIv;
  for(let i=0;i<n;i++){ const s=sim.sol[i], o=i*9; s.px=s.px+(s.x-s.px)*A0; s.py=s.py+(s.y-s.py)*A0; s.pface=s.face;
    const fl=dv.getUint8(o+6), v=dv.getUint8(o+7)!==0||(fl&1);
    if(!(fl&1)){ s.vis=false; continue; }
    s.vis=true; s.x=dv.getInt16(o)/16; s.y=dv.getInt16(o+2)/16; s.face=dv.getUint8(o+4)/255*TAU-PI;
    const hp=dv.getUint8(o+5); s.alive=!!(fl&128)&&hp>0; s.hpf=hp/255; s.hp=s.hpf*s.maxhp; s.shield=(fl&2)?Math.max(1,s.shield):0; s.w=(fl>>2)&7; s.moving=!!(fl&32); s.wall=(fl&64)?1:0; s.sp=dv.getUint8(o+7)*2; s.gone=!hp&&dv.getUint8(o+7)===255;
    if(s.px===0&&s.py===0){s.px=s.x;s.py=s.y;s.pface=s.face;}
    if(Math.abs(s.px-s.x)>40||Math.abs(s.py-s.y)>40){s.px=s.x;s.py=s.y;}
    s.odo=(s.odo||0)+Math.hypot(s.x-s.px,s.y-s.py); { const a8=dv.getUint8(o+8); s.lastAtk=a8===255?-99:m.tm-a8/100; }
  }
  sim.t=m.tm; sim.phase=m.ph; sim.phaseT=m.pT; sim.pt=m.pt; sim.winner=m.w; sim.reason=m.r; sim.over=m.ph==='over';
  for(const o of m.q){ const sq=sim.squads[o[0]]; if(!sq)continue; if(sq.pend){ const p=sq.pend, ok=p.k==='move'?(o[1]===1&&Math.hypot(o[2]-p.x,o[3]-p.y)<2):p.k==='attack'?(o[1]===2&&o[8]===p.target):(o[1]===0); if(ok||now>p.until)sq.pend=null; else { sq.run=!!o[6];sq.fire=!!o[7]; sq.mor=o[9]==null?100:o[9]; sq.routed=!!o[10]; sq.hf=!!o[11]; continue; } } sq.order={k:o[1]===1?'move':o[1]===2?'attack':'hold',target:o[8]}; sq.cx=o[2];sq.cy=o[3];sq.face=o[4];sq.width=o[5];sq.run=!!o[6];sq.fire=!!o[7]; sq.mor=o[9]==null?100:o[9]; sq.routed=!!o[10]; sq.hf=!!o[11]; }
  m.pl.forEach((p,i)=>{ if(sim.players[i]){sim.players[i].ready=!!p[0];sim.players[i].gone=!!p[1];} });
  for(const sq of sim.squads){ let c=0,sx=0,sy=0; for(const s of sq.soldiers){ if(s.alive&&s.vis!==false){c++;sx+=s.x;sy+=s.y;} } let na=0; for(const s of sq.soldiers)if(s.alive)na++; sq.nAlive=na; sq.nVis=c; if(c){sq.mx=sx/c;sq.my=sy/c;} }
  sim.snapAt=now;
  return m.ev;
}
Object.assign(PB,{listRooms,Host,Guest,packSnap,applySnap,makeCode,loadPeer,unpackBin,inbound,zipMsg});
})(typeof window!=='undefined'?window:globalThis);
