/* ===== Поле брани: ядро (карта + побойцовый движок). Работает и в браузере, и в Node ===== */
(function(root){
'use strict';
const TAU=Math.PI*2, PI=Math.PI;
function rng(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function angDiff(a,b){let d=a-b;while(d>PI)d-=TAU;while(d<-PI)d+=TAU;return d}
function clamp(v,a,b){return v<a?a:v>b?b:v}
function merge(base,over){ // глубокое слияние настроек лобби поверх базового баланса
  const o=Array.isArray(base)?base.slice():Object.assign({},base);
  if(!over)return o;
  for(const k in over){ if(over[k]&&typeof over[k]==='object'&&!Array.isArray(over[k])&&base&&typeof base[k]==='object')o[k]=merge(base[k],over[k]); else o[k]=over[k]; }
  return o;
}

/* ---------------------------------- КАРТА ---------------------------------- */
function blobR(q,a){const s=q.sh; if(!s)return q.r; return q.r*(1+s[0]*Math.sin(2*a+s[1])+s[2]*Math.sin(3*a+s[3])+s[4]*Math.sin(5*a+s[5]));}
function inBlob(q,x,y){const dx=x-q.x,dy=y-q.y,d2=dx*dx+dy*dy,rr=q.r*1.45; if(d2>rr*rr)return false; const R=blobR(q,Math.atan2(dy,dx)); return d2<R*R;}
function genMap(S,g,seed){
  const r=rng(seed*7919+13), T=g.terrain;
  const m={size:S,seed,roads:[],rects:[],rocks:[],ridges:0,swamps:[],grass:[],bridges:[],rivers:[],fords:[]};
  const R=Math.max(g.pointRadiusMin,S*g.pointRadiusK);
  m.point={x:S/2,y:S/2,r:R};
  const zoneH=S*g.zonePct/100; m.zoneH=zoneH;
  const k=S/1000, dens=T.density||1;
  let area=0; const maxArea=S*S*(1-(T.flatMin==null?0.4:T.flatMin));
  const mir=(f)=>{f();};
  const shp=(a2,a3,a5)=>[a2*(.5+r()),r()*TAU,a3*(.5+r()),r()*TAU,a5*(.5+r()),r()*TAU];
  const mirSh=s=>[s[0],s[1]+2*PI,s[2],s[3]+3*PI,s[4],s[5]+5*PI];
  function inNeutral(y,rad){return y-rad>=zoneH+2&&y+rad<=S-zoneH-2}
  function farFromPoint(x,y,rad){return Math.hypot(x-S/2,y-S/2)>R*2.5+rad}
  // реки: извилистые, наклонные, две центрально-симметричные (по одной в каждой половине)
  const rhw=Math.max(3,0.006*S);
  const useRivers=T.rivers&&S>=750;
  const riverF=[]; let bhMax=0;
  if(useRivers){
    const bh=Math.max(4,5*Math.max(1,k)); bhMax=bh;
    const lo=zoneH+rhw+bh+8, hi=S/2-R*1.6-rhw-bh-8, avail=Math.max(10,hi-lo);
    const tilt=(r()-0.5)*2*0.3*S*(r()<0.35?0.15:1), A1=(0.012+0.02*r())*S, A2=(0.004+0.006*r())*S;
    const w1=TAU/(S*(0.5+0.35*r())), w2=TAU/(S*(0.18+0.12*r())), p1=r()*TAU, p2=r()*TAU;
    const raw=x=>tilt*(x/S-0.5)+A1*Math.sin(x*w1+p1)+A2*Math.sin(x*w2+p2);
    let gmin=1e9,gmax=-1e9; for(let x=0;x<=S;x+=5){const v=raw(x);if(v<gmin)gmin=v;if(v>gmax)gmax=v;}
    const span=Math.max(1e-6,gmax-gmin), sc=Math.min(1,avail/span), off=r()*(avail-span*sc);
    const f0=x=>lo+off+(raw(x)-gmin)*sc;
    const fB=x=>S-f0(S-x);
    riverF.push(f0,fB);
    const nb=S>=1500?4:3;
    const bx=[];for(let i=0;i<nb;i++)bx.push(S*(0.12+0.76*(i+0.15+r()*0.7)/nb));
    riverF.forEach((f,ri)=>{
      const rv={y:f(S/2),hw:rhw,f,ri}; m.rivers.push(rv);
      const xs=(ri===0?bx:bx.map(x=>S-x)).slice().sort((a,b)=>a-b);
      if(T.bridges){
        xs.forEach(x=>{const y=f(x);m.bridges.push({x,y,hw:bh,rhw,ri,ang:Math.atan2(f(x+2)-f(x-2),4)});});
        const st=Math.max(5,rhw*1.2);
        for(let x0=0;x0<S;x0+=st){ const x1=Math.min(S,x0+st), mx=(x0+x1)/2;
          if(xs.some(bxx=>Math.abs(mx-bxx)<bh+st*0.3))continue;
          const ya=f(x0), yb=f(x1), ang=Math.atan2(yb-ya,x1-x0);
          m.rects.push(Object.assign(mkRect(mx,(ya+yb)/2,Math.hypot(x1-x0,yb-ya)/2+0.6,rhw,ang),{river:true})); }
      }else{
        m.fords.push({ri,f,hh:rhw});
      }
      area+=S*rhw*2;
    });
  }
  function nearRiver(x,y,rad){return useRivers&&riverF.some(f=>Math.abs(y-f(x))<rhw+rad+5)}
  function mkRect(x,y,hw,hh,ang){return {x,y,hw,hh,ang,c:Math.cos(ang),s:Math.sin(ang)}}
  function tryPlace(n,fn){let tries=0,done=0;while(done<n&&tries<n*30){tries++;if(area>maxArea)break;if(fn())done++;}}
  const cnt=(base)=>Math.max(1,Math.round(base*dens*Math.max(0.6,Math.sqrt(k)*1.0)));
  if(T.swamps)tryPlace(1,()=>{const rad=(34+r()*22)*Math.max(0.8,k);const x=rad+10+r()*(S-2*rad-20),y=zoneH+rad+6+r()*Math.max(1,(S-2*zoneH-2*rad-12));
    if(!inNeutral(y,rad)||Math.hypot(x-S/2,y-S/2)<R*3+rad||(useRivers&&riverF.some(f=>{for(let xx=Math.max(0,x-rad*1.5);xx<=Math.min(S,x+rad*1.5);xx+=6)if(Math.abs(y-f(xx))<rhw+rad*1.45+bhMax+10)return true;return false;})))return false;
    m.swamps.push({x,y,r:rad,sh:shp(.3,.16,.1)});area+=PI*rad*rad;return true});
  if(T.rocks)tryPlace(cnt(2.2*(T.rockN||1)),()=>{
    // хребет: цепочка валунов вдоль плавной дуги, симметричный двойник напротив
    const len=(34+r()*50)*Math.max(0.8,k)*(T.rockLen||1), n=Math.max(5,Math.round(len/5.5)), a0=r()*PI, bend=(r()-.5)*1.1;
    const x=r()*S, y=zoneH+len*0.5+8+r()*Math.max(1,(S/2-zoneH-len-12)); const chain=[]; let cx=x-Math.cos(a0)*len/2, cy=y-Math.sin(a0)*len/2, ang=a0-bend/2;
    for(let i=0;i<n;i++){ const t=i/(n-1), env=0.45+0.55*Math.sin(Math.PI*(0.12+0.76*t)); const rad=(2.3+r()*2.6)*env*Math.max(0.9,Math.sqrt(k))*(T.rockR||1)+1.2;
      chain.push({x:cx+(r()-.5)*2,y:cy+(r()-.5)*2,r:rad,sh:shp(.22,.16,.1)}); ang+=bend/n+(r()-.5)*0.15; const st=rad*1.25+1.2; cx+=Math.cos(ang)*st; cy+=Math.sin(ang)*st; }
    for(const q of chain){ if(!inNeutral(q.y,q.r+2)||!farFromPoint(q.x,q.y,q.r+2)||nearRiver(q.x,q.y,q.r+2)||q.x<q.r+4||q.x>S-q.r-4)return false; }
    const id=m.ridges++; for(const q of chain){ q.rid=id; m.rocks.push(q); area+=PI*q.r*q.r*1.4; }
    for(const q of chain) m.rocks.push({x:S-q.x,y:S-q.y,r:q.r,sh:mirSh(q.sh),rid:id}), area+=PI*q.r*q.r*1.4;
    return true});
  if(T.walls)tryPlace(cnt(3),()=>{const len=(10+r()*16)*Math.max(0.8,k),ang=r()*PI;const x=r()*S,y=zoneH+len+4+r()*Math.max(1,(S/2-zoneH-len-4));
    if(!inNeutral(y,len)||!farFromPoint(x,y,len)||nearRiver(x,y,len))return false;
    m.rects.push(mkRect(x,y,len/2,0.8,ang),mkRect(S-x,S-y,len/2,0.8,ang));area+=2*len*1.6;return true});
  if(T.grass)tryPlace(cnt(5),()=>{const rad=(12+r()*20)*Math.max(0.7,k);const x=r()*S,y=r()*S/2;if(Math.hypot(x-S/2,y-S/2)<R+rad)return false;
    {const sh=shp(.26,.16,.1);m.grass.push({x,y,r:rad,sh},{x:S-x,y:S-y,r:rad,sh:mirSh(sh)});}return true});
  if(T.city){
    m.city=true; m.plaza={x:S/2,y:S/2,hw:Math.max(avHW0(),R*2.2)};
    // город: два широких проспекта через центр (там точка и площадь), вторичные улицы, кварталы из зданий разного размера
    const ck=T.cityK||1, fill=T.cityFill==null?0.85:T.cityFill;
    function avHW0(){return Math.max(13,0.016*S);}
    const avHW=Math.max(13,0.016*S), stHW=Math.max(6.5,0.0075*S), alley=Math.max(4.5,0.005*S);
    const cw=S*(0.13+0.03*r())*ck, rh=S*(0.12+0.03*r())*ck;
    const ax=[{p:S/2,hw:avHW}], ay=[{p:S/2,hw:avHW}];
    for(let j=1;S/2+j*cw<S+cw;j++){ax.push({p:S/2+j*cw,hw:stHW},{p:S/2-j*cw,hw:stHW});}
    for(let i=1;S/2+i*rh<S+rh;i++){ay.push({p:S/2+i*rh,hw:stHW},{p:S/2-i*rh,hw:stHW});}
    ax.sort((u,v)=>u.p-v.p); ay.sort((u,v)=>u.p-v.p);
    for(const q of ax)if(q.p>=0&&q.p<=S)m.roads.push({x:q.p,y:S/2,hw:q.hw,hh:S/2});
    for(const q of ay)if(q.p>=0&&q.p<=S)m.roads.push({x:S/2,y:q.p,hw:S/2,hh:q.hw});
    const add=(x0,y0,x1,y1)=>{ const hw=(x1-x0)/2, hh=(y1-y0)/2, cx=(x0+x1)/2, cy=(y0+y1)/2, tone=(r()*3)|0;
      m.rects.push(Object.assign(mkRect(cx,cy,hw,hh,0),{house:true,tone}),Object.assign(mkRect(S-cx,S-cy,hw,hh,0),{house:true,tone})); area+=8*hw*hh; };
    const split=(x0,y0,x1,y1,d)=>{
      const w=x1-x0,h=y1-y0; if(w<8||h<8)return;
      const small=w<28&&h<28;
      const big=w>46||h>46;
      if(!big&&(small||d>=3||r()<0.12+0.1*d)){ if(r()>fill)return;
        const mx=(0.04+0.12*r())*w/2, my=(0.04+0.12*r())*h/2; const a0=x0+mx,a1=x1-mx,b0=y0+my,b1=y1-my; if(a1-a0<7||b1-b0<7)return; add(a0,b0,a1,b1); return; }
      const t=0.38+0.24*r();
      if(w>=h){ const c=x0+w*t; split(x0,y0,c-alley/2,y1,d+1); split(c+alley/2,y0,x1,y1,d+1); }
      else{ const c=y0+h*t; split(x0,y0,x1,c-alley/2,d+1); split(x0,c+alley/2,x1,y1,d+1); }
    };
    for(let j=0;j<ax.length-1;j++)for(let i=0;i<ay.length-1;i++){
      let x0=ax[j].p+ax[j].hw+2, x1=ax[j+1].p-ax[j+1].hw-2, y0=ay[i].p+ay[i].hw+2, y1=ay[i+1].p-ay[i+1].hw-2;
      if((y0+y1)/2>=S/2)continue; if(x0<2)x0=2; if(x1>S-2)x1=S-2;
      const yc2=(y0+y1)/2;
      if(yc2<zoneH){ if(yc2>zoneH*0.5)continue; y0=Math.max(y0,3); y1=Math.min(y1,zoneH*0.27); } // тыловая полоса зоны расстановки: застройка только у самого края
      else{ y0=Math.max(y0,zoneH+stHW+4); y1=Math.min(y1,S-zoneH-stHW-4); }
      if(x1-x0<14||y1-y0<14)continue;
      const dxp=Math.max(x0-S/2,0,S/2-x1), dyp=Math.max(y0-S/2,0,S/2-y1); if(Math.hypot(dxp,dyp)<R*2.3)continue;
      if(r()<0.18)continue; // площадь или пустырь
      split(x0,y0,x1,y1,0);
    }
  }
  m.flatPct=Math.round(100*(1-Math.min(1,area/(S*S))));
  return m;
}
function segHitsRect(x1,y1,x2,y2,q){
  const rr=q.rr||(q.rr=Math.hypot(q.hw,q.hh)); if(Math.min(x1,x2)>q.x+rr||Math.max(x1,x2)<q.x-rr||Math.min(y1,y2)>q.y+rr||Math.max(y1,y2)<q.y-rr)return false;
  // перенос в локальные координаты прямоугольника
  const ax=(x1-q.x)*q.c+(y1-q.y)*q.s, ay=-(x1-q.x)*q.s+(y1-q.y)*q.c;
  const bx=(x2-q.x)*q.c+(y2-q.y)*q.s, by=-(x2-q.x)*q.s+(y2-q.y)*q.c;
  let t0=0,t1=1; const dx=bx-ax,dy=by-ay;
  const p=[-dx,dx,-dy,dy], qq=[ax+q.hw,q.hw-ax,ay+q.hh,q.hh-ay];
  for(let i=0;i<4;i++){ if(p[i]===0){ if(qq[i]<0)return false; } else { const t=qq[i]/p[i]; if(p[i]<0){ if(t>t1)return false; if(t>t0)t0=t; } else { if(t<t0)return false; if(t<t1)t1=t; } } }
  return true;
}

/* ---------------------------------- ДВИЖОК ---------------------------------- */
function createSim(bal,opts,players,armies,seed){
  const g=merge(bal.global,opts||{});
  const units=bal.units;
  const S=g.mapSize||1000;
  const map=genMap(S,g,g.mapSeed||seed||1);
  const sim={g,units,map,S,players:[],squads:[],sol:[],t:0,tick:0,phase:'deploy',phaseT:g.deployTime,events:[],pend:[],fires:[],winner:null,reason:'',fog:!!g.fog,
    pt:{owner:-1,prog:0,ctrlT:0,ctrlTeam:-1,inside:[0,0]},rand:rng((seed||1)*31+7),over:false};
  const DT=0.05; sim.DT=DT;
  const fsp0=g.fileSpacing, rsp0=g.rankSpacing;
  // игроки и полосы расстановки
  const nT=[0,0]; players.forEach(p=>{p.idx=nT[p.team]++;});
  players.forEach((p,pi)=>{
    const k=nT[p.team];
    sim.players.push({id:pi,name:p.name,team:p.team,bot:!!p.bot,human:!p.bot,ready:!!p.bot,x0:p.idx*S/k,x1:(p.idx+1)*S/k,squads:[],aiLevel:p.aiLevel!=null?p.aiLevel:(g.aiLevel!=null?g.aiLevel:1),gone:false});
  });
  // отряды и бойцы
  armies.forEach((arm,pi)=>{
    arm.forEach((a,ai)=>{ const U=units[a.unit]; if(!U)return;
      const n=Math.max(2,Math.round(U.size*g.squadScale));
      const sq={id:sim.squads.length,owner:pi,team:sim.players[pi].team,unit:a.unit,U,soldiers:[],nAlive:0,order:{k:'hold'},cx:0,cy:0,face:0,width:10,run:false,fire:true,
        hf:false,mar:false,marPrev:false,wx:0,wy:0,wf:0,fsp:fsp0*(U.wide?1.7:1),rsp:rsp0*(U.wide?1.7:1),kills:0,dmg:0,n0:n,lastCombat:-999,mor:100,rec:0,ex:0,routed:false,routT:0,focus:null,focusT:0,mx:0,my:0,rad:5,reach:0,ranged:false};
      for(const w of U.weapons){ if(w.kind==='ranged'&&w.max>sq.reach)sq.reach=w.max; if(w.kind==='ranged')sq.ranged=true; }
      sq.width=Math.max(2,Math.ceil(n/(U.ranks||4)));
      for(let i=0;i<n;i++){
        const s={id:sim.sol.length,sq,slot:i,U,x:0,y:0,px:0,py:0,face:0,pface:0,hp:U.hp,maxhp:U.hp,armor:U.armor,shield:U.shield,arc:U.arc,
          w:0,ammo:U.weapons.map(w=>w.ammo==null?-1:w.ammo),cd:Math.random()*(U.weapons[0].cd||1),swap:0,tg:null,tgT:Math.random()*0.4,nAtt:0,alive:true,sp:100,still:0,odo:0,lastAtk:-99,v:0,moving:false,
          hill:false,grass:false,swamp:false,team:sq.team,owner:pi,mass:1,eng:false};
        sq.soldiers.push(s); sim.sol.push(s);
      }
      sq.nAlive=n; sim.squads.push(sq); sim.players[pi].squads.push(sq);
    });
  });
  /* ------- геометрия строя ------- */
  function maxW(sq,n){ const mr=Math.max(2,Math.min(3,sq.U.ranks||2)); return Math.max(2,Math.ceil(n/mr)); }
  function slotXY(sq,i,o){
    const n=sq.nAlive, w=Math.max(1,Math.min(sq.width,n,maxW(sq,n)));
    let row,f,inRow;
    if(sq.form==='wedge'&&w>=3){ // клин: ряды 1,3,5… бойцов, дальше полные ряды
      let r=0,rem=i,cnt=1; for(;;){ const c=Math.min(cnt,w,n-(i-rem)); if(rem<c){ inRow=c; f=rem; break; } rem-=c; r++; cnt=cnt<w?cnt+2:w; }
      row=r;
    } else { row=(i/w)|0; f=i%w; inRow=Math.min(w,n-row*w); }
    const fc=sq.mar?sq.wf:sq.face, bx=sq.mar?sq.wx:sq.cx, by=sq.mar?sq.wy:sq.cy;
    const lat=(f-(inRow-1)/2)*sq.fsp, dep=row*sq.rsp, fx=Math.cos(fc), fy=Math.sin(fc);
    o.x=bx-fy*lat-fx*dep; o.y=by+fx*lat-fy*dep; return o;
  }
  sim.slotXY=slotXY;
  function reslot(sq){let i=0;for(const s of sq.soldiers)if(s.alive)s.slot=i++;sq.nAlive=i;}
  const tmp={x:0,y:0};
  function zoneRect(team,pi){const p=sim.players[pi];return team===0?{x0:p.x0,x1:p.x1,y0:S-map.zoneH,y1:S}:{x0:p.x0,x1:p.x1,y0:0,y1:map.zoneH};}
  sim.zoneRect=zoneRect;
  function snapSquad(sq){ // мгновенно поставить бойцов на места (расстановка)
    reslot(sq); for(const s of sq.soldiers){ if(!s.alive)continue; slotXY(sq,s.slot,tmp); s.x=s.px=tmp.x; s.y=s.py=tmp.y; s.face=s.pface=sq.face; }
    sq.mx=sq.cx; sq.my=sq.cy;
  }
  function autoLayoutAll(only){
    sim.players.forEach((p,pi)=>{ if(only!=null&&only!==pi)return; const z=zoneRect(p.team,pi), list=p.squads, n=list.length; if(!n)return;
      const face=p.team===0?-PI/2:PI/2;
      // ряды: ближний бой впереди, стрелки позади, конница по краям
      const melee=list.filter(q=>q.U.role==='melee'), ranged=list.filter(q=>q.U.role==='ranged'), cav=list.filter(q=>q.U.role==='cav');
      const rows=[[],[],[]]; // front, mid(ranged), cav edges
      rows[0]=melee; rows[1]=ranged; rows[2]=cav;
      const zw=z.x1-z.x0, zh=z.y1-z.y0;
      const rowY=[0.78,0.5,0.62].map(f=>p.team===0?z.y0+zh*(1-f)+zh*0.0:z.y1-zh*(1-f));
      // p.team 0: front = ближе к центру (меньше y)
      const yFront=p.team===0?z.y0+zh*0.25:z.y1-zh*0.25, yBack=p.team===0?z.y0+zh*0.62:z.y1-zh*0.62, yMid=p.team===0?z.y0+zh*0.42:z.y1-zh*0.42;
      const GAP=5, xc=(z.x0+z.x1)/2;
      // компактная расстановка: отряды стоят плотно по центру своей полосы
      function pack(arr,span){ const m=arr.length; if(!m)return 0; let tot=0;
        for(const q of arr){ q.width=Math.max(2,Math.min(q.width,Math.floor((span/m-GAP)/q.fsp))); tot+=q.width*q.fsp+GAP; } return tot; }
      function put(arr,y,x0){ let x=x0; for(const q of arr){ const e=q.width*q.fsp+GAP; q.cx=clamp(x+e/2,z.x0+4,z.x1-4); q.cy=y; q.face=face; q.order={k:'hold'}; snapSquad(q); x+=e; } }
      const span=zw*0.9; const tm=pack(melee,span*0.7); put(melee,yFront,xc-tm/2);
      const tr=pack(ranged,span*0.7); put(ranged,yBack,xc-tr/2);
      const cl=cav.slice(0,Math.ceil(cav.length/2)), cr=cav.slice(Math.ceil(cav.length/2));
      const tl=pack(cl,span*0.15), tr2=pack(cr,span*0.15);
      put(cl,yMid,xc-Math.max(tm,tr)/2-tl-4); put(cr,yMid,xc+Math.max(tm,tr)/2+4);
    });
  }
  sim.autoLayout=autoLayoutAll;
  sim.snapSquad=snapSquad;
  // расстановка игроком (только в фазе deploy и внутри своей зоны)
  sim.place=function(sqId,cx,cy,face,width){
    if(sim.phase!=='deploy')return false; const sq=sim.squads[sqId]; if(!sq)return false;
    const z=zoneRect(sq.team,sq.owner); const m=1.5;
    sq.cx=clamp(cx,z.x0+m,z.x1-m); sq.cy=clamp(cy,z.y0+m,z.y1-m); sq.face=face; if(width)sq.width=clamp(Math.round(width),1,Math.max(1,sq.nAlive)); sq.order={k:'hold'};
    for(let it=0;it<2;it++){ // строй целиком внутри зоны: сдвигаем по выступающим бойцам
      reslot(sq); let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for(const s of sq.soldiers){ if(!s.alive)continue; slotXY(sq,s.slot,tmp); if(tmp.x<x0)x0=tmp.x; if(tmp.x>x1)x1=tmp.x; if(tmp.y<y0)y0=tmp.y; if(tmp.y>y1)y1=tmp.y; }
      let dx=0,dy=0; if(x0<z.x0+m)dx=z.x0+m-x0; else if(x1>z.x1-m)dx=z.x1-m-x1; if(y0<z.y0+m)dy=z.y0+m-y0; else if(y1>z.y1-m)dy=z.y1-m-y1;
      if(!dx&&!dy)break; sq.cx+=dx; sq.cy+=dy; }
    snapSquad(sq); return true;
  };
  sim.setReady=function(pi,v){sim.players[pi].ready=v!==false;};

  /* ------- приказы ------- */
  sim.order=function(sqId,o){
    const sq=sim.squads[sqId]; if(!sq||sq.nAlive<=0||sq.routed||sim.phase!=='battle')return false;
    switch(o.k){
      case 'move': {
        sq.order={k:'move'}; sq.form='line'; sq.cx=clamp(o.x,2,S-2); sq.cy=clamp(o.y,2,S-2);
        if(o.face!=null)sq.face=o.face; else { const dx=sq.cx-sq.mx,dy=sq.cy-sq.my; if(Math.hypot(dx,dy)>3)sq.face=Math.atan2(dy,dx); }
        if(o.width)sq.width=clamp(Math.round(o.width),1,sq.nAlive); sq.run=!!o.run; reslot(sq); break; }
      case 'attack': { const t=sim.squads[o.target]; if(!t||t.team===sq.team||t.nAlive<=0)return false; sq.order={k:'attack',target:t.id}; sq.run=true; sq.tgSeen=false; sq.pg=null; sq.form=(sq.U.role==='cav'&&!sq.ranged&&!sq.U.abilities.includes('mountedFire')&&Math.hypot(t.mx-sq.mx,t.my-sq.my)>40)?'wedge':'line'; break; }
      case 'stop': { sq.form='line'; reslot(sq); sq.cx=sq.mx; sq.cy=sq.my; sq.order={k:'hold'}; break; }
      case 'run': sq.run=!!o.v; break;
      case 'fire': sq.fire=!!o.v; break;
      case 'hold': sq.hf=!!o.v; break;
      case 'width': sq.width=clamp(Math.round(o.w),1,sq.nAlive); reslot(sq); if(sq.order.k==='hold'||sq.order.k==='move'){} break;
      default: return false;
    }
    return true;
  };

  /* ------- сетка соседей ------- */
  const CELL=3, GN=Math.ceil(S/CELL)+2, head=new Int32Array(GN*GN), nxt=new Int32Array(sim.sol.length);
  function buildGrid(){ head.fill(-1); for(const s of sim.sol){ if(!s.alive)continue; const c=((s.x/CELL)|0)+((s.y/CELL)|0)*GN; nxt[s.id]=head[c]; head[c]=s.id; } }
  function nearestEnemy(s,rad){
    const cx=(s.x/CELL)|0, cy=(s.y/CELL)|0, rr=Math.ceil(rad/CELL); let best=null,bd=rad*rad;
    for(let yy=Math.max(0,cy-rr);yy<=Math.min(GN-1,cy+rr);yy++)for(let xx=Math.max(0,cx-rr);xx<=Math.min(GN-1,cx+rr);xx++){
      for(let i=head[xx+yy*GN];i!==-1;i=nxt[i]){const e=sim.sol[i]; if(e.team===s.team)continue; const dx=e.x-s.x,dy=e.y-s.y,d=dx*dx+dy*dy; if(d<bd){bd=d;best=e;}}
    } return best;
  }
  function enemyNear(x,y,team,rad,pick){
    const cx=(x/CELL)|0, cy=(y/CELL)|0, rr=Math.ceil(rad/CELL); let n=0,res=null;
    for(let yy=Math.max(0,cy-rr);yy<=Math.min(GN-1,cy+rr);yy++)for(let xx=Math.max(0,cx-rr);xx<=Math.min(GN-1,cx+rr);xx++){
      for(let i=head[xx+yy*GN];i!==-1;i=nxt[i]){const e=sim.sol[i]; if(e.team===team)continue; const dx=e.x-x,dy=e.y-y; if(dx*dx+dy*dy<=rad*rad){n++; if(Math.random()*n<1)res=e;}}
    } return res;
  }

  /* ------- урон ------- */
  function vanish(s){ if(!s.alive)return; s.alive=false; s.gone=true; s.hp=0; s.sq.nAlive--; }
  function die(t,by){ if(!t.alive)return; if(by&&by.sq&&by.sq.team!==t.sq.team)by.sq.kills++; t.alive=false; t.hp=0; t.sq.nAlive--; t.sq.rec+=100/t.sq.soldiers.length; sim.events.push({e:'d',x:t.x,y:t.y,id:t.id}); }
  function applyHit(a,t,w,mult){
    if(!t.alive||!a.alive)return 0;
    const fx=w.fx||{}, ang=Math.atan2(a.y-t.y,a.x-t.x), dd=Math.abs(angDiff(ang,t.face));
    const front=t.arc>0&&t.shield>0&&dd<=t.arc*PI/360;
    const sh=(front&&!fx.ignoreShield)?t.shield+(t.wall>0?30:0):0;
    let def;
    if(fx.pilum)def=sh; else if(fx.armorPierce)def=t.armor*(1-fx.armorPierce)+sh; else def=t.armor+sh;
    const dmg=w.dmg*mult*100/(100+def);
    if(fx.pilum&&front)t.shield=0;
    if(fx.axe){ if(front&&t.shield>0)t.shield=Math.max(0,t.shield-g.axeStep); else t.armor=Math.max(0,t.armor-g.axeStep); }
    if(Math.random()<0.4)sim.events.push({e:'h',x:t.x,y:t.y,id:t.id,k:w.kind==='ranged'?3:(mult>1.5?2:(front?1:0))});
    if(a.sq.team!==t.sq.team)a.sq.dmg+=Math.min(dmg,Math.max(0,t.hp)); t.hp-=dmg; t.sq.lastCombat=sim.t; a.sq.lastCombat=sim.t;
    if(t.hp<=0)die(t,a);
    return dmg;
  }
  const RG=40, RN=Math.ceil(S/RG)+1, rgrid=new Array(RN*RN); for(const q of map.rects){ const rr=Math.hypot(q.hw,q.hh); const a0=Math.max(0,Math.floor((q.x-rr)/RG)),a1=Math.min(RN-1,Math.floor((q.x+rr)/RG)),b0=Math.max(0,Math.floor((q.y-rr)/RG)),b1=Math.min(RN-1,Math.floor((q.y+rr)/RG)); for(let j=b0;j<=b1;j++)for(let i=a0;i<=a1;i++){ (rgrid[j*RN+i]||(rgrid[j*RN+i]=[])).push(q); } }
  let rgStamp=0;
  function losBlocked(x1,y1,x2,y2){
    if(!map.rects.length)return false;
    const a0=Math.max(0,Math.floor((Math.min(x1,x2)-1)/RG)),a1=Math.min(RN-1,Math.floor((Math.max(x1,x2)+1)/RG)),b0=Math.max(0,Math.floor((Math.min(y1,y2)-1)/RG)),b1=Math.min(RN-1,Math.floor((Math.max(y1,y2)+1)/RG));
    if((a1-a0+1)*(b1-b0+1)>40){ for(const q of map.rects){ if(segHitsRect(x1,y1,x2,y2,q))return true; } return false; }
    for(let j=b0;j<=b1;j++)for(let i=a0;i<=a1;i++){ const c=rgrid[j*RN+i]; if(!c)continue; for(const q of c){ if(segHitsRect(x1,y1,x2,y2,q))return true; } }
    return false; }
  function pickWeapon(s,d){
    const ws=s.U.weapons; let best=-1;
    for(let i=0;i<ws.length;i++){const w=ws[i]; if(w.ammo!=null&&s.ammo[i]<=0)continue; if(d>=w.min-0.001&&(best<0||w.max>ws[best].max))best=i;}
    if(best<0){for(let i=0;i<ws.length;i++){if(ws[i].min===0){best=i;break;}} if(best<0)best=0;}
    return best;
  }

/* ------- навигация: сетка проходимости и поиск пути (A*) ------- */
  const nav=(function(){
    const cs=S>=1500?5:4, n=Math.ceil(S/cs), N=n*n, blk=new Uint8Array(N), cost=new Float32Array(N).fill(1), clr=new Float32Array(N);
    const pad=g.soldierRadius+0.4, ci=v=>Math.max(0,Math.min(n-1,(v/cs)|0));
    for(const q of map.rocks){ const R=q.r*1.45+pad+cs, x0=ci(q.x-R),x1=ci(q.x+R),y0=ci(q.y-R),y1=ci(q.y+R);
      for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){ const dx=(i+.5)*cs-q.x,dy=(j+.5)*cs-q.y; if(Math.hypot(dx,dy)<blobR(q,Math.atan2(dy,dx))+pad+cs*0.35)blk[j*n+i]=1; } }
    for(const q of map.rects){ const R=q.hw+q.hh+pad+cs, x0=ci(q.x-R),x1=ci(q.x+R),y0=ci(q.y-R),y1=ci(q.y+R);
      for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){ const dx=(i+.5)*cs-q.x,dy=(j+.5)*cs-q.y, lx=dx*q.c+dy*q.s, ly=-dx*q.s+dy*q.c; if(Math.hypot(Math.max(Math.abs(lx)-q.hw,0),Math.max(Math.abs(ly)-q.hh,0))<pad+cs*0.35)blk[j*n+i]=1; } }
    for(let i=0;i<n;i++){ blk[i]=1; blk[(n-1)*n+i]=1; blk[i*n]=1; blk[i*n+n-1]=1; }
    for(const q of map.swamps){ const R=q.r*1.45+cs, x0=ci(q.x-R),x1=ci(q.x+R),y0=ci(q.y-R),y1=ci(q.y+R);
      for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){ if(inBlob(q,(i+.5)*cs,(j+.5)*cs))cost[j*n+i]=1.8; } }
    for(const f of map.fords){ for(let i=0;i<n;i++){ const x=(i+.5)*cs, fy=f.f(x), y0=ci(fy-f.hh-cs), y1=ci(fy+f.hh+cs); for(let j=y0;j<=y1;j++){ if(Math.abs((j+.5)*cs-fy)<f.hh+cs*.5)cost[j*n+i]=Math.max(cost[j*n+i],2); } } }
    const INF=1e9; for(let i=0;i<N;i++)clr[i]=blk[i]?0:INF; const dg=cs*1.414;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){ const k=j*n+i; let v=clr[k]; if(!v)continue; if(i>0)v=Math.min(v,clr[k-1]+cs); if(j>0){ v=Math.min(v,clr[k-n]+cs); if(i>0)v=Math.min(v,clr[k-n-1]+dg); if(i<n-1)v=Math.min(v,clr[k-n+1]+dg); } clr[k]=v; }
    for(let j=n-1;j>=0;j--)for(let i=n-1;i>=0;i--){ const k=j*n+i; let v=clr[k]; if(!v)continue; if(i<n-1)v=Math.min(v,clr[k+1]+cs); if(j<n-1){ v=Math.min(v,clr[k+n]+cs); if(i<n-1)v=Math.min(v,clr[k+n+1]+dg); if(i>0)v=Math.min(v,clr[k+n-1]+dg); } clr[k]=v; }
    const gs=new Float32Array(N), came=new Int32Array(N), stamp=new Int32Array(N), done=new Int32Array(N); let run=0;
    const hk=[],hv=[]; // бинарная куча
    function hpush(k,v){ let i=hk.length; hk.push(k); hv.push(v); while(i>0){ const p=(i-1)>>1; if(hk[p]<=k)break; hk[i]=hk[p]; hv[i]=hv[p]; i=p; } hk[i]=k; hv[i]=v; }
    function hpop(){ const v0=hv[0], k=hk.pop(), v=hv.pop(); const m=hk.length; if(m){ let i=0; for(;;){ let c=2*i+1; if(c>=m)break; if(c+1<m&&hk[c+1]<hk[c])c++; if(hk[c]>=k)break; hk[i]=hk[c]; hv[i]=hv[c]; i=c; } hk[i]=k; hv[i]=v; } return v0; }
    function near(x,y,cl){ const i0=ci(x),j0=ci(y); if(clr[j0*n+i0]>=cl)return j0*n+i0;
      for(let r=1;r<=14;r++){ let best=-1,bd=1e9; for(let j=j0-r;j<=j0+r;j++)for(let i=i0-r;i<=i0+r;i++){ if(i<0||j<0||i>=n||j>=n)continue; if(Math.max(Math.abs(i-i0),Math.abs(j-j0))!==r)continue; if(clr[j*n+i]>=cl){ const d=(i-i0)*(i-i0)+(j-j0)*(j-j0); if(d<bd){bd=d;best=j*n+i;} } } if(best>=0)return best; } return -1; }
    function los(x0,y0,x1,y1,cl){ const d=Math.hypot(x1-x0,y1-y0), k=Math.max(1,Math.ceil(d/(cs*0.5))); for(let i=0;i<=k;i++){ const t=i/k, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t; if(clr[ci(y)*n+ci(x)]<cl)return false; } return true; }
    function astar(sx,sy,gx,gy,cl){
      const s=near(sx,sy,cl), t=near(gx,gy,cl); if(s<0||t<0)return null;
      const tx=t%n, ty=(t/n)|0; run++; hk.length=0; hv.length=0; gs[s]=0; stamp[s]=run; came[s]=-1; hpush(0,s); let found=false;
      while(hk.length){ const u=hpop(); if(done[u]===run)continue; done[u]=run; if(u===t){found=true;break;}
        const ux=u%n, uy=(u/n)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue; const vx=ux+dx, vy=uy+dy; if(vx<0||vy<0||vx>=n||vy>=n)continue; const v=vy*n+vx; if(clr[v]<cl||done[v]===run)continue;
          if(dx&&dy&&(clr[uy*n+vx]<cl||clr[vy*n+ux]<cl))continue;
          const ng=gs[u]+(dx&&dy?1.414:1)*cs*0.5*(cost[u]+cost[v]); if(stamp[v]!==run||ng<gs[v]){ stamp[v]=run; gs[v]=ng; came[v]=u; const ex=Math.abs(vx-tx), ey=Math.abs(vy-ty); hpush(ng+(Math.max(ex,ey)+0.414*Math.min(ex,ey))*cs,v); } } }
      if(!found)return null;
      const pts=[]; for(let c=t;c>=0;c=came[c])pts.push({x:((c%n)+.5)*cs,y:(((c/n)|0)+.5)*cs}); pts.reverse();
      pts[0]={x:sx,y:sy}; if(t===near(gx,gy,0))pts[pts.length-1]={x:gx,y:gy}; else pts.push({x:gx,y:gy});
      const out=[pts[0]]; let i=0; while(i<pts.length-1){ let j=pts.length-1; while(j>i+1&&!los(pts[i].x,pts[i].y,pts[j].x,pts[j].y,cl))j--; out.push(pts[j]); i=j; }
      return out;
    }
    const plen=p=>{ let L=0; for(let i=1;i<p.length;i++)L+=Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y); return L; };
    function path(sx,sy,gx,gy,halfW){
      if(los(sx,sy,gx,gy,cs+halfW*0.0+Math.min(halfW,30)+1))return [{x:sx,y:sy},{x:gx,y:gy}];
      const small=astar(sx,sy,gx,gy,cs); if(!small)return null;
      const cl=Math.min(halfW,30)+cs*0.5+1; const big=cl>cs?astar(sx,sy,gx,gy,cl):null;
      if(big&&plen(big)<=plen(small)*1.3+40)return big; return small; }
    function blockedAt(x,y){ return blk[ci(y)*n+ci(x)]===1; }
    return {cs,n,blk,clr,cost,path,los:(x0,y0,x1,y1)=>los(x0,y0,x1,y1,cs),blockedAt,astar};
  })();
  sim.nav=nav;
  /* марш строем: отряд идёт по найденному пути единым блоком */
  function marchStep(sq,dt){
    const o=sq.order, was=sq.mar; sq.mar=false; if(sq.routed||sq.nAlive<=0)return;
    if(o.k!=='attack'&&sq.form==='wedge')sq.form='line';
    let gx,gy,faceFin=sq.face,holdHere=false;
    if(o.k==='move'){ gx=sq.cx; gy=sq.cy; }
    else if(o.k==='attack'){
      const t=sim.squads[o.target]; if(!t||t.nAlive<=0)return;
      if(isVisible(sq.team,t)){ sq.tgx=t.mx; sq.tgy=t.my; sq.tgSeen=true; } if(!sq.tgSeen)return;
      const tx=sq.tgx, ty=sq.tgy, dd=Math.hypot(tx-sq.mx,ty-sq.my)||1, edge=dd-t.rad-sq.rad*0.5, clear=nav.los(sq.mx,sq.my,tx,ty);
      faceFin=Math.atan2(ty-sq.my,tx-sq.mx);
      if(!sq.hf){ if((sq.ranged?edge<sq.reach*0.85:edge<20)&&clear){ sq.pg=null; sq.cx=sq.mx; sq.cy=sq.my; sq.face+=clamp(angDiff(faceFin,sq.face),-0.1,0.1); if(sq.form==='wedge'&&edge<12)sq.form='line'; return; } }
      else if(sq.ranged&&edge<sq.reach*0.85&&clear)holdHere=true;
      let nx=tx,ny=ty; if(isVisible(sq.team,t)){ let nd=1e18; for(const e of t.soldiers){ if(!e.alive)continue; const q=(e.x-sq.mx)*(e.x-sq.mx)+(e.y-sq.my)*(e.y-sq.my); if(q<nd){nd=q;nx=e.x;ny=e.y;} } }
      const dn=Math.hypot(nx-sq.mx,ny-sq.my)||1; gx=nx-(nx-sq.mx)/dn*1.6; gy=ny-(ny-sq.my)/dn*1.6;
    } else { sq.pg=null; return; }
    if(!was){ sq.wf=sq.face; sq.wx=sq.mx; sq.wy=sq.my; sq.pg=null; }
    sq.mar=true;
    if(holdHere){ sq.wx=sq.mx; sq.wy=sq.my; sq.wf+=clamp(angDiff(faceFin,sq.wf),-0.08,0.08); return; }
    sq.pT=(sq.pT||0)-dt;
    if(!sq.pg||sq.pT<=0||Math.hypot(sq.pg.x-gx,sq.pg.y-gy)>(o.k==='attack'?7:0.5)){
      sq.pT=o.k==='attack'?0.8:3; sq.pg={x:gx,y:gy}; const hw=((Math.min(sq.width,sq.nAlive)-1)*sq.fsp)/2+1.5;
      sq.path=nav.path(sq.mx,sq.my,gx,gy,hw)||[{x:sq.mx,y:sq.my},{x:gx,y:gy}]; sq.pi=1; }
    const path=sq.path; const rows=Math.ceil(sq.nAlive/Math.max(1,Math.min(sq.width,sq.nAlive))), reachD=Math.max(rows*sq.rsp/2+6,13);
    while(sq.pi<path.length-1&&Math.hypot(path[sq.pi].x-sq.mx,path[sq.pi].y-sq.my)<reachD)sq.pi++;
    const last=sq.pi>=path.length-1, wp=path[Math.min(sq.pi,path.length-1)], dx=wp.x-sq.mx, dy=wp.y-sq.my, d=Math.hypot(dx,dy)||1, L=Math.max(18,rows*sq.rsp/2+14);
    let tf;
    if(d>L){ sq.wx=sq.mx+dx/d*L; sq.wy=sq.my+dy/d*L; tf=Math.atan2(dy,dx); }
    else if(last){ sq.wx=gx; sq.wy=gy; tf=faceFin; }
    else { sq.wx=wp.x; sq.wy=wp.y; tf=Math.atan2(dy,dx); }
    sq.wf+=clamp(angDiff(tf,sq.wf),-0.09,0.09); if(sq.wf>PI)sq.wf-=TAU; else if(sq.wf<-PI)sq.wf+=TAU;
  }
  
  /* ------- шаг симуляции ------- */
  function terrainFlags(s){
    let sw=false,hl=false,gr=false,sp=1;
    for(const q of map.swamps){ if(inBlob(q,s.x,s.y)){sw=true;sp=Math.min(sp,0.55);break;}}
    for(const f of map.fords){ if(Math.abs(s.y-f.f(s.x))<f.hh){sw=true;sp=Math.min(sp,0.5);break;} }
    for(const q of map.grass){ if(inBlob(q,s.x,s.y)){gr=true;break;}}
    s.swamp=sw;s.hill=false;s.grass=gr; return sp;
  }
  function updateSquadStats(sq){
    let n=0,sx=0,sy=0; for(const s of sq.soldiers){ if(s.alive){n++;sx+=s.x;sy+=s.y;} }
    sq.nAlive=n; if(!n)return;
    sq.mx=sx/n; sq.my=sy/n; let r=0; for(const s of sq.soldiers){ if(s.alive){const d=Math.hypot(s.x-sq.mx,s.y-sq.my); if(d>r)r=d;} } sq.rad=r;
  }
  function pickFocus(sq){
    const o=sq.order;
    if(o.k==='attack'){const t=sim.squads[o.target]; if(t&&t.nAlive>0){sq.focus=t;return;} sq.order={k:'hold'}; sq.cx=sq.mx; sq.cy=sq.my; reslot(sq); }
    if(sq.order.k==='move'&&!(sq.U.abilities.includes('mountedFire'))){sq.focus=null;return;}
    let best=null,bd=1e9;
    const reach=sq.ranged&&sq.fire?sq.reach:14;
    for(const e of sim.squads){ if(e.team===sq.team||e.nAlive<=0)continue; if(!isVisible(sq.team,e))continue;
      const d=Math.hypot(e.mx-sq.mx,e.my-sq.my)-e.rad*0.6-sq.rad*0.3; if(d<=reach&&d<bd){bd=d;best=e;} }
    sq.focus=best;
  }
  // видимость для ИИ/целей (туман)
  const vis=[new Uint8Array(sim.sol.length),new Uint8Array(sim.sol.length)];
  function isVisible(team,sq){ if(!sim.fog)return true; for(const s of sq.soldiers){ if(s.alive&&vis[team][s.id])return true; } return false; }
  function computeVision(){
    if(!sim.fog){vis[0].fill(1);vis[1].fill(1);return;}
    vis[0].fill(0);vis[1].fill(0);
    const R=g.sight, rr=Math.ceil(R/CELL);
    for(const s of sim.sol){ if(!s.alive)continue; const team=s.team, o=1-team;
      const cx=(s.x/CELL)|0, cy=(s.y/CELL)|0; vis[team][s.id]=1;
      for(let yy=Math.max(0,cy-rr);yy<=Math.min(GN-1,cy+rr);yy++)for(let xx=Math.max(0,cx-rr);xx<=Math.min(GN-1,cx+rr);xx++){
        for(let i=head[xx+yy*GN];i!==-1;i=nxt[i]){const e=sim.sol[i]; if(e.team!==o||vis[team][i])continue; const dx=e.x-s.x,dy=e.y-s.y,d2=dx*dx+dy*dy;
          const lim=e.grass?g.grassSight:R; if(d2<=lim*lim)vis[team][i]=1;}
      }
    }
  }
  sim.vis=vis; sim.isVisible=isVisible;

  function acquire(s){
    const sq=s.sq;
    const adj=nearestEnemy(s,3.4);
    if(adj&&(!sim.fog||vis[s.team][adj.id])){s.tg=adj;return;}
    const f=sq.focus; if(!f||f.nAlive<=0){s.tg=null;return;}
    const dirx=f.mx-sq.mx, diry=f.my-sq.my, base=Math.atan2(diry,dirx), lim=(g.wrapAngle*PI/360);
    let best=null,bd=1e9;
    for(const e of f.soldiers){ if(!e.alive)continue; if(sim.fog&&!vis[s.team][e.id])continue;
      const dx=e.x-s.x,dy=e.y-s.y; let d=Math.hypot(dx,dy);
      if(sq.U.role!=='ranged'&&Math.abs(angDiff(Math.atan2(dy,dx),base))>lim&&d>4)continue;
      if(e.nAtt>=g.maxAttackersPerTarget&&sq.U.role!=='ranged')d+=14; if(sq.U.role==='ranged'||sq.U.abilities.includes('mountedFire'))d+=Math.random()*9;
      if(d<bd){bd=d;best=e;} }
    s.tg=best;
  }

  function routStep(s,dt){
    const U=s.U, sq=s.sq, dir=s.team===0?1:-1; s.tg=null; s.eng=false; s.wall=0;
    let kx=0; const e=nearestEnemy(s,14); if(e){ const dx=s.x-e.x; kx=dx/(Math.abs(dx)+3)*0.8; }
    const heading=Math.atan2(dir,kx), tr=g.turnRate*2.5*dt, df=angDiff(heading,s.face);
    s.face+=clamp(df,-tr,tr); if(s.face>PI)s.face-=TAU; else if(s.face<-PI)s.face+=TAU;
    const tf=terrainFlags(s); const base=g.unitSpeed*(U.role==='cav'?1.7:U.speed/100)*1.25, spd=base*tf;
    s.v=spd; s.moving=true; s.sp=U.role==='cav'?160:100; s.still=0; s.mass=1;
    s.x+=Math.cos(s.face)*spd*dt; s.y+=Math.sin(s.face)*spd*dt; s.odo+=spd*dt;
    if(s.y<2.5||s.y>S-2.5||sim.t-sq.routAt>24)vanish(s);
  }
  // мораль
  function moraleStep(dt){
    const calc=sim.tick%5===0, sqs=sim.squads;
    for(const sq of sqs){
      if(sq.nAlive<=0||sq.routed)continue; const st=sq.U.morale; if(!st)continue;
      sq.rec*=Math.exp(-dt/8);
      if(calc){
        let fr=0,en=0,mult=1,fear=0,pan=0;
        for(const o of sqs){ if(o.nAlive<=0)continue; const d=Math.hypot(o.mx-sq.mx,o.my-sq.my);
          if(o.team===sq.team){ if(!o.routed&&d<35)fr+=o.nAlive; if(!o.routed&&o.U.abilities.includes('inspire')&&d<22)mult=0.55; if(o.routed&&d<28)pan=18; }
          else if(!o.routed){ if(d<30)en+=o.nAlive; if(o.U.abilities.includes('fear')&&d<20)fear=Math.max(fear,25*o.nAlive/o.soldiers.length); } }
        const ratio=en/Math.max(1,fr), out=en>0&&ratio>1.15?Math.min(30,(ratio-1.15)*20):0;
        sq.ex=(out+fear+pan)*mult; sq.mult=mult;
      }
      const loss=80*(1-sq.nAlive/sq.soldiers.length), press=((loss+Math.min(30,sq.rec*0.6))*(sq.mult||1)+sq.ex)/st, target=clamp(100-press,0,100);
      if(target<sq.mor)sq.mor=Math.max(target,sq.mor-dt*8); else sq.mor=Math.min(target,sq.mor+dt*3);
      if(sq.mor<=0.5){ sq.routed=true; sq.routAt=sim.t; sq.order={k:'hold'}; sq.focus=null; sq.mor=0; sim.events.push({e:'r',sq:sq.id}); }
    }
  }
  function stepSoldier(s,dt){
    const sq=s.sq, U=s.U, ord=sq.order, ab=U.abilities;
    s.cd-=dt; s.swap-=dt; s.pface=s.face; s.px=s.x; s.py=s.y;
    if(sq.routed){ routStep(s,dt); return; }
    if(s.tgT<=0||!s.tg||!s.tg.alive){acquire(s);s.tgT=0.3+Math.random()*0.3;}else s.tgT-=dt;
    const tg=s.tg;
    // стоячий бонус «Стена»
    // цель/оружие
    let d=Infinity,wi=s.w,w=U.weapons[wi],reach=0,inRange=false,goalX=0,goalY=0,haveGoal=false,runFlag=true,faceTo=null,chase=false;
    slotXY(sq,s.slot,tmp); const slx=tmp.x, sly=tmp.y;
    if(tg){
      d=Math.hypot(tg.x-s.x,tg.y-s.y);
      const best=pickWeapon(s,d);
      if(best!==wi){ if(s.swap<=0){ s.w=best; wi=best; w=U.weapons[wi]; s.swap=g.swapTime; } }
      reach=w.max*(1);
      inRange=d<=reach+0.02&&d>=w.min-0.5;
    }
    let attackAllowed=false;
    if(ord.k==='move'){
      goalX=slx;goalY=sly;haveGoal=true;
      if(tg&&inRange&&(w.kind==='melee'||ab.includes('mountedFire')))attackAllowed=true;
    }else{
      if(tg){
        const rangedFallbackMelee=U.role==='ranged'||ab.includes('mountedFire');
        if(inRange){attackAllowed=true;haveGoal=false;faceTo=tg;}
        else{
          const toFar=d>reach;
          const chaseOK=(!sq.mar&&!sq.hf&&(ord.k==='attack'||d<16))||(sq.hf&&d<5&&Math.hypot(tg.x-slx,tg.y-sly)<9);
          const tooClose=d<w.min-0.5;
          if(tooClose&&rangedFallbackMelee&&d>10){haveGoal=true;goalX=slx;goalY=sly;}
          else if(chaseOK&&Math.hypot(tg.x-sq.cx,tg.y-sq.cy)<(ord.k==='attack'?9999:40)&&Math.hypot(s.x-sq.mx,s.y-sq.my)<12+3.2*Math.sqrt(sq.nAlive)){
            const ux=(tg.x-s.x)/d,uy=(tg.y-s.y)/d,stop=Math.max(0.5,Math.min(reach,w.max)*0.85);
            goalX=tg.x-ux*stop;goalY=tg.y-uy*stop;haveGoal=true;chase=true;faceTo=null;
          } else {goalX=slx;goalY=sly;haveGoal=true;}
        }
      }else{goalX=slx;goalY=sly;haveGoal=true;}
    }
    // обход препятствий по пути A*
    if(haveGoal){
      const gd=Math.hypot(goalX-s.x,goalY-s.y);
      if(gd<=3){ s.np=null; }
      else{
        s.navT=(s.navT||0)-dt;
        if(s.navT<=0){
          if(nav.los(s.x,s.y,goalX,goalY)){ s.np=null; s.navT=0.35+Math.random()*0.3; }
          else if(sim.navBudget>0){ sim.navBudget--; const pth=nav.path(s.x,s.y,goalX,goalY,0); s.np=pth&&pth.length>1?pth:null; s.npi=1; s.navT=0.6+Math.random()*0.4; }
          else s.navT=0.08;
        }
        if(s.np){ const np=s.np; while(s.npi<np.length-1&&Math.hypot(np[s.npi].x-s.x,np[s.npi].y-s.y)<3)s.npi++;
          if(s.npi<np.length-1||Math.hypot(np[np.length-1].x-goalX,np[np.length-1].y-goalY)>20){ goalX=np[Math.min(s.npi,np.length-1)].x; goalY=np[Math.min(s.npi,np.length-1)].y; } else { s.np=null; } }
      }
    }
    // маршрут через мосты
    if(haveGoal&&!s.np&&map.rivers.length&&map.bridges.length){
      for(const rv of map.rivers){
        const cs=rv.f(s.x), cg=rv.f(goalX), sy=s.y-cs, gy=goalY-cg, edge=rv.hw*1.12+2.5, inBand=Math.abs(sy)<=edge, side=sy<0?-1:1, wantSide=gy<0?-1:1;
        if(!inBand&&(side===wantSide&&Math.abs(gy)>edge))continue;
        let bb=null,bs=1e9; for(const b of map.bridges){ if(b.ri!==rv.ri)continue; const sc=inBand?Math.abs(s.x-b.x):Math.abs(s.x-b.x)+Math.abs(b.x-goalX); if(sc<bs){bs=sc;bb=b;} }
        if(!bb)continue;
        if(inBand){goalX=bb.x;goalY=bb.y+wantSide*(edge+3);}
        else if(Math.abs(s.x-bb.x)>bb.hw*0.5){goalX=bb.x;goalY=bb.y+side*(edge+1.5);}
        else{goalX=bb.x;goalY=bb.y+wantSide*(edge+3);}
        break;
      }
    }
    // движение
    const tf=terrainFlags(s);
    let want=0,heading=s.face,dist2go=0;
    if(haveGoal){const dx=goalX-s.x,dy=goalY-s.y,dist=Math.hypot(dx,dy); dist2go=dist; if(dist>0.5){heading=Math.atan2(dy,dx);want=Math.min(1,dist/0.8);} }
    else if(faceTo){heading=Math.atan2(faceTo.y-s.y,faceTo.x-s.x);}
    if(want===0&&!faceTo&&ord.k!=='attack')heading=sq.face;
    if(attackAllowed&&faceTo==null&&tg)heading=want>0?heading:Math.atan2(tg.y-s.y,tg.x-s.x);
    // поворот
    const tr=(U.role==='cav'?g.turnRateCav:g.turnRate)*dt, df=angDiff(heading,s.face);
    s.face+=clamp(df,-tr,tr); if(s.face>PI)s.face-=TAU; else if(s.face<-PI)s.face+=TAU;
    // скорость
    let spd=0;
    if(want>0){
      const diff=Math.abs(angDiff(heading,s.face)), turnK=diff>1.2?0.15:diff>0.5?0.6:1;
      let base=g.unitSpeed;
      if(U.role==='cav'){
        const mx=U.maxSpeed||100;
        if(diff<0.25&&!s.swamp){s.sp=Math.min(mx,s.sp+g.charge.accel*dt);} else s.sp=Math.max(100,s.sp-g.charge.decel*dt);
        if(!chase&&dist2go<25)s.sp=Math.min(s.sp,100+dist2go*12);
        base*=s.sp/100;
      }else base*=U.speed/100;
      spd=base*tf*turnK*want;
      if(!chase&&U.role!=='cav'&&dist2go>7&&(sq.mar||ord.k==='move'))spd*=1.3;
    }else{ if(U.role==='cav')s.sp=Math.max(100,s.sp-g.charge.decel*dt); }
    if(s.swamp&&U.role==='cav')s.sp=100;
    s.v=spd; s.moving=spd>0.1;
    s.x+=Math.cos(s.face)*spd*dt; s.y+=Math.sin(s.face)*spd*dt; s.odo+=spd*dt;
    s.eng=!!(tg&&inRange&&d<4);
    s.still=s.moving?0:s.still+dt;
    s.wall=ab.includes('shieldWall')&&s.still>=2?1:0;
    s.mass=s.moving?1:(s.eng?3:2);
    // атака
    if(attackAllowed&&tg&&s.cd<=0&&s.swap<=0){
      const fdiff=Math.abs(angDiff(Math.atan2(tg.y-s.y,tg.x-s.x),s.face));
      if(fdiff<0.7||w.kind==='ranged'&&fdiff<1.0){
        let cdm=w.cd; if(ab.includes('berserk')&&s.hp<s.maxhp*0.5)cdm/=1.3;
        if(w.kind==='melee'){
          let mult=1;
          if(U.role==='cav'&&s.sp>=g.charge.minSpeed&&ab.includes('charge')){
            const frontal=tg.U.abilities.includes('antiCav')&&Math.abs(angDiff(Math.atan2(s.y-tg.y,s.x-tg.x),tg.face))<=g.charge.stopSector*PI/180;
            if(frontal){ s.sp=100; s.hp=0; die(s,tg); s.cd=cdm; return; }
            mult=s.sp/100; s.sp=100;
          }
          applyHit(s,tg,w,mult); s.cd=cdm; s.lastAtk=sim.t;
        }else{
          // выстрел
          if(!losBlocked(s.x,s.y,tg.x,tg.y)||(w.fx&&(w.fx.area||w.fx.fire))){
            if(w.ammo!=null)s.ammo[wi]--;
            const wf=w.fx||{};
            if(wf.pierce){ // болт насквозь по линии
              const jit=(Math.random()+Math.random()-1)*0.03, a0=Math.atan2(tg.y-s.y,tg.x-s.x)+jit, L=w.max, ux=Math.cos(a0), uy=Math.sin(a0), ex=s.x+ux*L, ey=s.y+uy*L;
              const hits=[]; for(const e of sim.sol){ if(!e.alive||e.team===s.team)continue; const dx=e.x-s.x,dy=e.y-s.y,pr=dx*ux+dy*uy; if(pr<w.min||pr>L)continue; if(Math.abs(-dx*uy+dy*ux)<=(wf.width||1.0))hits.push([pr,e]); }
              hits.sort((p,q)=>p[0]-q[0]); let m=1,cut=L; for(let i=0;i<hits.length&&i<(wf.maxHits||10);i++){ applyHit(s,hits[i][1],w,m); m*=0.9; cut=hits[i][0]; }
              if(hits.length>=(wf.maxHits||10))cut=hits[(wf.maxHits||10)-1][0];
              sim.events.push({e:'s',tm:s.team,x1:s.x,y1:s.y,x2:s.x+ux*Math.min(L,hits.length?cut+4:L),y2:s.y+uy*Math.min(L,hits.length?cut+4:L),k:2});
              s.cd=cdm*(0.9+Math.random()*0.25); s.lastAtk=sim.t; return;
            }
            if(wf.area||wf.fire){ // навесной бросок / камень
              const sc=(wf.scatter||0.08)*d, an=Math.random()*TAU, rr=Math.random()*sc, ix=tg.x+Math.cos(an)*rr, iy=tg.y+Math.sin(an)*rr;
              sim.pend.push({t:sim.t+d/(wf.speed||40),x:ix,y:iy,s,w});
              sim.events.push({e:'s',tm:s.team,x1:s.x,y1:s.y,x2:ix,y2:iy,k:wf.fire?4:3});
              s.cd=cdm*(0.9+Math.random()*0.25); s.lastAtk=sim.t; return;
            }
            let p=0.66-d/(Math.max(10,w.max)*1.7)-tg.v*0.04; if(s.moving)p*=0.5; p=clamp(p,0.06,0.62);
            let victim=null;
            if(Math.random()<p)victim=tg; else if(Math.random()<0.3)victim=enemyNear(tg.x,tg.y,s.team,2.5);
            sim.events.push({e:'s',tm:s.team,x1:s.x,y1:s.y,x2:victim?victim.x:tg.x+(Math.random()-0.5)*4,y2:victim?victim.y:tg.y+(Math.random()-0.5)*4,k:w.fx&&w.fx.pilum?1:0});
            if(victim)applyHit(s,victim,w,1);
            s.cd=cdm*(0.85+Math.random()*0.5); s.lastAtk=sim.t;
          }else s.cd=0.5;
        }
      }
    }
  }

  function stepPending(dt){
    for(let i=sim.pend.length-1;i>=0;i--){ const p=sim.pend[i]; if(sim.t<p.t)continue; sim.pend.splice(i,1);
      const wf=p.w.fx||{}, sh=p.s;
      if(wf.fire){ const near=sim.fires.find(q=>Math.hypot(q.x-p.x,q.y-p.y)<1.5); if(near)near.until=Math.max(near.until,sim.t+(wf.dur||15)); else{ const f={x:p.x,y:p.y,r:wf.radius||3,until:sim.t+(wf.dur||15),acc:0,dps:p.w.dmg,sq:sh.sq}; sim.fires.push(f); sim.events.push({e:'f',x:f.x,y:f.y,r:f.r,dur:wf.dur||15}); } }
      else{ const R=wf.area; sim.events.push({e:'i',x:p.x,y:p.y,r:R});
        for(const e of sim.sol){ if(!e.alive||e.team===sh.team)continue; const d=Math.hypot(e.x-p.x,e.y-p.y); if(d>R)continue;
          const dmg=p.w.dmg*(1-0.6*d/R)*100/(100+e.armor*0.5); sh.sq.dmg+=Math.min(dmg,Math.max(0,e.hp)); e.hp-=dmg; e.sq.lastCombat=sim.t; sh.sq.lastCombat=sim.t; e.sq.rec+=(wf.shock||0.6)*100/e.sq.soldiers.length*0.5; if(Math.random()<0.5)sim.events.push({e:'h',x:e.x,y:e.y,id:e.id,k:2}); if(e.hp<=0)die(e,sh); } }
    }
    for(let i=sim.fires.length-1;i>=0;i--){ const f=sim.fires[i]; if(sim.t>=f.until){ sim.fires.splice(i,1); continue; }
      f.acc+=dt; if(f.acc<0.5)continue; f.acc-=0.5;
      for(const e of sim.sol){ if(!e.alive)continue; if(Math.abs(e.x-f.x)>f.r||Math.abs(e.y-f.y)>f.r)continue; if(Math.hypot(e.x-f.x,e.y-f.y)>f.r)continue;
        if(e.burnAt!==undefined&&sim.t-e.burnAt<0.45)continue; e.burnAt=sim.t;
        if(f.sq&&f.sq.team!==e.sq.team)f.sq.dmg+=Math.min(f.dps*0.5,Math.max(0,e.hp)); e.hp-=f.dps*0.5; e.sq.lastCombat=sim.t; e.sq.rec+=0.15*100/e.sq.soldiers.length; if(e.hp<=0)die(e,{sq:f.sq}); }
    }
  }
  function collide(){
    const R2=g.soldierRadius*2, R22=R2*R2;
    for(const a of sim.sol){ if(!a.alive)continue; const cx=(a.x/CELL)|0, cy=(a.y/CELL)|0;
      for(let yy=Math.max(0,cy-1);yy<=Math.min(GN-1,cy+1);yy++)for(let xx=Math.max(0,cx-1);xx<=Math.min(GN-1,cx+1);xx++){
        for(let i=head[xx+yy*GN];i!==-1;i=nxt[i]){ if(i<=a.id)continue; const b=sim.sol[i]; if(!b.alive)continue;
          let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy; if(d2>=R22)continue;
          let d=Math.sqrt(d2); if(d<0.001){dx=Math.random()-0.5;dy=Math.random()-0.5;d=Math.hypot(dx,dy)||1;}
          const ov=R2-d, nx=dx/d, ny=dy/d, enemy=a.team!==b.team;
          const k=enemy?1.0:0.35, wa=b.mass/(a.mass+b.mass), wb=1-wa;
          a.x-=nx*ov*k*wa; a.y-=ny*ov*k*wa; b.x+=nx*ov*k*wb; b.y+=ny*ov*k*wb;
        } } }
  }
  function obstacles(){
    const r=g.soldierRadius;
    for(const s of sim.sol){ if(!s.alive)continue;
      for(const q of map.rocks){const dx=s.x-q.x,dy=s.y-q.y,d2=dx*dx+dy*dy; if(d2>(q.r*1.45+r)*(q.r*1.45+r))continue; const lim=blobR(q,Math.atan2(dy,dx))+r; if(d2<lim*lim){const d=Math.sqrt(d2)||0.01; s.x=q.x+dx/d*lim; s.y=q.y+dy/d*lim;}}
      for(const q of map.rects){
        const dx=s.x-q.x,dy=s.y-q.y; if(Math.abs(dx)>q.hw+q.hh+3&&Math.abs(dy)>q.hw+q.hh+3)continue;
        const lx=dx*q.c+dy*q.s, ly=-dx*q.s+dy*q.c, cxp=clamp(lx,-q.hw,q.hw), cyp=clamp(ly,-q.hh,q.hh), ddx=lx-cxp, ddy=ly-cyp, d2=ddx*ddx+ddy*ddy;
        if(d2<r*r){ let px,py;
          if(d2>1e-6){const d=Math.sqrt(d2);px=cxp+ddx/d*r;py=cyp+ddy/d*r;}
          else{ const ox=q.hw-Math.abs(lx), oy=q.hh-Math.abs(ly); if(ox<oy){px=(lx<0?-1:1)*(q.hw+r);py=ly;}else{px=lx;py=(ly<0?-1:1)*(q.hh+r);} }
          s.x=q.x+px*q.c-py*q.s; s.y=q.y+px*q.s+py*q.c; }
      }
      s.x=clamp(s.x,0.5,S-0.5); s.y=clamp(s.y,0.5,S-0.5);
    }
  }

  function updatePoint(dt){
    const p=map.point, pt=sim.pt, c=[0,0], rr=p.r*p.r;
    for(const s of sim.sol){ if(!s.alive||s.sq.routed)continue; const dx=s.x-p.x,dy=s.y-p.y; if(dx*dx+dy*dy<=rr)c[s.team]++; }
    pt.inside=c;
    if(c[0]&&c[1]){ pt.ctrlT=0; pt.ctrlTeam=-1; if(pt.owner>=0)pt.prog=0; return; }
    const only=c[0]?0:c[1]?1:-1;
    if(only<0){pt.ctrlT=0;pt.ctrlTeam=-1;return;}
    if(pt.owner===only){ pt.prog=Math.min(100,pt.prog+dt*100/g.pointCaptureTime); pt.ctrlT=0; pt.ctrlTeam=-1; if(pt.prog>=100)finish(only,'capture'); }
    else{
      if(pt.ctrlTeam!==only){pt.ctrlTeam=only;pt.ctrlT=0;}
      pt.ctrlT+=dt; if(pt.ctrlT>=g.pointCtrlTime){pt.owner=only;pt.prog=0;pt.ctrlT=0;pt.ctrlTeam=-1;sim.events.push({e:'c',team:only});}
    }
  }
  function finish(team,reason){ if(sim.over)return; sim.over=true; sim.phase='over'; sim.winner=team; sim.reason=reason; }

  sim.start=function(){ if(sim.phase!=='deploy')return; sim.phase='battle'; sim.t=0; sim.phaseT=g.battleTime; for(const sq of sim.squads){ updateSquadStats(sq); sq.cx=sq.mx; sq.cy=sq.my; reslot(sq); } };
  sim.step=function(){
    const dt=DT; sim.tick++; sim.navBudget=10;
    if(sim.phase==='deploy'){
      sim.phaseT-=dt; const humans=sim.players.filter(p=>p.human&&!p.gone);
      if(sim.phaseT<=0||(humans.length&&humans.every(p=>p.ready)))sim.start();
      return;
    }
    if(sim.phase!=='battle')return;
    sim.t+=dt; sim.phaseT-=dt;
    buildGrid();
    for(const s of sim.sol)s.nAtt=0;
    for(const s of sim.sol)if(s.alive&&s.tg&&s.tg.alive)s.tg.nAtt++;
    if(sim.tick%4===0)computeVision();
    for(const sq of sim.squads){ updateSquadStats(sq); marchStep(sq,dt); sq.focusT-=dt; if(sq.focusT<=0||(sq.focus&&sq.focus.nAlive<=0)){pickFocus(sq);sq.focusT=0.4+Math.random()*0.3;} }
    if(g.morale!==false)moraleStep(dt);
    const arr=sim.sol;
    for(let i=0;i<arr.length;i++){const s=arr[i]; if(s.alive)stepSoldier(s,dt);}
    // реген и способности
    for(const s of arr){ if(!s.alive)continue;
      if(sim.t-s.sq.lastCombat>=g.regenDelay&&!s.U.abilities.includes('berserk')&&s.hp<s.maxhp*g.regenCap){ s.hp=Math.min(s.maxhp*g.regenCap,s.hp+s.maxhp*g.regenRate*dt); }
    }
    collide(); obstacles();
    stepPending(dt);
    updatePoint(dt);
    // «приказ выполнен» -> стойка
    for(const sq of sim.squads){ if(sq.order.k==='move'&&sq.nAlive>0&&(!sq.mar||(sq.wx===sq.cx&&sq.wy===sq.cy))){ let far=0; for(const s of sq.soldiers){ if(!s.alive)continue; slotXY(sq,s.slot,tmp); if(Math.hypot(tmp.x-s.x,tmp.y-s.y)>3){far++;} } if(far===0)sq.order={k:'hold'}; } }
    // победа
    const alive=[0,0]; for(const sq of sim.squads)alive[sq.team]+=sq.nAlive;
    if(!sim.over){
      if(alive[0]===0&&alive[1]===0)finish(-1,'mutual'); else if(alive[0]===0)finish(1,'annihilation'); else if(alive[1]===0)finish(0,'annihilation');
      else if(sim.phaseT<=0){ if(sim.pt.owner>=0)finish(sim.pt.owner,'timer'); else finish(-1,'draw'); }
    }
    if(sim.events.length>400)sim.events.splice(0,sim.events.length-400);
  };
  sim.stats=function(){ // итоги боя по игрокам и отрядам
    return sim.players.map((p,i)=>{ let k=0,d=0,lost=0,alive=0,tot=0; const sqs=p.squads.map(q=>{ k+=q.kills; d+=q.dmg; lost+=q.n0-q.nAlive; alive+=q.nAlive; tot+=q.n0; return {u:q.unit,n0:q.n0,al:q.nAlive,k:q.kills,d:Math.round(q.dmg),rt:q.routed?1:0}; });
      return {i,name:p.name,team:p.team,k,d:Math.round(d),lost,alive,tot,sq:sqs}; }); };
  sim.surrender=function(pi){ const p=sim.players[pi]; if(!p)return; p.gone=true; p.ready=true; for(const sq of p.squads){ for(const s of sq.soldiers){ if(s.alive)die(s,s); } sq.order={k:'hold'}; } };
  sim.teamAlive=function(){const a=[0,0];for(const sq of sim.squads)a[sq.team]+=sq.nAlive;return a;};
  sim.prepare=function(){buildGrid();computeVision();};
  autoLayoutAll();
  return sim;
}

root.PB=root.PB||{}; Object.assign(root.PB,{createSim,genMap,merge,rng,angDiff,clamp,blobR,inBlob});
if(typeof module!=='undefined')module.exports=root.PB;
})(typeof window!=='undefined'?window:globalThis);
