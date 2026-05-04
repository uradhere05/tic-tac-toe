'use strict';
/* ─── Constants ─── */
const DB='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
const AVATARS=['🕵️','🔪','👻','🎭','🩸','🗡️','🕯️','🧪','🔍','💀'];
const COLORS=['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];
const CMAP=Object.fromEntries(NAMES.map((n,i)=>[n,COLORS[i]]));
const AMAP=Object.fromEntries(NAMES.map((n,i)=>[n,AVATARS[i]]));
const SPEED=3.5,PR=14,KILL_R=70,RPT_R=100,KILL_CD=25000;
const DISC=45,VOTE=30,RSLT=6;

/* ─── Canvas ─── */
const canvas=document.getElementById('game-canvas');
const ctx=canvas.getContext('2d');
let MAP={};

/* ─── State ─── */
let myName='',myRole=null,isHost=false,myReady=false;
let players=[],aliveMap={},otherPos={},bodies=[];
let myPos={x:200,y:300};
let keys={up:0,down:0,left:0,right:0,w:0,s:0,a:0,d:0};
let killCdUntil=0,emergencyUsed=false,myVote=null,inspected={};
let gamePhase='lobby',meetingData=null;
let ivs=[],raf=null;
let soundOn=localStorage.getItem('filoSound')!=='off';

/* ─── Firebase ─── */
async function fb(method,path,data){
  const opts={method};
  if(data!==undefined){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
  try{const r=await fetch(`${DB}${path}.json`,opts);return await r.json();}catch{return null;}
}
const encN=n=>n.replace(/\s/g,'_');
const decN=k=>k.replace(/_/g,' ');

/* ─── UI helpers ─── */
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
let _tt;
function toast(m,d=2800){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>e.classList.remove('show'),d);}
function stopIvs(){ivs.forEach(clearInterval);ivs=[];}

/* ─── Name screen ─── */
async function selectName(name){
  const lobby=await fb('GET','/mafia/lobby')||{};
  const taken=Object.values(lobby).find(v=>v&&v.name===name&&name!==myName);
  if(taken){toast('Name taken — pick another!');return;}
  if(myName) await fb('DELETE',`/mafia/lobby/${encN(myName)}`);
  myName=name;
  localStorage.setItem('filoName',name);
  updateNameCards(Object.values(lobby).filter(v=>v).map(v=>v.name));
  await joinLobby();
  show('s-lobby');
  stopIvs();
  ivs.push(setInterval(pollLobby,1500));
  pollLobby();
}

function updateNameCards(online){
  document.querySelectorAll('.name-card').forEach(c=>{
    const n=c.dataset.name;
    c.classList.toggle('mine',n===myName);
    c.classList.toggle('taken',n!==myName&&online.includes(n));
  });
}

/* ─── Lobby ─── */
async function joinLobby(){
  const host=await fb('GET','/mafia/host');
  isHost=!host||host===myName;
  if(!host) await fb('PUT','/mafia/host',myName);
  await fb('PUT',`/mafia/lobby/${encN(myName)}`,{name:myName,ready:false,ts:Date.now()});
}

async function toggleReady(){
  myReady=!myReady;
  await fb('PATCH',`/mafia/lobby/${encN(myName)}`,{ready:myReady});
  document.getElementById('ready-btn').textContent=myReady?'Cancel Ready':'Ready Up';
}

async function hostStart(){
  const lobby=await fb('GET','/mafia/lobby')||{};
  const vals=Object.values(lobby).filter(v=>v&&v.name);
  if(vals.length<5){toast('Need at least 5 players!');return;}
  if(vals.some(v=>!v.ready)){toast('Not everyone is ready!');return;}
  players=vals.map(v=>v.name);
  const shuffled=[...players].sort(()=>Math.random()-0.5);
  const roles={};
  roles[shuffled[0]]='murderer';
  if(players.length>=8) roles[shuffled[1]]='detective';
  shuffled.slice(players.length>=8?2:1).forEach(n=>roles[n]='innocent');
  buildMap();
  const alive={},pos={};
  players.forEach((n,i)=>{
    alive[encN(n)]=true;
    const sp=MAP.spawns[i%10];
    pos[encN(n)]={x:sp.x,y:sp.y,ts:Date.now()};
  });
  await Promise.all([
    fb('PUT','/mafia/roles',Object.fromEntries(players.map(n=>[encN(n),roles[n]]))),
    fb('PUT','/mafia/alive',alive),
    fb('PUT','/mafia/pos',pos),
    fb('DELETE','/mafia/meeting'),
    fb('DELETE','/mafia/winner'),
    fb('DELETE','/mafia/killCd'),
    fb('PUT','/mafia/state','playing'),
  ]);
}

async function pollLobby(){
  const [lobby,state]=await Promise.all([fb('GET','/mafia/lobby'),fb('GET','/mafia/state')]);
  if(!lobby) return;
  if(state==='playing'){stopIvs();beginGame();return;}
  const vals=Object.values(lobby).filter(v=>v&&v.name);
  renderLobby(vals);
  updateNameCards(vals.map(v=>v.name));
}

function renderLobby(vals){
  const readyCount=vals.filter(v=>v.ready).length;
  document.getElementById('lobby-sub').textContent=`Lobby — ${vals.length}/10 players  (${readyCount} ready)`;
  document.getElementById('player-list').innerHTML=vals.map((v,i)=>`
    <div class="player-row${v.ready?' ready':''}">
      <span class="p-dot${v.ready?' ready':''}"></span>
      <span class="p-name-lbl">${v.name}</span>
      ${i===0?'<span class="p-tag">HOST</span>':''}
    </div>`).join('');
  document.getElementById('start-btn').style.display=isHost?'block':'none';
  document.getElementById('need-more').textContent=vals.length<5?`Need ${5-vals.length} more player${5-vals.length===1?'':'s'}`:'';
}

/* ─── Game start ─── */
async function beginGame(){
  const [roleData,aliveData,posData]=await Promise.all([
    fb('GET',`/mafia/roles/${encN(myName)}`),
    fb('GET','/mafia/alive'),
    fb('GET','/mafia/pos'),
  ]);
  myRole=roleData||'innocent';
  if(aliveData) Object.entries(aliveData).forEach(([k,v])=>aliveMap[decN(k)]=v);
  buildMap();
  if(posData&&posData[encN(myName)]){const p=posData[encN(myName)];myPos={x:p.x,y:p.y};}
  showRoleReveal();
}

function showRoleReveal(){
  show('s-reveal');
  document.getElementById('reveal-card').className='reveal-card '+myRole;
  const cfg={
    murderer:{icon:'🔪',role:'MURDERER',desc:'Eliminate innocents one by one. 25s kill cooldown. Blend in.'},
    detective:{icon:'🔍',role:'DETECTIVE',desc:'Inspect one player each meeting to learn their role. Guide the innocents.'},
    innocent:{icon:'👤',role:'INNOCENT',desc:'Survive, investigate, and vote out the murderer before it\'s too late.'},
  }[myRole]||{icon:'👤',role:'INNOCENT',desc:''};
  document.getElementById('reveal-icon').textContent=cfg.icon;
  document.getElementById('reveal-role').textContent=cfg.role;
  document.getElementById('reveal-role').className='reveal-role '+myRole;
  document.getElementById('reveal-desc').textContent=cfg.desc;
  let s=5;const cd=document.getElementById('reveal-cd');
  const t=setInterval(()=>{cd.textContent=`Starting in ${--s}…`;if(s<=0){clearInterval(t);startGamePlay();}},1000);
}

/* ─── Map ─── */
function buildMap(){
  const W=canvas.width=window.innerWidth,H=canvas.height=window.innerHeight;
  const r=(x,y,w,h,c,l='')=>({x:x*W,y:y*H,w:w*W,h:h*H,color:c,label:l,room:!!l});
  MAP.rooms=[
    r(.04,.60,.22,.32,'#180c2a','FOYER'),
    r(.04,.07,.22,.38,'#0a1818','LIBRARY'),
    r(.38,.05,.32,.38,'#180820','BALLROOM'),
    r(.38,.60,.24,.32,'#181400','KITCHEN'),
    r(.74,.42,.23,.50,'#180505','BASEMENT'),
  ];
  MAP.corridors=[
    r(.11,.44,.07,.19,'#120a1e'),r(.24,.70,.15,.06,'#120a1e'),
    r(.24,.13,.15,.06,'#120a1e'),r(.61,.70,.14,.06,'#120a1e'),r(.70,.38,.06,.10,'#120a1e'),
  ];
  MAP.walkable=[...MAP.rooms,...MAP.corridors];
  MAP.spawns=[
    {x:.15*W,y:.78*H},{x:.15*W,y:.26*H},{x:.54*W,y:.24*H},{x:.50*W,y:.78*H},
    {x:.86*W,y:.68*H},{x:.15*W,y:.52*H},{x:.31*W,y:.73*H},{x:.31*W,y:.16*H},
    {x:.68*W,y:.73*H},{x:.73*W,y:.43*H},
  ];
}

/* ─── Game loop ─── */
function startGamePlay(){
  show('s-game');
  gamePhase='playing';
  document.getElementById('emergency-btn').disabled=emergencyUsed||aliveMap[myName]===false;
  stopIvs();
  ivs.push(setInterval(syncPos,300));
  ivs.push(setInterval(pollGameState,500));
  raf=requestAnimationFrame(gameLoop);
  window.addEventListener('resize',buildMap);
}

function gameLoop(){
  raf=requestAnimationFrame(gameLoop);
  if(gamePhase==='playing') updateMovement();
  draw();
  if(gamePhase==='playing'){updateHUD();updateActionBtns();}
}

function draw(){
  const W=canvas.width,H=canvas.height;
  ctx.fillStyle='#04020a';ctx.fillRect(0,0,W,H);
  MAP.walkable.forEach(rect=>{
    ctx.fillStyle=rect.color;ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
    if(rect.label){
      ctx.fillStyle='rgba(255,255,255,0.07)';ctx.font='bold 11px Georgia,serif';
      ctx.textAlign='center';ctx.textBaseline='top';
      ctx.fillText(rect.label,rect.x+rect.w/2,rect.y+8);
    }
    ctx.strokeStyle='rgba(80,0,30,0.25)';ctx.lineWidth=1;
    ctx.strokeRect(rect.x,rect.y,rect.w,rect.h);
  });
  bodies.forEach(b=>{
    ctx.shadowColor='#8B0000';ctx.shadowBlur=16;
    ctx.font='22px serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('💀',b.x,b.y);ctx.shadowBlur=0;
    ctx.fillStyle='rgba(200,50,50,0.8)';ctx.font='9px sans-serif';
    ctx.fillText(b.victim,b.x,b.y+18);
  });
  Object.entries(otherPos).forEach(([name,p])=>{if(name!==myName)drawPlayer(p.x,p.y,name,aliveMap[name]!==false,false);});
  drawPlayer(myPos.x,myPos.y,myName,aliveMap[myName]!==false,true);
}

function drawPlayer(x,y,name,alive,isMe){
  const col=CMAP[name]||'#aaa';
  ctx.globalAlpha=alive?1:0.3;
  ctx.fillStyle='rgba(0,0,0,0.45)';ctx.beginPath();ctx.ellipse(x,y+PR,PR*.8,PR*.3,0,0,Math.PI*2);ctx.fill();
  if(isMe){ctx.shadowColor=col;ctx.shadowBlur=12;}
  ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,PR,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=1.5;ctx.stroke();
  ctx.font=`${PR}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(AMAP[name]||'👤',x,y);
  ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
  ctx.fillStyle=alive?'rgba(255,255,255,0.9)':'rgba(200,60,60,0.8)';
  ctx.fillText(alive?name:'💀 '+name,x,y+PR+4);
  ctx.globalAlpha=1;
}

/* ─── Movement ─── */
function updateMovement(){
  if(aliveMap[myName]===false) return;
  let dx=0,dy=0;
  if(keys.up||keys.w) dy-=SPEED;if(keys.down||keys.s) dy+=SPEED;
  if(keys.left||keys.a) dx-=SPEED;if(keys.right||keys.d) dx+=SPEED;
  if(!dx&&!dy) return;
  if(dx&&dy){dx*=0.707;dy*=0.707;}
  const nx=myPos.x+dx,ny=myPos.y+dy;
  const ok=r=>nx>=r.x+PR&&nx<=r.x+r.w-PR&&ny>=r.y+PR&&ny<=r.y+r.h-PR;
  const okX=r=>nx>=r.x+PR&&nx<=r.x+r.w-PR&&myPos.y>=r.y+PR&&myPos.y<=r.y+r.h-PR;
  const okY=r=>myPos.x>=r.x+PR&&myPos.x<=r.x+r.w-PR&&ny>=r.y+PR&&ny<=r.y+r.h-PR;
  if(MAP.walkable.some(ok)) myPos={x:nx,y:ny};
  else if(MAP.walkable.some(okX)) myPos.x=nx;
  else if(MAP.walkable.some(okY)) myPos.y=ny;
}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

/* ─── HUD ─── */
function updateHUD(){
  const alive=Object.values(aliveMap).filter(v=>v).length,total=Object.keys(aliveMap).length;
  document.getElementById('hud-alive').textContent=`${alive}/${total} alive`;
  document.getElementById('hud-status').textContent=
    aliveMap[myName]===false?'👻 GHOST':myRole==='murderer'?'🔪 MURDERER':myRole==='detective'?'🔍 DETECTIVE':'';
}

function updateActionBtns(){
  const amAlive=aliveMap[myName]!==false;
  const nearby=getNearby(),nearBody=getNearbyBodies();
  const kb=document.getElementById('kill-btn');
  if(myRole==='murderer'&&amAlive){
    kb.style.display='block';
    const cdLeft=Math.max(0,killCdUntil-Date.now());
    kb.disabled=!nearby.length||cdLeft>0;
    document.getElementById('kill-cd').textContent=cdLeft>0?`${Math.ceil(cdLeft/1000)}s`:'';
  } else kb.style.display='none';
  document.getElementById('report-btn').style.display=amAlive&&nearBody.length?'block':'none';
  document.getElementById('emergency-btn').disabled=emergencyUsed||!amAlive;
  const ib=document.getElementById('inspect-btn');
  ib.style.display=myRole==='detective'&&amAlive&&nearby.length?'block':'none';
}

function getNearby(){return Object.entries(otherPos).filter(([n])=>n!==myName&&aliveMap[n]!==false).filter(([,p])=>dist(myPos,p)<KILL_R).map(([n])=>n);}
function getNearbyBodies(){return bodies.filter(b=>dist(myPos,b)<RPT_R);}

/* ─── Kill / Report / Emergency / Inspect ─── */
async function doKill(){
  const targets=getNearby();if(!targets.length||Date.now()<killCdUntil) return;
  const victim=targets[0],id='b'+Date.now();
  await Promise.all([
    fb('PATCH','/mafia/alive',{[encN(victim)]:false}),
    fb('PUT',`/mafia/bodies/${id}`,{victim,x:otherPos[victim].x,y:otherPos[victim].y,ts:Date.now()}),
    fb('PUT',`/mafia/killCd/${encN(myName)}`,Date.now()+KILL_CD),
  ]);
  killCdUntil=Date.now()+KILL_CD;
  snd('kill');toast(`You eliminated ${victim}`);
  checkMurdererWin();
}

async function doReport(){const nb=getNearbyBodies();if(!nb.length) return;await triggerMeeting('body',nb[0].victim);}

async function doEmergency(){
  if(emergencyUsed) return;
  emergencyUsed=true;
  await triggerMeeting('emergency',null);
}

async function doInspect(){
  const targets=getNearby();if(!targets.length) return;
  const target=targets[0];
  if(inspected[target]){toast(`${target}: ${inspected[target]}`);return;}
  const role=await fb('GET',`/mafia/roles/${encN(target)}`);
  inspected[target]=role||'innocent';
  snd('click');
  toast(role==='murderer'?`⚠️ ${target} IS THE MURDERER!`:`✅ ${target} is ${role||'innocent'}`,4000);
}

async function triggerMeeting(reason,victim){
  const state=await fb('GET','/mafia/state');
  if(state!=='playing') return;
  const meetObj={trigger:reason,by:myName,victim:victim||null,startedAt:Date.now(),votes:{},chat:{},result:null};
  await fb('PUT','/mafia/meeting',meetObj);
  await fb('PUT','/mafia/state','meeting');
  snd('meeting');
  if(gamePhase==='playing'){gamePhase='meeting';openMeeting(meetObj);}
}

async function checkMurdererWin(){
  const [aliveData,rolesData]=await Promise.all([fb('GET','/mafia/alive'),fb('GET','/mafia/roles')]);
  if(!aliveData||!rolesData) return;
  const living=Object.entries(aliveData).filter(([,v])=>v).map(([k])=>decN(k));
  const getRole=n=>rolesData[encN(n)]||'innocent';
  const murd=living.filter(n=>getRole(n)==='murderer');
  const inno=living.filter(n=>getRole(n)!=='murderer');
  if(murd.length&&murd.length>=inno.length) await endGame('murderer');
}

/* ─── Position sync + poll ─── */
async function syncPos(){
  if(gamePhase!=='playing') return;
  await fb('PUT',`/mafia/pos/${encN(myName)}`,{x:myPos.x,y:myPos.y,ts:Date.now()});
}

async function pollGameState(){
  const [state,posD,aliveD,bodiesD,cdD,meetD]=await Promise.all([
    fb('GET','/mafia/state'),fb('GET','/mafia/pos'),fb('GET','/mafia/alive'),
    fb('GET','/mafia/bodies'),fb('GET',`/mafia/killCd/${encN(myName)}`),fb('GET','/mafia/meeting'),
  ]);
  if(!state) return;
  if(aliveD) Object.entries(aliveD).forEach(([k,v])=>aliveMap[decN(k)]=v);
  if(posD) Object.entries(posD).forEach(([k,v])=>{const n=decN(k);if(n!==myName)otherPos[n]=v;});
  if(bodiesD) bodies=Object.values(bodiesD).filter(Boolean);
  if(cdD&&cdD>Date.now()) killCdUntil=cdD;
  if(state==='meeting'&&gamePhase==='playing'&&meetD){gamePhase='meeting';openMeeting(meetD);}
  else if(state==='playing'&&gamePhase==='meeting'){gamePhase='playing';closeMeeting();}
  else if(state==='ended'){stopIvs();cancelAnimationFrame(raf);const w=await fb('GET','/mafia/winner');showEnd(w||'murderer');}
  if(state==='meeting'&&meetD) meetingData=meetD;
}

/* ─── Meeting ─── */
function openMeeting(data){
  meetingData=data;
  cancelAnimationFrame(raf);
  document.getElementById('meeting-overlay').style.display='flex';
  document.getElementById('meeting-result').style.display='none';
  document.getElementById('meeting-title').textContent=data.trigger==='body'?'📢 BODY REPORTED':'🚨 EMERGENCY MEETING';
  document.getElementById('meeting-caller').textContent=`Called by ${data.by}${data.victim?' — '+data.victim+' found dead':''}`;
  renderVoteGrid();
  meetingTick();
  ivs.push(setInterval(pollMeeting,600));
  ivs.push(setInterval(meetingTick,500));
}

function closeMeeting(){
  document.getElementById('meeting-overlay').style.display='none';
  myVote=null;meetingData=null;inspected={};
  raf=requestAnimationFrame(gameLoop);
}

function renderVoteGrid(){
  const amAlive=aliveMap[myName]!==false;
  const known=NAMES.filter(n=>aliveMap[n]!==undefined);
  document.getElementById('vote-grid').innerHTML=known.map(n=>{
    const alive=aliveMap[n]!==false,isMe=n===myName,voted=myVote===n;
    const cls=`vote-card${!alive?' dead-card':''}${voted?' voted-card':''}${isMe?' me-card':''}`;
    const click=alive&&!isMe&&amAlive?`onclick="castVote('${n}')"`:'' ;
    return`<div class="${cls}" ${click}><div class="vc-avatar">${AMAP[n]||'👤'}</div><div class="vc-name">${n}</div><div class="vc-count" id="vc-${n.replace(/\s/g,'-')}"></div>${!alive?'<div class="vc-dead-lbl">DEAD</div>':''}</div>`;
  }).join('');
}

async function pollMeeting(){
  const data=await fb('GET','/mafia/meeting');if(!data) return;
  meetingData=data;
  const tally={};
  Object.values(data.votes||{}).filter(v=>v&&v!=='skip').forEach(t=>tally[t]=(tally[t]||0)+1);
  NAMES.forEach(n=>{const el=document.getElementById(`vc-${n.replace(/\s/g,'-')}`);if(el)el.textContent=tally[n]?`🗳 ${tally[n]}`:'' ;});
  const log=document.getElementById('chat-log');
  const msgs=Object.entries(data.chat||{}).sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v);
  log.innerHTML=msgs.map(m=>`<div class="chat-msg${m.ghost?' chat-ghost':''}"><span class="chat-name" style="color:${CMAP[m.name]||'#aaa'}">${m.name}${m.ghost?' 👻':''}:</span> ${m.text}</div>`).join('');
  log.scrollTop=log.scrollHeight;
  if(data.result&&data.result.written) showMeetingResult(data.result);
}

function meetingTick(){
  if(!meetingData) return;
  const e=(Date.now()-meetingData.startedAt)/1000;
  const timerEl=document.getElementById('meeting-timer'),phEl=document.getElementById('meeting-phase-lbl');
  if(e<DISC){timerEl.textContent=Math.ceil(DISC-e);phEl.textContent='DISCUSSION';}
  else if(e<DISC+VOTE){timerEl.textContent=Math.ceil(DISC+VOTE-e);phEl.textContent='VOTE';}
  else if(e<DISC+VOTE+RSLT){
    timerEl.textContent='';phEl.textContent='RESULTS';
    const firstAlive=NAMES.find(n=>aliveMap[n]!==false);
    if(firstAlive===myName&&meetingData&&!meetingData.result?.written) writeResult();
  } else resumeAfterMeeting();
}

async function castVote(target){
  if(aliveMap[myName]===false) return;
  myVote=target;
  await fb('PATCH','/mafia/meeting/votes',{[encN(myName)]:target});
  renderVoteGrid();toast(`Voted for ${target}`);snd('click');
}

async function sendChat(){
  const inp=document.getElementById('chat-input'),text=inp.value.trim();
  if(!text) return;inp.value='';
  const ghost=aliveMap[myName]===false;
  await fb('PATCH','/mafia/meeting/chat',{[`${Date.now()}_${encN(myName)}`]:{name:myName,text,ghost,ts:Date.now()}});
}
document.getElementById('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter')sendChat();});

async function writeResult(){
  if(!meetingData||meetingData.result?.written) return;
  const tally={};
  Object.values(meetingData.votes||{}).filter(v=>v&&v!=='skip').forEach(t=>tally[decN(t)]=(tally[decN(t)]||0)+1);
  let eliminated=null;
  if(Object.keys(tally).length){
    const max=Math.max(...Object.values(tally));
    const top=Object.entries(tally).filter(([,v])=>v===max).map(([k])=>k);
    if(top.length===1) eliminated=top[0];
  }
  const roles=await fb('GET','/mafia/roles')||{};
  const getRole=n=>roles[encN(n)]||'innocent';
  const result={eliminated,revealedRole:eliminated?getRole(eliminated):null,written:true};
  await fb('PATCH','/mafia/meeting',{result});
  if(eliminated){
    await fb('PATCH','/mafia/alive',{[encN(eliminated)]:false});
    aliveMap[eliminated]=false;
    if(getRole(eliminated)==='murderer'){await endGame('innocents');return;}
  }
  checkMurdererWin();
}

function showMeetingResult(result){
  const el=document.getElementById('meeting-result');el.style.display='flex';
  if(result.eliminated){
    document.getElementById('res-icon').textContent='💀';
    document.getElementById('res-title').textContent=`${result.eliminated} eliminated`;
    document.getElementById('res-sub').textContent='The votes have spoken.';
    document.getElementById('res-role').textContent=`They were the ${(result.revealedRole||'INNOCENT').toUpperCase()}`;
  } else {
    document.getElementById('res-icon').textContent='🤫';
    document.getElementById('res-title').textContent='No one eliminated';
    document.getElementById('res-sub').textContent='Tied vote — no one is safe yet.';
    document.getElementById('res-role').textContent='';
  }
}

async function resumeAfterMeeting(){
  if(gamePhase!=='meeting') return;
  const winner=await fb('GET','/mafia/winner');
  if(winner){stopIvs();cancelAnimationFrame(raf);showEnd(winner);return;}
  await fb('PUT','/mafia/state','playing');
  await fb('DELETE','/mafia/meeting');
}

/* ─── End game ─── */
async function endGame(winner){
  const roles=await fb('GET','/mafia/roles');
  await Promise.all([fb('PUT','/mafia/winner',winner),fb('PUT','/mafia/state','ended'),fb('PUT','/mafia/allRoles',roles||{})]);
}

function showEnd(winner){
  show('s-end');
  const iWin=(winner==='murderer'&&myRole==='murderer')||(winner==='innocents'&&myRole!=='murderer');
  document.getElementById('end-icon').textContent=winner==='murderer'?'🔪':'🛡️';
  document.getElementById('end-title').textContent=winner==='murderer'?'MURDERER WINS!':'INNOCENTS WIN!';
  document.getElementById('end-sub').textContent=iWin?'You survived! 🎉':'Better luck next time…';
  fb('GET','/mafia/allRoles').then(roles=>{
    if(!roles) return;
    const murd=Object.entries(roles).map(([k,v])=>({name:decN(k),role:v})).find(x=>x.role==='murderer');
    if(murd){const el=document.getElementById('end-reveal');el.style.display='block';el.innerHTML=`🔪 The Murderer was <strong>${murd.name}</strong>`;}
  });
}

async function playAgain(){
  stopIvs();cancelAnimationFrame(raf);
  gamePhase='lobby';myRole=null;bodies=[];aliveMap={};otherPos={};myVote=null;
  emergencyUsed=false;killCdUntil=0;meetingData=null;myReady=false;
  await fb('DELETE','/mafia');
  await new Promise(r=>setTimeout(r,400));
  await joinLobby();show('s-lobby');
  ivs.push(setInterval(pollLobby,1500));pollLobby();
}

function goHome(){
  stopIvs();cancelAnimationFrame(raf);
  if(myName) fetch(`${DB}/mafia/lobby/${encN(myName)}.json`,{method:'DELETE',keepalive:true});
  window.location.href='index.html';
}

/* ─── Sound ─── */
let _actx;
function _ac(){if(!_actx)_actx=new(window.AudioContext||window.webkitAudioContext)();return _actx;}
function snd(type){
  if(!soundOn) return;
  try{
    const ac=_ac();
    if(type==='kill'){
      const o=ac.createOscillator(),g=ac.createGain();
      o.connect(g);g.connect(ac.destination);o.type='sawtooth';
      o.frequency.setValueAtTime(220,ac.currentTime);o.frequency.exponentialRampToValueAtTime(55,ac.currentTime+0.3);
      g.gain.setValueAtTime(0.35,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.3);
      o.start();o.stop(ac.currentTime+0.3);
    } else if(type==='meeting'){
      [523,392,330].forEach((f,i)=>setTimeout(()=>{
        const o=ac.createOscillator(),g=ac.createGain();
        o.connect(g);g.connect(ac.destination);o.frequency.value=f;
        g.gain.setValueAtTime(0.25,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.4);
        o.start();o.stop(ac.currentTime+0.4);
      },i*200));
    } else if(type==='click'){
      const o=ac.createOscillator(),g=ac.createGain();
      o.connect(g);g.connect(ac.destination);o.frequency.value=440;
      g.gain.setValueAtTime(0.12,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.08);
      o.start();o.stop(ac.currentTime+0.08);
    }
  } catch{}
}

/* ─── Keyboard ─── */
const KM={'ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left','ArrowRight':'right',
  'w':'w','s':'s','a':'a','d':'d','W':'w','S':'s','A':'a','D':'d'};
document.addEventListener('keydown',e=>{if(KM[e.key]!==undefined){keys[KM[e.key]]=1;if(e.key.startsWith('Arrow'))e.preventDefault();}});
document.addEventListener('keyup', e=>{if(KM[e.key]!==undefined) keys[KM[e.key]]=0;});

/* ─── Init ─── */
buildMap();
const _stored=localStorage.getItem('filoName');
if(_stored) document.querySelectorAll('.name-card').forEach(c=>{if(c.dataset.name===_stored)c.classList.add('mine');});
setInterval(async()=>{
  if(!document.getElementById('s-name').classList.contains('active')) return;
  const lobby=await fb('GET','/mafia/lobby')||{};
  updateNameCards(Object.values(lobby).filter(v=>v).map(v=>v.name));
},3000);
window.addEventListener('beforeunload',()=>{
  if(myName) fetch(`${DB}/mafia/lobby/${encN(myName)}.json`,{method:'DELETE',keepalive:true});
});
