/* Total Collision — аккаунты, друзья и личные сообщения.
   Данные лежат в папке DATA_DIR (на Render это постоянный диск /data), обычными JSON-файлами.
   Записи атомарные: сначала во временный файл, потом переименование. */
'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto');
let Ranked=null; try{ Ranked=require('./ranked.js'); }catch(e){ console.error('Рейтинговый режим отключён:',e.message); }
function pickDir(){ if(process.env.DATA_DIR)return process.env.DATA_DIR; try{ fs.accessSync('/data',fs.constants.W_OK); return '/data'; }catch(e){} return path.join(__dirname,'data'); }
const DATA_DIR=pickDir();
const DM_DIR=path.join(DATA_DIR,'dm');
try{ fs.mkdirSync(DM_DIR,{recursive:true}); }catch(e){ console.error('DATA_DIR error',e.message); }
console.log('Данные аккаунтов: '+DATA_DIR);

const NICK_RE=/^[\p{L}\p{N}_\- ]{3,16}$/u;
const MAX_DM=1000, MAX_TEXT=500, FIRST_ID=100001;
const TOKEN_TTL=400*24*3600*1000;

/* ---------- хранилище ---------- */
const db={nextId:FIRST_ID,users:{},tokens:{}};
function readJSON(f,def){ try{ return JSON.parse(fs.readFileSync(f,'utf8')); }catch(e){ return def; } }
function writeAtomic(f,obj){ const tmp=f+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(obj)); fs.renameSync(tmp,f); }
{ const u=readJSON(path.join(DATA_DIR,'users.json'),null); if(u){ db.nextId=u.nextId||FIRST_ID; db.users=u.users||{}; }
  db.tokens=readJSON(path.join(DATA_DIR,'tokens.json'),{}); }
const byNick=new Map(); for(const u of Object.values(db.users))byNick.set(u.nl,u.id);
let dirtyU=false, dirtyT=false; const dmCache=new Map(), dmDirty=new Set();
function flush(){
  try{ if(dirtyU){ writeAtomic(path.join(DATA_DIR,'users.json'),{nextId:db.nextId,users:db.users}); dirtyU=false; }
    if(dirtyT){ writeAtomic(path.join(DATA_DIR,'tokens.json'),db.tokens); dirtyT=false; }
    for(const k of dmDirty){ writeAtomic(path.join(DM_DIR,k+'.json'),dmCache.get(k)||[]); } dmDirty.clear(); }
  catch(e){ console.error('flush error',e.message); }
}
setInterval(flush,1500);
const saveU=()=>{dirtyU=true;}, saveT=()=>{dirtyT=true;};
const pairKey=(a,b)=>a<b?a+'_'+b:b+'_'+a;
function dmList(a,b){ const k=pairKey(a,b); let l=dmCache.get(k); if(!l){ l=readJSON(path.join(DM_DIR,k+'.json'),[]); dmCache.set(k,l); } return l; }
setInterval(()=>{ if(dmCache.size>300){ for(const k of dmCache.keys()){ if(!dmDirty.has(k))dmCache.delete(k); if(dmCache.size<=150)break; } } },60000);

/* ---------- помощники ---------- */
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const send=(ws,o)=>{ if(ws.readyState===1){ try{ws.send(JSON.stringify(o));}catch(e){} } };
const online=new Map(); // id -> Set(ws)
const isOnline=id=>{ const s=online.get(id); return !!(s&&s.size); };
function onlineCount(){ return online.size; }
function ipOf(req){ const f=req&&req.headers&&req.headers['x-forwarded-for']; return (f?String(f).split(',')[0].trim():(req&&req.socket&&req.socket.remoteAddress))||'?'; }
const hits=new Map(); // ip -> [t,...]
function limited(key,max,winMs){ const now=Date.now(); let a=hits.get(key)||[]; a=a.filter(t=>now-t<winMs); a.push(now); hits.set(key,a); return a.length>max; }
setInterval(()=>{ const now=Date.now(); for(const [k,a] of hits){ if(!a.length||now-a[a.length-1]>3600e3)hits.delete(k); } },600e3);
function hashPass(pass,salt){ return new Promise((res,rej)=>crypto.scrypt(pass,salt,32,(e,k)=>e?rej(e):res(k.toString('hex')))); }
function newToken(uid){ const t=crypto.randomBytes(32).toString('hex'); db.tokens[sha(t)]={uid,created:Date.now(),last:Date.now()}; saveT(); return t; }
function userByToken(t){ const h=sha(String(t||'')); const r=db.tokens[h]; if(!r)return null; if(Date.now()-r.last>TOKEN_TTL){ delete db.tokens[h]; saveT(); return null; } const u=db.users[r.uid]; if(!u)return null; if(Date.now()-r.last>3600e3){ r.last=Date.now(); saveT(); } return u; }
const pub=u=>({id:u.id,nick:u.nick});
const relOf=(me,id)=>me.id===id?'me':me.friends.includes(id)?'friend':me.reqIn.includes(id)?'in':me.reqOut.includes(id)?'out':'none';
function unreadOf(me,fid){ const l=dmList(me.id,fid), rd=(me.read&&me.read[fid])||0; let n=0; for(let i=l.length-1;i>=0;i--){ const m=l[i]; if(m.ts<=rd)break; if(m.from===fid)n++; } return n; }
function stateFor(me){
  const friends=me.friends.map(id=>db.users[id]).filter(Boolean).map(u=>({id:u.id,nick:u.nick,online:isOnline(u.id),unread:unreadOf(me,u.id)}));
  const reqIn=me.reqIn.map(id=>db.users[id]).filter(Boolean).map(pub), reqOut=me.reqOut.map(id=>db.users[id]).filter(Boolean).map(pub);
  return {t:'state',me:Object.assign(pub(me),{rating:me.rating|0,w:me.w|0,l:me.l|0,d:me.d|0}),friends,reqIn,reqOut,favs:me.favs||[],rk:Ranked?Ranked.status(me.id):'',rkv:Ranked?Ranked.version:''};
}
function pushState(id){ const u=db.users[id], s=online.get(id); if(!u||!s)return; const st=stateFor(u); for(const w of s)send(w,st); }
function pushPresence(me){ for(const fid of me.friends){ const s=online.get(fid); if(!s)continue; for(const w of s)send(w,{t:'presence',id:me.id,online:isOnline(me.id)}); } }
function attach(ws,u){
  ws.uid=u.id; let s=online.get(u.id); if(!s){s=new Set();online.set(u.id,s);} const first=s.size===0; s.add(ws);
  send(ws,stateFor(u)); if(first)pushPresence(u); if(Ranked)Ranked.attach(u.id);
}
function closed(ws){ if(!ws.uid)return; const s=online.get(ws.uid); if(!s)return; s.delete(ws); if(!s.size){ online.delete(ws.uid); const u=db.users[ws.uid]; if(u)pushPresence(u); if(Ranked)Ranked.offline(ws.uid); } }

/* ---------- вход ---------- */
function handshake(ws,m,req){
  const ip=ipOf(req);
  if(m.t==='auth'){
    if(limited('a'+ip,60,60e3)){ send(ws,{t:'autherr',e:'rate'}); ws.close(); return true; }
    const u=userByToken(m.token); if(!u){ send(ws,{t:'autherr',e:'token'}); ws.close(); return true; }
    send(ws,{t:'authok'}); wire(ws); attach(ws,u); return true;
  }
  if(m.t==='register'||m.t==='login'){
    if(limited('r'+ip,m.t==='register'?8:25,10*60e3)){ send(ws,{t:'autherr',e:'rate'}); ws.close(); return true; }
    const nick=String(m.nick||'').trim().replace(/\s+/g,' '), pass=String(m.pass||'');
    if(m.t==='register'){
      if(!NICK_RE.test(nick)){ send(ws,{t:'autherr',e:'nick'}); ws.close(); return true; }
      if(pass.length<6||pass.length>64){ send(ws,{t:'autherr',e:'pass'}); ws.close(); return true; }
      const nl=nick.toLocaleLowerCase(); if(byNick.has(nl)){ send(ws,{t:'autherr',e:'taken'}); ws.close(); return true; }
      const salt=crypto.randomBytes(16).toString('hex'); byNick.set(nl,-1); // бронь ника на время расчёта хеша
      hashPass(pass,salt).then(hash=>{
        const id=db.nextId++; const u={id,nick,nl,salt,hash,created:Date.now(),friends:[],reqIn:[],reqOut:[],read:{}};
        db.users[id]=u; byNick.set(nl,id); saveU(); flush();
        send(ws,{t:'authok',token:newToken(id)}); wire(ws); attach(ws,u);
      }).catch(()=>{ byNick.delete(nl); send(ws,{t:'autherr',e:'srv'}); ws.close(); });
      return true;
    }
    const uid=byNick.get(nick.toLocaleLowerCase()), u=uid>0?db.users[uid]:null;
    if(!u){ hashPass(pass,'x').finally(()=>{ send(ws,{t:'autherr',e:'bad'}); ws.close(); }); return true; }
    if(limited('f'+u.id,10,10*60e3)){ send(ws,{t:'autherr',e:'rate'}); ws.close(); return true; }
    hashPass(pass,u.salt).then(h=>{
      const a=Buffer.from(h,'hex'), b=Buffer.from(u.hash,'hex');
      if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){ send(ws,{t:'autherr',e:'bad'}); ws.close(); return; }
      send(ws,{t:'authok',token:newToken(u.id)}); wire(ws); attach(ws,u);
    }).catch(()=>{ send(ws,{t:'autherr',e:'srv'}); ws.close(); });
    return true;
  }
  return false;
}
function wire(ws){ ws.acctReady=true; ws.mc=[]; }

/* ---------- сообщения после входа ---------- */
function message(ws,data,isBin){
  if(isBin||!ws.uid)return; const txt=data.toString(); if(txt.length>4000)return;
  const now=Date.now(); ws.mc=ws.mc.filter(t=>now-t<5000); ws.mc.push(now); if(ws.mc.length>160){ send(ws,{t:'err',e:'rate'}); return; }
  let m; try{m=JSON.parse(txt);}catch(e){return;} const me=db.users[ws.uid]; if(!me)return;
  switch(m.t){
    case 'ping': return;
    case 'search': {
      const q=String(m.q||'').trim().slice(0,24); if(!q){ send(ws,{t:'results',q,list:[]}); return; }
      const out=[]; const seen=new Set(); const push=u=>{ if(!u||seen.has(u.id)||out.length>=20)return; seen.add(u.id); out.push({id:u.id,nick:u.nick,online:isOnline(u.id),rel:relOf(me,u.id)}); };
      if(/^\d{1,12}$/.test(q))push(db.users[+q]);
      const ql=q.toLocaleLowerCase(); if(ql.length>=2){ for(const u of Object.values(db.users)){ if(u.nl.startsWith(ql))push(u); if(out.length>=20)break; } }
      send(ws,{t:'results',q,list:out}); return; }
    case 'freq': { const id=+m.id; const o=db.users[id]; if(!o||o.id===me.id||me.friends.includes(id))return;
      if(me.reqIn.includes(id)){ befriend(me,o); return; }
      if(!me.reqOut.includes(id)){ if(me.reqOut.length>=50)return; me.reqOut.push(id); o.reqIn.push(me.id); saveU(); pushState(me.id); pushState(o.id); } return; }
    case 'faccept': { const id=+m.id,o=db.users[id]; if(o&&me.reqIn.includes(id))befriend(me,o); return; }
    case 'fdecline': { const id=+m.id,o=db.users[id]; if(!o)return; const a=me.reqIn.length+me.reqOut.length;
      me.reqIn=me.reqIn.filter(x=>x!==id); me.reqOut=me.reqOut.filter(x=>x!==id); o.reqIn=o.reqIn.filter(x=>x!==me.id); o.reqOut=o.reqOut.filter(x=>x!==me.id); saveU(); pushState(me.id); pushState(o.id); return; }
    case 'fremove': { const id=+m.id,o=db.users[id]; if(!o)return; me.friends=me.friends.filter(x=>x!==id); o.friends=o.friends.filter(x=>x!==me.id); saveU(); pushState(me.id); pushState(o.id); return; }
    case 'hist': { const id=+m.with; if(!me.friends.includes(id))return; const l=dmList(me.id,id); send(ws,{t:'hist',with:id,msgs:l.slice(-100)}); markRead(me,id); return; }
    case 'read': { const id=+m.with; if(me.friends.includes(id))markRead(me,id); return; }
    case 'dm': { const id=+m.to, o=db.users[id]; const text=String(m.text||'').replace(/\s+/g,' ').trim().slice(0,MAX_TEXT); if(!o||!text||!me.friends.includes(id))return;
      const l=dmList(me.id,id); const msg={id:(l.length?l[l.length-1].id:0)+1,from:me.id,to:id,text,ts:Date.now()}; l.push(msg); if(l.length>MAX_DM)l.splice(0,l.length-MAX_DM);
      dmDirty.add(pairKey(me.id,id));
      for(const w of online.get(me.id)||[])send(w,{t:'dm',m:msg}); for(const w of online.get(id)||[])send(w,{t:'dm',m:msg}); return; }
    case 'favs': { if(!Array.isArray(m.list))return; me.favs=m.list.filter(x=>typeof x==='string'&&/^[A-Za-z0-9_]{1,24}$/.test(x)).slice(0,60); saveU(); return; }
    case 'logout': { const h=sha(String(m.token||'')); if(db.tokens[h]&&db.tokens[h].uid===me.id){ delete db.tokens[h]; saveT(); } send(ws,{t:'bye'}); ws.close(); return; }
    default: if(Ranked)Ranked.message(me,ws,m);
  }
}
function markRead(me,id){ const l=dmList(me.id,id); const last=l.length?l[l.length-1].ts:0; me.read=me.read||{}; if((me.read[id]||0)<last){ me.read[id]=last; saveU(); } pushState(me.id); }
function befriend(a,b){
  a.reqIn=a.reqIn.filter(x=>x!==b.id); a.reqOut=a.reqOut.filter(x=>x!==b.id); b.reqIn=b.reqIn.filter(x=>x!==a.id); b.reqOut=b.reqOut.filter(x=>x!==a.id);
  if(!a.friends.includes(b.id))a.friends.push(b.id); if(!b.friends.includes(a.id))b.friends.push(a.id); saveU(); pushState(a.id); pushState(b.id);
}

if(Ranked)Ranked.init({users:db.users,save:saveU,isOnline,relOf,pushState,
  sendTo:(uid,o)=>{ const s=online.get(uid); if(s)for(const w of s)send(w,o); },
  sendBin:(uid,buf)=>{ const s=online.get(uid); if(s)for(const w of s){ if(w.readyState===1){ try{w.send(buf,{binary:true});}catch(e){} } } }});
module.exports={handshake,message,closed,flush,onlineCount};
