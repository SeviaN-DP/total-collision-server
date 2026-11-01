/* Total Collision — рейтинговый бой 1 на 1: очередь, подтверждение, выбор армии, расчёт боя на сервере, рейтинг и история. */
'use strict';
function req(local,alt){ try{ return require(local); }catch(e){ return require(alt); } }
const PB=req('./core.js','../src/core.js'); PB.t=PB.t||(x=>x); req('./net.js','../src/net.js');
const bal=req('./balance.json','../src/balance.json');
const G=bal.global, NEED=G.squadsPerPlayer['1v1'], LIM=G.limits['1v1'];
const CANON=Object.keys(bal.units).filter(k=>bal.units[k].cat==='canon');
const ACCEPT_MS=+process.env.RANKED_ACCEPT_MS||15000, PICK_MS=+process.env.RANKED_PICK_MS||40000, HIST_MAX=30;
const MAX_ACTIVE=+process.env.RANKED_MAX||6;
const GOPTS={mapSize:1000,fog:!!G.fog,morale:G.morale!==false,battleTime:G.battleTime,deployTime:G.deployTime,zonePct:G.zonePct,squadScale:G.squadScale,budgetPerSquad:G.budgetPerSquad,terrain:Object.assign({},G.terrain)};
const OPTS_PUB={mode:'1v1',need:NEED,lim:LIM,ver:bal.version};
let api=null; const queue=[]; const matches=new Map(); const userMatch=new Map(); let mseq=0;
const send=(uid,o)=>api.sendTo(uid,o);
const urec=uid=>api.users[uid];

function packFrame(m){ const h=Object.assign({},m); const b=Buffer.from(m.b instanceof ArrayBuffer?new Uint8Array(m.b):new Uint8Array(m.b.buffer,m.b.byteOffset,m.b.byteLength)); delete h.b;
  const hb=Buffer.from(JSON.stringify(h)), out=Buffer.alloc(4+hb.length+b.length); out.writeUInt32BE(hb.length,0); hb.copy(out,4); b.copy(out,4+hb.length); return out; }

/* ---------- армии ---------- */
function clean(c){ const out={}; let n=0; if(c&&typeof c==='object'){ for(const k of Object.keys(c)){ if(!CANON.includes(k))continue; let v=c[k]|0; if(v<=0)continue; v=Math.min(v,LIM,NEED-n); if(v<=0)break; out[k]=v; n+=v; } } return out; }
const total=c=>Object.values(c).reduce((a,b)=>a+b,0);
function fill(c){ c=Object.assign({},c); let g=0; while(total(c)<NEED&&g++<500){ const ok=CANON.filter(k=>(c[k]||0)<LIM); if(!ok.length)break; const k=ok[Math.floor(Math.random()*ok.length)]; c[k]=(c[k]||0)+1; } return c; }
const toList=c=>{ const a=[]; for(const k in c)for(let i=0;i<c[k];i++)a.push({unit:k}); return a; };

/* ---------- очередь ---------- */
function qn(){ for(const uid of queue)send(uid,{t:'rqn',n:queue.length}); }
function inQueue(uid){ return queue.includes(uid); }
function leaveQueue(uid){ const i=queue.indexOf(uid); if(i>=0){ queue.splice(i,1); qn(); return true; } return false; }
function joinQueue(uid){ if(inQueue(uid)||userMatch.has(uid))return; queue.push(uid); send(uid,{t:'rqn',n:queue.length}); qn(); tick(); }
function tick(){
  while(queue.length>=2&&matches.size<MAX_ACTIVE){
    const a=queue[0]; let b=null,bd=1e9; for(let i=1;i<queue.length;i++){ const d=Math.abs((urec(a).rating|0)-(urec(queue[i]).rating|0)); if(d<bd){bd=d;b=queue[i];} }
    queue.splice(queue.indexOf(b),1); queue.shift(); mk(a,b); }
  qn();
}
setInterval(tick,1000);

/* ---------- матч ---------- */
function pinfo(uid){ const u=urec(uid); return {id:uid,nick:u.nick,rating:u.rating|0}; }
function mk(a,b){
  const m={id:++mseq,state:'accept',until:Date.now()+ACCEPT_MS,ps:[a,b].map(uid=>({uid,acc:false,counts:{},ready:false})),sim:null,acc:0,last:Date.now(),tick:0};
  matches.set(m.id,m); for(const p of m.ps)userMatch.set(p.uid,m.id);
  for(const p of m.ps)send(p.uid,{t:'rfound',mid:m.id,ms:ACCEPT_MS});
  m.timer=setTimeout(()=>acceptTimeout(m),ACCEPT_MS+300);
}
function dropMatch(m){ clearTimeout(m.timer); matches.delete(m.id); for(const p of m.ps)if(userMatch.get(p.uid)===m.id)userMatch.delete(p.uid); }
function cancelAccept(m,badUid){ // отказавший уходит, принявший возвращается в очередь
  if(m.state!=='accept')return; dropMatch(m);
  for(const p of m.ps){ if(badUid?p.uid===badUid:!p.acc){ send(p.uid,{t:'rcancel',why:p.uid===badUid?'self':'timeout'}); } else { send(p.uid,{t:'rcancel',why:'opp',requeue:true}); queue.unshift(p.uid); } }
  qn(); tick();
}
function acceptTimeout(m){ if(m.state==='accept')cancelAccept(m,null); }
function accept(uid){ const m=matches.get(userMatch.get(uid)); if(!m||m.state!=='accept')return; const p=m.ps.find(x=>x.uid===uid); p.acc=true; send(uid,{t:'rwait'});
  if(m.ps.every(x=>x.acc)){ clearTimeout(m.timer); m.state='pick'; m.until=Date.now()+PICK_MS; for(const q of m.ps)sendPick(m,q); m.timer=setTimeout(()=>startBattle(m),PICK_MS+200); } }
function sendPick(m,p){ const o=m.ps.find(x=>x!==p); send(p.uid,{t:'rpick',mid:m.id,ms:Math.max(0,m.until-Date.now()),opts:OPTS_PUB,opp:pinfo(o.uid),c:p.counts,ready:p.ready}); }
function setArmy(uid,c){ const m=matches.get(userMatch.get(uid)); if(!m||m.state!=='pick')return; const p=m.ps.find(x=>x.uid===uid); p.counts=clean(c); if(p.ready&&total(p.counts)<NEED)p.ready=false; }
function setReady(uid,v){ const m=matches.get(userMatch.get(uid)); if(!m||m.state!=='pick')return; const p=m.ps.find(x=>x.uid===uid); p.ready=!!v&&total(p.counts)===NEED; send(uid,{t:'rrdy',v:p.ready});
  if(m.ps.every(x=>x.ready)){ clearTimeout(m.timer); startBattle(m); } }
function startBattle(m){
  if(m.state!=='pick')return; clearTimeout(m.timer); m.state='battle';
  for(const p of m.ps)p.army=fill(p.counts); // пустые места добираются случайно, выбранное остаётся
  const sw=Math.random()<0.5; const order=sw?[m.ps[1],m.ps[0]]:m.ps; m.order=order; // order[i] — игрок с индексом i в бою
  const players=order.map((p,i)=>({name:urec(p.uid).nick,team:i})), armies=order.map(p=>toList(p.army)); const seed=1+Math.floor(Math.random()*1e9);
  m.sim=PB.createSim(bal,GOPTS,players,armies,seed); m.sim.evbuf=[]; m.start={opts:GOPTS,players,armies,seed};
  for(const p of m.ps)send(p.uid,{t:'rinit',opts:GOPTS,players,armies,seed,you:order.indexOf(p),opp:pinfo(m.ps.find(x=>x!==p).uid)});
  m.last=Date.now(); m.acc=0;
}
function idxOf(m,uid){ return m.order.findIndex(p=>p.uid===uid); }
function broadcast(m){
  const sim=m.sim, cache={}; sim.snapAt=0;
  m.order.forEach((p,i)=>{ const tm=sim.players[i].team; if(!cache[tm])cache[tm]=packFrame(PB.packSnap(sim,tm)); api.sendBin(p.uid,cache[tm]); }); sim.evbuf=[];
}
function stepAll(){
  const now=Date.now();
  for(const m of matches.values()){ if(m.state!=='battle'||!m.sim)continue; const sim=m.sim;
    m.acc+=Math.min(0.5,(now-m.last)/1000); m.last=now; let n=0;
    while(m.acc>=sim.DT&&n<6&&sim.phase!=='over'){ m.acc-=sim.DT; n++; try{ sim.step(); }catch(e){ console.error('sim error',e.message); m.acc=0; sim.phase='over'; break; } m.tick++;
      if(sim.events.length){ sim.evbuf.push(...sim.events); if(sim.evbuf.length>200)sim.evbuf.splice(0,sim.evbuf.length-200); sim.events.length=0; }
      if(m.tick%2===0)broadcast(m); }
    if(sim.phase==='over')finish(m); }
}
setInterval(stepAll,50);
function finish(m){
  if(m.state!=='battle')return; m.state='done'; const sim=m.sim; broadcast(m);
  const st=sim.stats(), w=sim.winner;
  m.order.forEach((p,i)=>{ const u=urec(p.uid), tm=sim.players[i].team, o=m.order[1-i], res=w<0?'d':(w===tm?'w':'l'), delta=res==='w'?1:res==='l'?-1:0;
    u.rating=(u.rating|0)+delta; u.w=(u.w|0)+(res==='w'?1:0); u.l=(u.l|0)+(res==='l'?1:0); u.d=(u.d|0)+(res==='d'?1:0);
    u.hist=u.hist||[]; const hid=(u.hist.length?u.hist[u.hist.length-1].hid:0)+1;
    const ent={hid,ts:Date.now(),mode:'rank',res,delta,rating:u.rating,reason:sim.reason,dur:Math.round(sim.t),me:i,opp:pinfo(o.uid),a:p.army,b:o.army,st};
    u.hist.push(ent); if(u.hist.length>HIST_MAX)u.hist.splice(0,u.hist.length-HIST_MAX);
    send(p.uid,{t:'rend',res,delta,rating:u.rating,reason:sim.reason,winner:w,stats:st,me:i,hid}); });
  api.save(); for(const p of m.order)api.pushState(p.uid);
  for(const p of m.ps)if(userMatch.get(p.uid)===m.id)userMatch.delete(p.uid);
  setTimeout(()=>matches.delete(m.id),60000); tick();
}


/* ---------- история обычных боёв (лобби) ----------
   Участники сами сообщают «я в комнате CODE» (nin), хост — состав при старте (nbeg) и итог (nend).
   Запись получают все участники с аккаунтом, включая вышедших; бой без итога (хост ушёл) — «прервано». */
const nrooms=new Map(), nbat=new Map();
const UNITS=bal.units;
function cleanCounts(c){ const o={}; if(c&&typeof c==='object'){ for(const k of Object.keys(c)){ if(!UNITS[k])continue; const v=Math.min(999,c[k]|0); if(v>0)o[k]=v; } } return o; }
function nin(uid,m){ const c=String(m.code||'').toUpperCase().slice(0,8); if(c.length<4)return;
  let r=nrooms.get(c); if(!r){ r={m:new Map(),ts:0}; nrooms.set(c,r); } r.ts=Date.now(); r.m.set(uid,String(m.name||'').slice(0,24));
  if(nrooms.size>400){ const old=Date.now()-6*3600*1000; for(const [k,v] of nrooms)if(v.ts<old)nrooms.delete(k); } }
function nout(uid,m){ const r=nrooms.get(String(m.code||'').toUpperCase()); if(r)r.m.delete(uid); }
function nbeg(uid,m){ const code=String(m.code||'').toUpperCase().slice(0,8), r=nrooms.get(code); if(!r||!r.m.has(uid)||!Array.isArray(m.players))return;
  const players=m.players.slice(0,8).map(p=>({name:String(p&&p.name||'').slice(0,24),team:(p&&p.team|0),human:!!(p&&p.human)}));
  if(players.filter(p=>p.human).length<2)return;
  const armies=players.map((p,i)=>cleanCounts(m.armies&&m.armies[i])); const used=new Set(), parts=[];
  players.forEach((p,i)=>{ if(!p.human)return; for(const [u,nm] of r.m){ if(!used.has(u)&&nm===p.name){ used.add(u); parts.push({uid:u,i}); break; } } });
  if(!parts.some(x=>x.uid===uid))return;
  nbat.set(code,{host:uid,ts:Date.now(),players,armies,parts}); nrooms.delete(code); }
function nfinish(code,m,aborted){ const b=nbat.get(code); if(!b)return; nbat.delete(code);
  let st=null; if(!aborted&&Array.isArray(m.st)&&JSON.stringify(m.st).length<80000)st=m.st;
  const w=(!aborted&&m.winner!=null)?(m.winner|0):-1, ids=b.players.map((p,i)=>{ const x=b.parts.find(q=>q.i===i); return x?x.uid:0; });
  for(const pt of b.parts){ const u=urec(pt.uid); if(!u)continue; const me=b.players[pt.i], tm=me.team;
    const res=aborted?'x':(w<0?'d':(w===tm?'w':'l'));
    const foes=b.players.map((p,i)=>i).filter(i=>b.players[i].team!==tm), f0=foes.find(i=>ids[i])||foes[0], oc={}; for(const i of foes)for(const k in b.armies[i])oc[k]=(oc[k]||0)+b.armies[i][k];
    u.hist=u.hist||[]; const hid=(u.hist.length?u.hist[u.hist.length-1].hid:0)+1;
    const opp=f0!=null?{id:ids[f0]||0,nick:b.players[f0].name}:{id:0,nick:'—'};
    u.hist.push({hid,ts:Date.now(),mode:'norm',res,delta:0,rating:u.rating|0,reason:aborted?'abort':String(m.reason||'').slice(0,20),dur:Math.max(0,Math.min(99999,m.dur|0)),me:pt.i,opp,a:b.armies[pt.i],b:oc,st,ids,pl:b.players.map(p=>({name:p.name,team:p.team}))});
    if(u.hist.length>HIST_MAX)u.hist.splice(0,u.hist.length-HIST_MAX); }
  api.save(); for(const pt of b.parts)api.pushState(pt.uid); }
function nend(uid,m){ const code=String(m.code||'').toUpperCase(), b=nbat.get(code); if(!b||b.host!==uid)return; nfinish(code,m,!!m.abort); }
function nhostGone(uid){ for(const [code,b] of [...nbat])if(b.host===uid)nfinish(code,{},true); }

/* ---------- входящие сообщения ---------- */
function histBrief(e){ return {hid:e.hid,ts:e.ts,mode:e.mode,res:e.res,delta:e.delta,rating:e.rating,opp:e.opp,a:e.a,b:e.b,dur:e.dur}; }
function message(me,ws,m){
  const uid=me.id;
  switch(m.t){
    case 'rq': {
      if(!m.on){ leaveQueue(uid); send(uid,{t:'rqn',n:0,off:true}); return; }
      if(m.ver!==bal.version){ send(uid,{t:'rerr',e:'ver',v:bal.version}); return; }
      if(userMatch.has(uid)){ send(uid,{t:'rerr',e:'busy'}); return; }
      joinQueue(uid); return; }
    case 'nin': nin(uid,m); return;
    case 'nout': nout(uid,m); return;
    case 'nbeg': nbeg(uid,m); return;
    case 'nend': nend(uid,m); return;
    case 'racc': accept(uid); return;
    case 'rdec': { const m2=matches.get(userMatch.get(uid)); if(m2&&m2.state==='accept')cancelAccept(m2,uid); return; }
    case 'rarmy': setArmy(uid,m.c); return;
    case 'rrdy': setReady(uid,m.v!==false); return;
    case 'ro': case 'rp': case 'rr': case 'rs': {
      const mm=matches.get(userMatch.get(uid)); if(!mm||mm.state!=='battle')return; const i=idxOf(mm,uid); if(i<0)return; const sim=mm.sim;
      try{
        if(m.t==='ro'){ const q=sim.squads[m.sq|0]; if(q&&q.owner===i&&m.o&&typeof m.o==='object')sim.order(q.id,m.o); }
        else if(m.t==='rp'){ const q=sim.squads[m.sq|0]; if(q&&q.owner===i)sim.place(q.id,+m.cx,+m.cy,+m.face,m.w|0); }
        else if(m.t==='rr')sim.setReady(i,true);
        else if(m.t==='rs')sim.surrender(i);
      }catch(e){} return; }
    case 'prof': { const id=+m.id, u=urec(id); if(!u){ send(uid,{t:'prof',id,none:true}); return; }
      send(uid,{t:'prof',id:u.id,nick:u.nick,online:api.isOnline(u.id),busy:userMatch.has(u.id),queue:inQueue(u.id),rating:u.rating|0,w:u.w|0,l:u.l|0,d:u.d|0,created:u.created,rel:api.relOf(me,u.id),hist:(u.hist||[]).slice(-20).reverse().map(histBrief)}); return; }
    case 'hres': { const u=urec(+m.id); const e=u&&(u.hist||[]).find(x=>x.hid===(m.hid|0)); if(e)send(uid,{t:'hres',id:u.id,nick:u.nick,e}); return; }
  }
}
/* ---------- события аккаунтов ---------- */
function attach(uid){ // вошёл или обновил страницу
  const mid=userMatch.get(uid), m=mid&&matches.get(mid);
  if(inQueue(uid))send(uid,{t:'rqn',n:queue.length});
  if(!m)return; const p=m.ps.find(x=>x.uid===uid);
  if(m.state==='accept'){ if(p.acc)send(uid,{t:'rwait'}); else send(uid,{t:'rfound',mid:m.id,ms:Math.max(500,m.until-Date.now())}); }
  else if(m.state==='pick')sendPick(m,p);
  else if(m.state==='battle'){ const s=m.start; send(uid,{t:'rinit',opts:s.opts,players:s.players,armies:s.armies,seed:s.seed,you:idxOf(m,uid),opp:pinfo(m.ps.find(x=>x!==p).uid),resume:true}); }
}
function offline(uid){ nhostGone(uid); leaveQueue(uid); const m=matches.get(userMatch.get(uid)); if(m&&m.state==='accept')cancelAccept(m,uid); }
function status(uid){ return userMatch.has(uid)?'match':inQueue(uid)?'queue':''; }
function init(a){ api=a; }
module.exports={init,message,attach,offline,status,version:bal.version};
