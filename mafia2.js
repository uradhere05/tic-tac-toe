'use strict';
const DB='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
const AVATARS=['🕵️','🔪','👻','🎭','🩸','🗡️','🕯️','🧪','🔍','💀'];
const COLORS=['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];
const CMAP=Object.fromEntries(NAMES.map((n,i)=>[n,COLORS[i]]));
const AMAP=Object.fromEntries(NAMES.map((n,i)=>[n,AVATARS[i]]));
const ROLE_CFG={
  murderer:    {icon:'🔪',desc:'Each night, choose someone to eliminate.'},
  doctor:      {icon:'💊',desc:'Each night, choose someone to protect from the murderer.'},
  investigator:{icon:'🔍',desc:'Each night, investigate one player to reveal their innocence.'},
  civilian:    {icon:'👤',desc:'Survive the night. Discuss and vote wisely during the day.'},
};

/* ─── State ─── */
let isHost=false,myName='',myRole=null,round=1;
let rolesMap={},aliveMap={},myAction=null,myVote=null,ivs=[],knownPhase='';

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
function toast(m,d=2600){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>e.classList.remove('show'),d);}
function stopIvs(){ivs.forEach(clearInterval);ivs=[];}
function hShow(id){['h-setup','h-night','h-day','h-end'].forEach(s=>document.getElementById(s).style.display=s===id?'':'none');}

/* ─── Entry ─── */
function init(){
  if(new URLSearchParams(window.location.search).has('host')){
    isHost=true; show('s-host'); hShow('h-setup'); renderCheckboxes();
  } else {
    const stored=localStorage.getItem('filoName');
    if(stored){myName=stored;show('s-player');startPlayerPolling();}
    else show('s-join');
  }
}

function joinAs(name){
  myName=name; localStorage.setItem('filoName',name);
  document.querySelectorAll('.name-card').forEach(c=>c.classList.toggle('mine',c.dataset.name===name));
  show('s-player'); startPlayerPolling();
}

/* ════════════════════════════════
   HOST
════════════════════════════════ */
let selectedPlayers=[];

function renderCheckboxes(){
  document.getElementById('player-checks').innerHTML=NAMES.map(n=>`
    <label class="pc-label" onclick="togglePC('${n}',this)">
      <input type="checkbox" value="${n}">
      <span class="pc-av">${AMAP[n]}</span><span>${n}</span>
    </label>`).join('');
}

function togglePC(name,el){
  el.classList.toggle('checked');
  const on=el.classList.contains('checked');
  selectedPlayers=on?[...selectedPlayers.filter(n=>n!==name),name]:selectedPlayers.filter(n=>n!==name);
  document.getElementById('sel-count').textContent=`${selectedPlayers.length} selected`;
  document.getElementById('shuffle-btn').disabled=selectedPlayers.length<4;
  document.getElementById('h-start-btn').style.display='none';
  document.getElementById('role-list').innerHTML='';
}

function shuffleRoles(){
  if(selectedPlayers.length<4){toast('Need at least 4 players');return;}
  const sh=[...selectedPlayers].sort(()=>Math.random()-0.5);
  rolesMap={};
  rolesMap[sh[0]]='murderer'; rolesMap[sh[1]]='doctor'; rolesMap[sh[2]]='investigator';
  sh.slice(3).forEach(n=>rolesMap[n]='civilian');
  document.getElementById('role-list').innerHTML=Object.entries(rolesMap).map(([name,role])=>`
    <div class="role-item ${role}">
      <span class="ri-av">${AMAP[name]}</span>
      <span class="ri-name">${name}</span>
      <span class="ri-role">${role}</span>
    </div>`).join('');
  document.getElementById('h-start-btn').style.display='';
}

async function hostStartGame(){
  if(!Object.keys(rolesMap).length) return;
  const roles={},alive={};
  Object.keys(rolesMap).forEach(n=>{roles[encN(n)]=rolesMap[n];alive[encN(n)]=true;aliveMap[n]=true;});
  await Promise.all([
    fb('PUT','/mafia2/roles',roles), fb('PUT','/mafia2/alive',alive),
    fb('PUT','/mafia2/round',1),     fb('DELETE','/mafia2/night'),
    fb('DELETE','/mafia2/day'),      fb('DELETE','/mafia2/winner'),
    fb('DELETE','/mafia2/announcement'), fb('PUT','/mafia2/phase','night'),
  ]);
  round=1; enterHostNight();
}

function enterHostNight(){
  hShow('h-night');
  document.getElementById('h-rn').textContent=round;
  document.getElementById('h-ann').value='';
  document.getElementById('h-result').textContent='Waiting for actions…';
  document.getElementById('h-actions').innerHTML='';
  stopIvs(); ivs.push(setInterval(pollNightActions,1500));
}

async function pollNightActions(){
  const [killD,saveD,inspD,aliveD]=await Promise.all([
    fb('GET','/mafia2/night/kill'), fb('GET','/mafia2/night/save'),
    fb('GET','/mafia2/night/inspect'), fb('GET','/mafia2/alive'),
  ]);
  if(aliveD) Object.entries(aliveD).forEach(([k,v])=>aliveMap[decN(k)]=v);
  const murd=Object.keys(rolesMap).find(n=>rolesMap[n]==='murderer');
  const doct=Object.keys(rolesMap).find(n=>rolesMap[n]==='doctor');
  const inv =Object.keys(rolesMap).find(n=>rolesMap[n]==='investigator');
  let html='';
  if(murd&&aliveMap[murd]!==false)
    html+=`<div class="act-item ${killD?'submitted':'pending'}">🔪 <b>${murd}</b>: ${killD?`Kill → <b>${killD}</b>`:'Choosing…'}</div>`;
  if(doct&&aliveMap[doct]!==false)
    html+=`<div class="act-item ${saveD?'submitted':'pending'}">💊 <b>${doct}</b>: ${saveD?`Save → <b>${saveD}</b>`:'Choosing…'}</div>`;
  if(inv&&aliveMap[inv]!==false){
    let txt='Choosing…';
    if(inspD){const r=await fb('GET',`/mafia2/roles/${encN(inspD)}`);txt=`Inspect → <b>${inspD}</b> = ${r==='murderer'?'⚠️ MURDERER':'✅ Innocent'}`;}
    html+=`<div class="act-item ${inspD?'submitted':'pending'}">🔍 <b>${inv}</b>: ${txt}</div>`;
  }
  if(!html) html='<div style="opacity:.4;font-size:.83rem">No special roles alive — resolve now.</div>';
  document.getElementById('h-actions').innerHTML=html;
  if(killD){
    const killed=saveD===killD?null:killD;
    document.getElementById('h-result').innerHTML=killed
      ?`💀 <b>${killed}</b> will be killed (Doctor did not save).`
      :`🛡️ <b>${killD}</b> targeted but saved by Doctor — no one dies.`;
    if(!document.getElementById('h-ann').value)
      document.getElementById('h-ann').value=killed?`${killed} was found dead this morning.`:'It was a quiet night. No one was eliminated.';
  } else if(!murd||aliveMap[murd]===false){
    document.getElementById('h-result').textContent='Murderer is dead — resolve immediately.';
    if(!document.getElementById('h-ann').value)
      document.getElementById('h-ann').value='It was a quiet night. No one was eliminated.';
  }
}

async function resolveNight(){
  const [killD,saveD]=await Promise.all([fb('GET','/mafia2/night/kill'),fb('GET','/mafia2/night/save')]);
  const killed=killD&&saveD!==killD?killD:null;
  const ann=document.getElementById('h-ann').value.trim()||(killed?`${killed} was found dead.`:'No one was eliminated tonight.');
  if(killed){await fb('PATCH','/mafia2/alive',{[encN(killed)]:false});aliveMap[killed]=false;}
  await fb('PUT','/mafia2/announcement',ann);
  await fb('PUT','/mafia2/phase','day');
  const w=checkWin(); if(w){await endGame(w);return;}
  stopIvs(); hShow('h-day');
  document.getElementById('h-rd').textContent=round;
  renderAliveList();
  document.getElementById('h-vote-sec').style.display='none';
}

function renderAliveList(){
  document.getElementById('h-alive').innerHTML=Object.keys(rolesMap).map(n=>{
    const a=aliveMap[n]!==false;
    return`<div class="alive-chip${a?'':' dead-chip'}" style="border-color:${CMAP[n]}55;background:${CMAP[n]}18">${AMAP[n]} ${n}${a?'':' 💀'}</div>`;
  }).join('');
}

async function hostOpenVote(){
  await Promise.all([fb('DELETE','/mafia2/day/votes'),fb('PUT','/mafia2/phase','vote')]);
  document.getElementById('h-vote-sec').style.display='';
  stopIvs(); ivs.push(setInterval(pollVotes,1000));
}

async function pollVotes(){
  const votes=await fb('GET','/mafia2/day/votes');
  if(!votes){document.getElementById('h-tally').innerHTML='<div style="opacity:.4;font-size:.83rem">No votes yet…</div>';return;}
  const tally={};
  Object.values(votes).filter(Boolean).forEach(t=>tally[t]=(tally[t]||0)+1);
  document.getElementById('h-tally').innerHTML=Object.entries(tally).sort(([,a],[,b])=>b-a)
    .map(([n,c])=>`<div class="vt-row"><span>${AMAP[n]||''} ${n}</span><span class="vt-count">${c} vote${c!==1?'s':''}</span></div>`).join('')
    ||'<div style="opacity:.4;font-size:.83rem">No votes yet…</div>';
}

async function hostResolveVote(){
  const votes=await fb('GET','/mafia2/day/votes')||{};
  const tally={};
  Object.values(votes).filter(Boolean).forEach(t=>tally[t]=(tally[t]||0)+1);
  let elim=null;
  if(Object.keys(tally).length){
    const max=Math.max(...Object.values(tally));
    const top=Object.entries(tally).filter(([,v])=>v===max).map(([k])=>k);
    if(top.length===1) elim=top[0];
  }
  if(elim){
    await fb('PATCH','/mafia2/alive',{[encN(elim)]:false}); aliveMap[elim]=false;
    const er=rolesMap[elim];
    toast(`${elim} eliminated — ${er}`);
    await fb('PUT','/mafia2/announcement',`${elim} was eliminated. They were ${er==='murderer'?'THE MURDERER! 🔪':`a ${er}.`}`);
  } else {
    await fb('PUT','/mafia2/announcement','Tied vote — no one was eliminated.');
    toast('Tied — no elimination');
  }
  stopIvs();
  const w=checkWin(); if(w){await endGame(w);return;}
  round++;
  await Promise.all([fb('PUT','/mafia2/round',round),fb('DELETE','/mafia2/night'),fb('DELETE','/mafia2/day'),fb('PUT','/mafia2/phase','night')]);
  enterHostNight();
}

function checkWin(){
  const living=Object.keys(rolesMap).filter(n=>aliveMap[n]!==false);
  const murdAlive=living.some(n=>rolesMap[n]==='murderer');
  const civCount=living.filter(n=>rolesMap[n]!=='murderer').length;
  if(!murdAlive) return 'civilians';
  if(murdAlive&&civCount<=1) return 'murderer';
  return null;
}

async function endGame(winner){
  const allRoles=Object.fromEntries(Object.keys(rolesMap).map(n=>[encN(n),rolesMap[n]]));
  await Promise.all([fb('PUT','/mafia2/winner',winner),fb('PUT','/mafia2/allRoles',allRoles),fb('PUT','/mafia2/phase','ended')]);
  stopIvs(); hShow('h-end');
  document.getElementById('h-ei').textContent=winner==='murderer'?'🔪':'🛡️';
  document.getElementById('h-et').textContent=winner==='murderer'?'MURDERER WINS!':'CIVILIANS WIN!';
  document.getElementById('h-es').textContent=winner==='murderer'?'The murderer was never caught.':'Justice prevails!';
  document.getElementById('h-er').innerHTML=Object.entries(rolesMap).map(([n,r])=>`
    <div class="role-item ${r}">
      <span class="ri-av">${AMAP[n]}</span>
      <span class="ri-name">${n}</span>
      <span class="ri-role">${r}${aliveMap[n]===false?' · dead':' · survived'}</span>
    </div>`).join('');
}

async function hostReset(){
  await fb('DELETE','/mafia2');
  rolesMap={};aliveMap={};selectedPlayers=[];round=1;knownPhase='';
  document.querySelectorAll('.pc-label').forEach(l=>l.classList.remove('checked'));
  document.getElementById('role-list').innerHTML='';
  document.getElementById('sel-count').textContent='0 selected';
  document.getElementById('shuffle-btn').disabled=true;
  document.getElementById('h-start-btn').style.display='none';
  hShow('h-setup');
}

/* ════════════════════════════════
   PLAYER
════════════════════════════════ */
function startPlayerPolling(){
  renderWaiting(); stopIvs();
  ivs.push(setInterval(pollPhase,1500));
}

function renderWaiting(){
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card">
      <div class="phase-icon">🌙</div>
      <div class="phase-title">Waiting</div>
      <div class="phase-desc">Host is setting up…<br>Stand by, <strong>${myName}</strong>.</div>
    </div>`;
}

async function pollPhase(){
  const [phD,roundD,annD,winner,aliveD]=await Promise.all([
    fb('GET','/mafia2/phase'),fb('GET','/mafia2/round'),fb('GET','/mafia2/announcement'),
    fb('GET','/mafia2/winner'),fb('GET','/mafia2/alive'),
  ]);
  if(aliveD) Object.entries(aliveD).forEach(([k,v])=>aliveMap[decN(k)]=v);
  if(roundD) round=roundD;
  if(!phD||phD===knownPhase) return;
  knownPhase=phD;
  if(phD==='night'){
    myAction=null;
    if(!myRole){
      myRole=await fb('GET',`/mafia2/roles/${encN(myName)}`)||'civilian';
      showRoleReveal();
    } else showNightUI();
  } else if(phD==='day') showDayAnn(annD||'');
  else if(phD==='vote') {myVote=null;showVoteUI();}
  else if(phD==='ended'&&winner){stopIvs();showPlayerEnd(winner);}
}

function showRoleReveal(){
  const cfg=ROLE_CFG[myRole]||ROLE_CFG.civilian;
  document.getElementById('p-content').innerHTML=`
    <div class="rr-card ${myRole}">
      <div class="rr-icon">${cfg.icon}</div>
      <div class="rr-role ${myRole}">${myRole.toUpperCase()}</div>
      <div class="rr-desc">${cfg.desc}</div>
      <div class="rr-cd" id="rr-cd">Starting in 5…</div>
    </div>`;
  let s=5; const cd=document.getElementById('rr-cd');
  const t=setInterval(()=>{cd.textContent=`Starting in ${--s}…`;if(s<=0){clearInterval(t);showNightUI();}},1000);
}

function showNightUI(){
  const amAlive=aliveMap[myName]!==false;
  if(!amAlive||myRole==='civilian'){
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card night">
        <div class="phase-icon">${amAlive?'🌙':'👻'}</div>
        <div class="phase-title">${amAlive?'Night Falls':'You Are Dead'}</div>
        <div class="phase-desc">${amAlive?'Close your eyes.<br>Wait for the host\'s instructions.':'The night carries on without you…'}</div>
      </div>`;
    return;
  }
  if(myAction){
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card night">
        <div class="phase-icon">${ROLE_CFG[myRole].icon}</div>
        <div class="phase-title">Action Submitted</div>
        <div class="phase-desc">You chose <strong style="color:#FFD200">${myAction}</strong>.<br>Wait for morning…</div>
      </div>`;
    return;
  }
  const alive=NAMES.filter(n=>aliveMap[n]!==false);
  const targets=myRole==='doctor'?alive:alive.filter(n=>n!==myName);
  const verbs={murderer:'Who do you eliminate?',doctor:'Who do you protect?',investigator:'Who do you investigate?'};
  const grid=targets.map(n=>`
    <div class="ag-card" onclick="submitAction('${n}')">
      <div class="ag-av">${AMAP[n]||'👤'}</div>
      <div class="ag-name">${n}</div>
    </div>`).join('');
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card night" style="padding:20px 16px;margin-bottom:12px">
      <div class="rr-icon">${ROLE_CFG[myRole].icon}</div>
      <div class="phase-title" style="font-size:1rem">${myRole.toUpperCase()}</div>
      <div class="phase-desc">${verbs[myRole]}</div>
    </div>
    <div class="action-grid">${grid}</div>`;
}

async function submitAction(target){
  myAction=target;
  const paths={murderer:'/mafia2/night/kill',doctor:'/mafia2/night/save',investigator:'/mafia2/night/inspect'};
  await fb('PUT',paths[myRole],target);
  showNightUI(); snd('click');
}

function showDayAnn(ann){
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card day">
      <div class="phase-icon">☀️</div>
      <div class="phase-title">Morning</div>
    </div>
    <div class="ann-card">${ann||'The town awakens…'}</div>
    <div style="opacity:.45;font-size:.8rem;text-align:center;letter-spacing:1px;padding:0 8px">Discuss with the group.<br>The host will open voting soon.</div>`;
}

function showVoteUI(){
  const alive=NAMES.filter(n=>aliveMap[n]!==false);
  const amAlive=aliveMap[myName]!==false;
  if(!amAlive){
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card">
        <div class="phase-icon">👻</div>
        <div class="phase-title">You Are Dead</div>
        <div class="phase-desc">Watch as the living decide who to eliminate.</div>
      </div>`;
    return;
  }
  if(myVote){
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card day">
        <div class="phase-icon">🗳️</div>
        <div class="phase-title">Vote Cast</div>
        <div class="phase-desc">You voted for <strong style="color:#FFD200">${myVote}</strong>.<br>Waiting for the host to resolve…</div>
      </div>`;
    return;
  }
  const grid=alive.filter(n=>n!==myName).map(n=>`
    <div class="ag-card" onclick="submitVote('${n}')">
      <div class="ag-av">${AMAP[n]||'👤'}</div>
      <div class="ag-name">${n}</div>
    </div>`).join('');
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card day" style="padding:20px 16px;margin-bottom:12px">
      <div class="phase-icon">🗳️</div>
      <div class="phase-title" style="font-size:1.1rem">Vote to Eliminate</div>
      <div class="phase-desc">Who is the murderer?</div>
    </div>
    <div class="action-grid">${grid}</div>`;
}

async function submitVote(target){
  myVote=target;
  await fb('PUT',`/mafia2/day/votes/${encN(myName)}`,target);
  showVoteUI(); snd('click');
}

async function showPlayerEnd(winner){
  const allRoles=await fb('GET','/mafia2/allRoles')||{};
  const myWin=(winner==='murderer'&&myRole==='murderer')||(winner==='civilians'&&myRole!=='murderer');
  const murd=Object.entries(allRoles).map(([k,v])=>({name:decN(k),role:v})).find(x=>x.role==='murderer');
  document.getElementById('p-content').innerHTML=`
    <div class="end-icon">${winner==='murderer'?'🔪':'🛡️'}</div>
    <div class="end-title">${winner==='murderer'?'MURDERER WINS!':'CIVILIANS WIN!'}</div>
    <div class="end-sub">${myWin?'You won! 🎉':'Better luck next time…'}</div>
    ${murd?`<div class="ann-card" style="margin-top:8px">🔪 The Murderer was <strong>${murd.name}</strong></div>`:''}
    <button class="btn btn-secondary" onclick="location.href='index.html'" style="margin-top:14px">↩ Back to Lobby</button>`;
}

/* ─── Sound ─── */
let _actx;
function _ac(){if(!_actx)_actx=new(window.AudioContext||window.webkitAudioContext)();return _actx;}
function snd(type){
  try{const ac=_ac();if(type==='click'){const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=440;g.gain.setValueAtTime(0.12,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.08);o.start();o.stop(ac.currentTime+0.08);}}catch{}
}

/* ─── Init ─── */
init();
