'use strict';
const DB='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
const AVATARS=['🧑','👱','🧔','👩','👨','🧑‍🦱','🧑‍🦰','🧑‍🦳','🧑‍🦲','👧'];
const COLORS=['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];
const CMAP=Object.fromEntries(NAMES.map((n,i)=>[n,COLORS[i]]));
const AMAP=Object.fromEntries(NAMES.map((n,i)=>[n,AVATARS[i]]));
const THEMED_AVATARS=['🕵️','🥷','🤵','🧑‍⚕️','👮','🦹','🧙','🤠','🎭','🦸','🧛','🥸'];
const ROLE_CFG={
  murderer:    {icon:'🔪',desc:'Each night, choose someone to eliminate.'},
  doctor:      {icon:'💊',desc:'Each night, choose someone to protect from the murderer.'},
  investigator:{icon:'🔍',desc:'Each night, investigate one player to reveal their innocence.'},
  civilian:    {icon:'👤',desc:'Survive the night. Discuss and vote wisely during the day.'},
};
const MIN_READY=5;

/* ─── State ─── */
let isHost=false,myName='',myRole=null,round=1,hostName='';
let rolesMap={},aliveMap={},myAction=null,myVote=null,mySuspect=null,ivs=[],knownPhase='';
let amReady=false,lobbyPlayers={},lastSave='',myAvatar='',avatarsMap={};
let isEnded=false,myEliminated=false,_lastAutoAnn='';

/* ─── Firebase ─── */
function getWeekKey(){
  const now=new Date();
  const diff=now.getDay()===0?-6:1-now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()+diff);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}
async function recordWin(name){
  const url=`${DB}/leaderboard/${getWeekKey()}/${encodeURIComponent(name)}.json`;
  try{const cur=await fetch(url).then(r=>r.json()).catch(()=>0)||0;await fetch(url,{method:'PUT',body:JSON.stringify(cur+1)});}catch{}
}

async function fb(method,path,data){
  const opts={method};
  if(data!==undefined){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
  try{const r=await fetch(`${DB}${path}.json`,opts);return await r.json();}catch{return null;}
}
const encN=n=>n.replace(/\s/g,'_');
const decN=k=>k.replace(/_/g,' ');

/* ─── UI helpers ─── */
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
let _tt;
function toast(m,d=2600){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>e.classList.remove('show'),d);}
function stopIvs(){ivs.forEach(clearInterval);ivs=[];}
function getAvatar(name){return avatarsMap[name]||AMAP[name]||'👤';}
function hShow(id){['h-night','h-day','h-end'].forEach(s=>document.getElementById(s).style.display=s===id?'':'none');}

/* ════════════════════════════════
   ENTRY
════════════════════════════════ */
function init(){
  const stored=localStorage.getItem('filoName');
  if(stored){
    myName=stored;
    myAvatar=localStorage.getItem('filoAvatar')||'';
    if(!myAvatar){showAvatarSelect();return;}
    checkActiveGame();
  }else{
    window.location.replace('index.html');
  }
}

async function checkActiveGame(){
  try{
    const [phaseD,hostD]=await Promise.all([fb('GET','/mafia2/phase'),fb('GET','/mafia2/host')]);
    if(phaseD&&phaseD!=='ended'){
      const iAmHost=hostD===myName;
      const myRoleInGame=iAmHost?true:await fb('GET',`/mafia2/roles/${encN(myName)}`);
      if(myRoleInGame){
        if(iAmHost){isHost=true;hostName=myName;}
        await writeLobbyPresence();
        stopIvs();
        if(phaseD==='assigning'){
          if(iAmHost){
            const fl=await fb('GET','/mafia2/lobby')||{};
            rolesMap={};
            Object.values(fl).filter(p=>p&&p.name&&p.ready&&p.name!==myName).forEach(p=>rolesMap[p.name]='');
            show('s-assign');renderAssignScreen();
          }else{show('s-player');renderWaiting();startPlayerPolling();}
        }else{
          if(iAmHost)await reconnectHost(phaseD);
          else{show('s-player');startPlayerPolling();}
        }
        return;
      }
    }else if(phaseD==='ended'){
      const [winner,allRolesD]=await Promise.all([fb('GET','/mafia2/winner'),fb('GET','/mafia2/allRoles')]);
      if(winner){
        if(allRolesD){const e=Object.entries(allRolesD).find(([k])=>decN(k)===myName);if(e)myRole=e[1];}
        show('s-player');showPlayerEnd(winner);return;
      }
    }
  }catch{}
  enterRoleSelect();
}

function showAvatarSelect(){
  document.getElementById('av-name-lbl').textContent=myName;
  const saved=myAvatar;
  document.getElementById('av-grid').innerHTML=THEMED_AVATARS.map(av=>`
    <div onclick="pickAvatar('${av}')" style="
      background:${saved===av?'rgba(255,255,255,.15)':'rgba(255,255,255,.05)'};
      border:2px solid ${saved===av?'rgba(255,255,255,.7)':'rgba(255,255,255,.1)'};
      border-radius:14px;padding:14px 4px;cursor:pointer;text-align:center;font-size:2rem
    ">${av}</div>`).join('');
  show('s-avatar');
}

function pickAvatar(av){
  myAvatar=av;
  localStorage.setItem('filoAvatar',av);
  enterRoleSelect();
}

function enterRoleSelect(){
  document.getElementById('rs-name-lbl').textContent=myName;
  show('s-role-select');
}

function joinAsPlayer(){
  enterLobby();
}

async function joinAsGameMaster(){
  const current=await fb('GET','/mafia2/host');
  if(current&&current!==myName){toast(`${current} is already the Game Master`);return;}
  await fb('PUT','/mafia2/host',myName);
  isHost=true;hostName=myName;
  enterLobby();
}

/* ════════════════════════════════
   LOBBY
════════════════════════════════ */
async function enterLobby(){
  amReady=false;myRole=null;myAction=null;myVote=null;knownPhase='';myEliminated=false;
  show('s-lobby');
  await writeLobbyPresence();
  startLobbyPolling();
}

async function writeLobbyPresence(){
  const ts=Date.now();
  await Promise.all([
    fb('PUT',`/mafia2/lobby/${encN(myName)}`,{name:myName,ts,ready:amReady,avatar:myAvatar}),
    fb('PUT',`/online/${encodeURIComponent(myName)}`,{ts}),
  ]);
}

function startLobbyPolling(){
  stopIvs();
  lobbyTick();
  ivs.push(setInterval(lobbyTick,2000));
  ivs.push(setInterval(writeLobbyPresence,20000));
}

async function lobbyTick(){
  if(!document.getElementById('s-lobby').classList.contains('active')) return;

  const [onlineD,lobbyD,hostD,phaseD]=await Promise.all([
    fb('GET','/online'),
    fb('GET','/mafia2/lobby'),
    fb('GET','/mafia2/host'),
    fb('GET','/mafia2/phase'),
  ]);

  // Route away if game has moved past lobby
  if(phaseD&&phaseD!=='ended'){
    const iAmHost=hostD===myName;
    // Check if this player is part of the active game
    const myRoleInGame=iAmHost?true:await fb('GET',`/mafia2/roles/${encN(myName)}`);
    if(!myRoleInGame&&phaseD!=='assigning'){
      // Not in this game — show warning, offer reset
      document.getElementById('lb-host-bar').innerHTML=`
        <div style="background:rgba(255,80,0,0.12);border:1px solid rgba(255,80,0,0.35);
          border-radius:12px;padding:10px 14px;font-size:.78rem;text-align:center;width:100%;max-width:420px">
          ⚠️ A previous game is still active.<br>
          <button class="btn btn-secondary" style="font-size:.68rem;padding:6px 16px;margin-top:8px"
            onclick="resetStaleGame()">🔄 Reset & Open Lobby</button>
        </div>`;
      return;
    }
    stopIvs();
    if(phaseD==='assigning'){
      if(iAmHost){
        // Rebuild player list from lobby in case rolesMap was lost on reload
        const freshLobby=await fb('GET','/mafia2/lobby')||{};
        rolesMap={};
        Object.values(freshLobby)
          .filter(p=>p&&p.name&&p.ready&&p.name!==myName)
          .forEach(p=>rolesMap[p.name]='');
        show('s-assign');renderAssignScreen();
      } else {show('s-player');renderWaiting();startPlayerPolling();}
    } else {
      if(iAmHost){isHost=true;await reconnectHost(phaseD);}
      else{show('s-player');startPlayerPolling();}
    }
    return;
  }

  // Build online set
  const now=Date.now();
  const online=onlineD?Object.entries(onlineD)
    .filter(([,v])=>v&&(now-v.ts<75000))
    .map(([k])=>decN(k)):[];

  // Build lobby player list — exclude players not seen online within 75s
  lobbyPlayers=lobbyD||{};
  Object.values(lobbyPlayers).forEach(p=>{if(p&&p.name&&p.avatar)avatarsMap[p.name]=p.avatar;});
  const players=Object.values(lobbyPlayers)
    .filter(p=>p&&p.name&&online.includes(p.name))
    .sort((a,b)=>a.name.localeCompare(b.name));

  hostName=hostD||'';
  const readyCount=players.filter(p=>p.ready).length;

  // Render player rows
  const listEl=document.getElementById('lobby-list');
  listEl.innerHTML=players.length
    ?players.map(p=>{
      const isOnline=online.includes(p.name);
      const isPlayerHost=p.name===hostName;
      const isPlayerReady=!!p.ready;
      return`<div class="lp-row${isPlayerReady?' is-ready':''}">
        <span class="lp-av">${getAvatar(p.name)}</span>
        <span class="lp-name">${escHtml(p.name)}${isOnline?' 🟢':''}</span>
        <span class="lp-badges">
          ${isPlayerHost?'<span class="lp-badge lp-host-b">👑 Host</span>':''}
          ${isPlayerReady
            ?'<span class="lp-badge lp-ready-b">✅ Ready</span>'
            :'<span style="opacity:.3;font-size:.72rem">not ready</span>'}
        </span>
      </div>`;
    }).join('')
    :'<div style="opacity:.35;font-size:.8rem;text-align:center;padding:16px 0">Waiting for players…</div>';

  // Counter label
  document.getElementById('lb-count-lbl').textContent=
    `Lobby — ${players.length} player${players.length!==1?'s':''} · ${readyCount} ready`;

  // Host bar
  const hbar=document.getElementById('lb-host-bar');
  if(!hostName){
    hbar.innerHTML='';
  } else if(hostName===myName){
    isHost=true;
    hbar.innerHTML='<div class="host-badge">👑 You are Game Master</div><br><button class="btn btn-secondary" style="font-size:.62rem;padding:5px 16px;margin-top:6px;opacity:.55" onclick="stepDownHost()">↩ Step Down</button>';
  } else {
    hbar.innerHTML=`<div style="font-size:.75rem;opacity:.55;letter-spacing:1px">👑 ${hostName} is Game Master</div>`;
  }

  // Claim button: show only when no host exists
  document.getElementById('lb-claim-btn').style.display=(!hostName)?'':'none';

  // Ready button
  const rBtn=document.getElementById('lb-ready-btn');
  rBtn.textContent=amReady?'⬜ Cancel Ready':'✅ Ready Up';
  rBtn.className='btn w100'+(amReady?' btn-secondary':' btn-primary');

  // Proceed button: host only, when ALL lobby players are ready (minimum MIN_READY)
  const canProceed=isHost&&players.length>=MIN_READY&&readyCount===players.length;
  const proceedBtn=document.getElementById('lb-proceed-btn');
  proceedBtn.style.display=canProceed?'':'none';
  if(canProceed) proceedBtn.textContent=`▶ Assign Roles (${readyCount} ready)`;
}

async function claimHost(){
  const current=await fb('GET','/mafia2/host');
  if(current){toast(`${current} is already the host`);return;}
  await fb('PUT','/mafia2/host',myName);
  isHost=true;hostName=myName;
  lobbyTick();
}

async function stepDownHost(){
  await fb('DELETE','/mafia2/host');
  isHost=false;hostName='';
  stopIvs();
  enterRoleSelect();
}

async function toggleReady(){
  amReady=!amReady;
  await fb('PUT',`/mafia2/lobby/${encN(myName)}`,{name:myName,ts:Date.now(),ready:amReady});
  if(lobbyPlayers[encN(myName)]) lobbyPlayers[encN(myName)].ready=amReady;
  const rBtn=document.getElementById('lb-ready-btn');
  rBtn.textContent=amReady?'⬜ Cancel Ready':'✅ Ready Up';
  rBtn.className='btn w100'+(amReady?' btn-secondary':' btn-primary');
  snd('click');
}

async function proceedToAssign(){
  // Fetch fresh lobby state so no last-second ready is missed
  const freshLobby=await fb('GET','/mafia2/lobby')||{};
  const _now=Date.now();
  rolesMap={};
  Object.values(freshLobby)
    .filter(p=>p&&p.name&&p.ready&&p.name!==hostName&&_now-p.ts<75000)
    .forEach(p=>rolesMap[p.name]='');
  await fb('PUT','/mafia2/phase','assigning');
  stopIvs();
  show('s-assign');
  renderAssignScreen();
}

/* ════════════════════════════════
   ROLE ASSIGNMENT
════════════════════════════════ */
function renderAssignScreen(){
  const players=Object.keys(rolesMap).sort();
  if(!players.length){
    document.getElementById('assign-list').innerHTML=
      '<div style="opacity:.4;text-align:center;padding:20px">No ready players found.</div>';
    return;
  }
  document.getElementById('assign-list').innerHTML=players.map(name=>{
    const cur=rolesMap[name]||'';
    return`<div class="ar-row">
      <div class="ar-info">
        <span class="ar-av">${getAvatar(name)}</span>
        <span class="ar-name">${name}</span>
        ${cur
          ?`<span class="ar-cur ${cur}">${cur}</span>`
          :'<span style="opacity:.3;font-size:.7rem">unassigned</span>'}
      </div>
      <div class="ar-roles">
        <div class="rb${cur==='murderer'?' on-murderer':''}"     data-name="${escHtml(name)}" data-role="murderer"     onclick="assignRole(this.dataset.name,this.dataset.role)">🔪</div>
        <div class="rb${cur==='doctor'?' on-doctor':''}"         data-name="${escHtml(name)}" data-role="doctor"       onclick="assignRole(this.dataset.name,this.dataset.role)">💊</div>
        <div class="rb${cur==='investigator'?' on-investigator':''}" data-name="${escHtml(name)}" data-role="investigator" onclick="assignRole(this.dataset.name,this.dataset.role)">🔍</div>
        <div class="rb${cur==='civilian'?' on-civilian':''}"     data-name="${escHtml(name)}" data-role="civilian"     onclick="assignRole(this.dataset.name,this.dataset.role)">👤</div>
      </div>
    </div>`;
  }).join('');
  checkAssignDone(players);
}

function assignRole(name,role){
  // Unique constraint for special roles
  if(role==='murderer'||role==='doctor'||role==='investigator'){
    Object.keys(rolesMap).forEach(n=>{
      if(n!==name&&rolesMap[n]===role) rolesMap[n]='civilian';
    });
  }
  rolesMap[name]=role;
  renderAssignScreen();
  snd('click');
}

function checkAssignDone(players){
  const allSet=players.every(n=>rolesMap[n]);
  const has=r=>Object.values(rolesMap).includes(r);
  const complete=allSet&&has('murderer')&&has('doctor')&&has('investigator');
  document.getElementById('assign-start-btn').style.display=complete?'':'none';
  document.getElementById('assign-hint').textContent=complete
    ?'All roles assigned — ready to start!'
    :`Tap a role icon for each of ${players.length} players`;
}

/* ════════════════════════════════
   HOST RECONNECT
════════════════════════════════ */
async function reloadHostState(){
  const [rolesD,aliveD,roundD,avsD]=await Promise.all([
    fb('GET','/mafia2/roles'),fb('GET','/mafia2/alive'),fb('GET','/mafia2/round'),fb('GET','/mafia2/avatars'),
  ]);
  if(rolesD)Object.entries(rolesD).forEach(([k,v])=>{rolesMap[decN(k)]=v;});
  if(aliveD)Object.entries(aliveD).forEach(([k,v])=>{aliveMap[decN(k)]=v;});
  if(roundD)round=roundD;
  if(avsD)Object.entries(avsD).forEach(([k,v])=>{avatarsMap[decN(k)]=v;});
}

async function reconnectHost(phaseD){
  await reloadHostState();
  show('s-host');
  if(phaseD==='night'){
    enterHostNight();
  } else if(phaseD==='day'){
    hShow('h-day');
    document.getElementById('h-rd').textContent=round;
    renderAliveList();
    document.getElementById('h-vote-sec').style.display='none';
    document.getElementById('h-open-vote-btn').style.display='';
  } else if(phaseD==='vote'){
    hShow('h-day');
    document.getElementById('h-rd').textContent=round;
    renderAliveList();
    document.getElementById('h-vote-sec').style.display='';
    document.getElementById('h-open-vote-btn').style.display='none';
    stopIvs();ivs.push(setInterval(pollVotes,1000));
  }
}

/* ════════════════════════════════
   HOST GAME CONSOLE
════════════════════════════════ */
async function hostStartGame(){
  const players=Object.keys(rolesMap);
  if(!players.length||!players.every(n=>rolesMap[n])) return;
  const roles={},alive={};
  players.forEach(n=>{roles[encN(n)]=rolesMap[n];alive[encN(n)]=true;aliveMap[n]=true;});
  // Write all game data first, then flip phase so clients never read new phase with stale roles
  await Promise.all([
    fb('PUT','/mafia2/roles',roles),fb('PUT','/mafia2/alive',alive),
    fb('PUT','/mafia2/round',1),    fb('DELETE','/mafia2/night'),
    fb('DELETE','/mafia2/day'),     fb('DELETE','/mafia2/winner'),
    fb('DELETE','/mafia2/announcement'),fb('DELETE','/mafia2/lastSave'),
    fb('PUT','/mafia2/avatars',Object.fromEntries(Object.keys(rolesMap).filter(n=>avatarsMap[n]).map(n=>[encN(n),avatarsMap[n]]))),
  ]);
  await fb('PUT','/mafia2/phase','night');
  round=1;stopIvs();show('s-host');enterHostNight();
}

function enterHostNight(){
  hShow('h-night');
  document.getElementById('h-rn').textContent=round;
  document.getElementById('h-ann').value='';
  document.getElementById('h-result').textContent='Waiting for actions…';
  document.getElementById('h-actions').innerHTML='';
  _lastAutoAnn='';
  stopIvs();ivs.push(setInterval(pollNightActions,1500));
}

async function pollNightActions(){
  const [killD,saveD,inspD,aliveD,suspectD]=await Promise.all([
    fb('GET','/mafia2/night/kill'),fb('GET','/mafia2/night/save'),
    fb('GET','/mafia2/night/inspect'),fb('GET','/mafia2/alive'),
    fb('GET','/mafia2/night/suspect'),
  ]);
  if(aliveD)Object.entries(aliveD).forEach(([k,v])=>aliveMap[decN(k)]=v);
  const murd=Object.keys(rolesMap).find(n=>rolesMap[n]==='murderer');
  const doct=Object.keys(rolesMap).find(n=>rolesMap[n]==='doctor');
  const inv =Object.keys(rolesMap).find(n=>rolesMap[n]==='investigator');
  let html='';
  if(murd&&aliveMap[murd]!==false)
    html+=`<div class="act-item ${killD?'submitted':'pending'}">🔪 <b>${escHtml(murd)}</b>: ${killD?`Kill → <b>${escHtml(killD)}</b>`:'Choosing…'}</div>`;
  if(doct&&aliveMap[doct]!==false)
    html+=`<div class="act-item ${saveD?'submitted':'pending'}">💊 <b>${escHtml(doct)}</b>: ${saveD?`Save → <b>${escHtml(saveD)}</b>`:'Choosing…'}</div>`;
  if(inv&&aliveMap[inv]!==false){
    let txt='Choosing…';
    if(inspD){const r=await fb('GET',`/mafia2/roles/${encN(inspD)}`);txt=`Inspect → <b>${escHtml(inspD)}</b> = ${r==='murderer'?'⚠️ MURDERER':'✅ Innocent'}`;}
    html+=`<div class="act-item ${inspD?'submitted':'pending'}">🔍 <b>${escHtml(inv)}</b>: ${txt}</div>`;
  }
  if(!html)html='<div style="opacity:.4;font-size:.83rem">No special roles alive — resolve now.</div>';

  // Civilian death predictions
  const aliveCivs=Object.keys(rolesMap).filter(n=>rolesMap[n]==='civilian'&&aliveMap[n]!==false);
  if(aliveCivs.length){
    html+='<div style="opacity:.4;font-size:.6rem;letter-spacing:2px;text-transform:uppercase;margin:10px 0 5px">Civilian predictions — who dies tonight?</div>';
    aliveCivs.forEach(name=>{
      const s=suspectD?suspectD[encN(name)]:null;
      html+=`<div class="act-item ${s?'submitted':'pending'}">🕵️ <b>${escHtml(name)}</b>: ${s?`predicts <b>${escHtml(s)}</b>`:'Thinking…'}</div>`;
    });
  }

  // Locked-in summary: one chip per alive player
  const alivePlayers=Object.keys(rolesMap).filter(n=>aliveMap[n]!==false);
  const lockedIn=name=>{
    const r=rolesMap[name];
    if(r==='murderer')    return !!killD;
    if(r==='doctor')      return !!saveD;
    if(r==='investigator')return !!inspD;
    return !!(suspectD&&suspectD[encN(name)]);
  };
  const doneCount=alivePlayers.filter(lockedIn).length;
  const chips=alivePlayers.map(n=>{
    const done=lockedIn(n);
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:.72rem;font-weight:700;margin:2px;
      background:${done?'rgba(0,180,80,0.15)':'rgba(255,255,255,0.05)'};
      border:1px solid ${done?'rgba(0,200,80,0.4)':'rgba(255,255,255,0.12)'};
      color:${done?'#4caf50':'rgba(255,255,255,0.45)'}">
      ${done?'✅':'⏳'} ${escHtml(n)}
    </span>`;
  }).join('');
  const summary=`<div style="width:100%;margin-bottom:10px">
    <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;opacity:.4;margin-bottom:5px">
      Locked in — ${doneCount} / ${alivePlayers.length}
    </div>
    <div style="display:flex;flex-wrap:wrap;">${chips}</div>
  </div>`;
  document.getElementById('h-actions').innerHTML=summary+html;
  if(killD){
    const killed=saveD===killD?null:killD;
    document.getElementById('h-result').innerHTML=killed
      ?`💀 <b>${escHtml(killed)}</b> will be killed (Doctor did not save).`
      :`🛡️ <b>${escHtml(killD)}</b> targeted but saved by Doctor.`;
    const annEl=document.getElementById('h-ann');
    const autoAnn=killed?`${killed} was found dead this morning.`:'It was a quiet night. No one was eliminated.';
    if(!annEl.value||annEl.value===_lastAutoAnn){annEl.value=autoAnn;_lastAutoAnn=autoAnn;}
  } else if(!murd||aliveMap[murd]===false){
    document.getElementById('h-result').textContent='Murderer is dead — resolve immediately.';
    if(!document.getElementById('h-ann').value)
      document.getElementById('h-ann').value='It was a quiet night. No one was eliminated.';
  }
}

async function resolveNight(){
  const [killD,saveD]=await Promise.all([fb('GET','/mafia2/night/kill'),fb('GET','/mafia2/night/save')]);
  const killed=killD&&saveD!==killD?killD:null;
  const ann=document.getElementById('h-ann').value.trim()||
    (killed?`${killed} was found dead.`:'No one was eliminated tonight.');
  if(killed){await fb('PATCH','/mafia2/alive',{[encN(killed)]:false});aliveMap[killed]=false;}
  await Promise.all([
    fb('PUT','/mafia2/announcement',ann),
    fb('PUT',`/mafia2/history/r${round}`,{killed:killed||null,saved:saveD||null}),
    saveD?fb('PUT','/mafia2/lastSave',saveD):fb('DELETE','/mafia2/lastSave'),
    fb('PUT','/mafia2/phase','day'),
  ]);
  const w=checkWin();if(w){await endGame(w);return;}
  stopIvs();hShow('h-day');
  document.getElementById('h-rd').textContent=round;
  renderAliveList();
  document.getElementById('h-vote-sec').style.display='none';
  document.getElementById('h-open-vote-btn').style.display='';
}

function renderAliveList(){
  const players=Object.keys(rolesMap).sort((a,b)=>{
    const aAlive=aliveMap[a]!==false, bAlive=aliveMap[b]!==false;
    if(aAlive!==bAlive) return aAlive?-1:1;
    return a.localeCompare(b);
  });
  document.getElementById('h-alive').innerHTML=players.map(n=>{
    const a=aliveMap[n]!==false;
    return`<div class="alive-chip${a?'':' dead-chip'}" style="border-color:${CMAP[n]}55;background:${CMAP[n]}18;${a?'':'opacity:.45'}">${getAvatar(n)} ${n}${a?'':' 💀'}</div>`;
  }).join('');
}

async function hostOpenVote(){
  await Promise.all([fb('DELETE','/mafia2/day/votes'),fb('PUT','/mafia2/phase','vote')]);
  document.getElementById('h-vote-sec').style.display='';
  document.getElementById('h-open-vote-btn').style.display='none';
  stopIvs();ivs.push(setInterval(pollVotes,1000));
}

async function pollVotes(){
  const votes=await fb('GET','/mafia2/day/votes');
  const alivePlayers=Object.keys(rolesMap).filter(n=>aliveMap[n]!==false);

  // Locked-in chips
  const doneCount=alivePlayers.filter(n=>votes&&votes[encN(n)]).length;
  const chips=alivePlayers.map(n=>{
    const done=!!(votes&&votes[encN(n)]);
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:.72rem;font-weight:700;margin:2px;
      background:${done?'rgba(0,180,80,0.15)':'rgba(255,255,255,0.05)'};
      border:1px solid ${done?'rgba(0,200,80,0.4)':'rgba(255,255,255,0.12)'};
      color:${done?'#4caf50':'rgba(255,255,255,0.45)'}">
      ${done?'✅':'⏳'} ${escHtml(n)}
    </span>`;
  }).join('');
  document.getElementById('h-vote-locked').innerHTML=`
    <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;opacity:.4;margin-bottom:5px">
      Voted — ${doneCount} / ${alivePlayers.length}
    </div>
    <div style="display:flex;flex-wrap:wrap;margin-bottom:4px">${chips}</div>`;

  // Tally
  if(!votes){document.getElementById('h-tally').innerHTML='<div style="opacity:.4;font-size:.83rem">No votes yet…</div>';return;}
  const tally={};let deferCount=0;
  Object.values(votes).filter(Boolean).forEach(t=>{
    if(t==='defer'){deferCount++;} else {tally[t]=(tally[t]||0)+1;}
  });
  const tallyHtml=Object.entries(tally).sort(([,a],[,b])=>b-a)
    .map(([n,c])=>`<div class="vt-row"><span>${getAvatar(n)} ${n}</span><span class="vt-count">${c} vote${c!==1?'s':''}</span></div>`).join('');
  const deferHtml=deferCount?`<div class="vt-row" style="opacity:.5"><span>⏭️ Deferred</span><span class="vt-count">${deferCount}</span></div>`:'';
  document.getElementById('h-tally').innerHTML=tallyHtml+deferHtml||'<div style="opacity:.4;font-size:.83rem">No votes yet…</div>';
}

async function hostResolveVote(){
  const votes=await fb('GET','/mafia2/day/votes')||{};
  const tally={};
  Object.values(votes).filter(t=>t&&t!=='defer').forEach(t=>tally[t]=(tally[t]||0)+1);
  let elim=null;
  if(Object.keys(tally).length){
    const max=Math.max(...Object.values(tally));
    const top=Object.entries(tally).filter(([,v])=>v===max).map(([k])=>k);
    if(top.length===1)elim=top[0];
  }
  if(elim){
    await fb('PATCH','/mafia2/alive',{[encN(elim)]:false});aliveMap[elim]=false;
    const er=rolesMap[elim];
    toast(`${elim} eliminated — ${er}`);
    await Promise.all([
      fb('PUT','/mafia2/announcement',`${elim} was eliminated. They were ${er==='murderer'?'THE MURDERER! 🔪':`a ${er}.`}`),
      fb('PUT',`/mafia2/history/r${round}/eliminated`,elim),
      fb('PUT',`/mafia2/eliminatedByVote/${encN(elim)}`,true),
    ]);
  } else {
    await fb('PUT','/mafia2/announcement','Tied vote — no one eliminated.');
    toast('Tied — no elimination');
  }
  stopIvs();
  const w=checkWin();if(w){await endGame(w);return;}
  round++;
  await Promise.all([fb('PUT','/mafia2/round',round),fb('DELETE','/mafia2/night'),fb('DELETE','/mafia2/day'),fb('PUT','/mafia2/phase','night')]);
  enterHostNight();
}

function checkWin(){
  const living=Object.keys(rolesMap).filter(n=>aliveMap[n]!==false);
  const murdAlive=living.some(n=>rolesMap[n]==='murderer');
  const civCount=living.filter(n=>rolesMap[n]!=='murderer').length;
  if(!murdAlive)return 'civilians';
  if(murdAlive&&civCount<=1)return 'murderer';
  return null;
}

async function buildRecapHtml(allRoles,showRoles){
  const history=await fb('GET','/mafia2/history')||{};
  const rounds=Object.keys(history).filter(k=>/^r\d+$/.test(k)).sort((a,b)=>+a.slice(1)- +b.slice(1));
  let html='';
  if(rounds.length){
    html+='<div class="recap-hdr">📋 Round History</div>';
    html+=rounds.map(k=>{
      const h=history[k]||{};const n=k.slice(1);
      let row=`<div class="recap-row"><span class="recap-rn">Rd ${n}</span>`;
      row+=h.killed?`<span class="recap-kill">💀 ${h.killed}</span>`:`<span class="recap-safe">🛡️ No kill</span>`;
      if(h.eliminated)row+=`<span class="recap-elim">🗳️ ${h.eliminated}</span>`;
      return row+'</div>';
    }).join('');
  }
  if(showRoles&&allRoles&&Object.keys(allRoles).length){
    const icons={murderer:'🔪',doctor:'💊',investigator:'🔍',civilian:'👤'};
    html+='<div class="recap-hdr" style="margin-top:10px">🎭 All Roles</div>';
    html+=Object.entries(allRoles).map(([k,v])=>`
      <div class="recap-role-row">
        <span>${icons[v]||'👤'} ${decN(k)}</span>
        <span class="recap-badge ${v}">${v}</span>
      </div>`).join('');
  }
  return html?`<div class="recap-wrap">${html}</div>`:'';
}

async function endGame(winner){
  if(isEnded)return; isEnded=true;
  const allRoles=Object.fromEntries(Object.keys(rolesMap).map(n=>[encN(n),rolesMap[n]]));
  await Promise.all([fb('PUT','/mafia2/winner',winner),fb('PUT','/mafia2/allRoles',allRoles),fb('PUT','/mafia2/phase','ended')]);
  stopIvs();hShow('h-end');
  document.getElementById('h-ei').textContent=winner==='murderer'?'🔪':'🛡️';
  document.getElementById('h-et').textContent=winner==='murderer'?'MURDERER WINS!':'CIVILIANS WIN!';
  document.getElementById('h-es').textContent=winner==='murderer'?'The murderer was never caught.':'Justice prevails!';
  document.getElementById('h-er').innerHTML=Object.entries(rolesMap).map(([n,r])=>`
    <div class="role-item ${r}">
      <span class="ri-av">${getAvatar(n)}</span>
      <span class="ri-name">${n}</span>
      <span class="ri-role">${r}${aliveMap[n]===false?' · dead':' · survived'}</span>
    </div>`).join('');
  const recapEl=document.getElementById('h-recap');
  if(recapEl)recapEl.innerHTML=await buildRecapHtml(allRoles,false);
  const winners=winner==='civilians'
    ?Object.keys(rolesMap).filter(n=>rolesMap[n]!=='murderer')
    :Object.keys(rolesMap).filter(n=>rolesMap[n]==='murderer');
  await Promise.all(winners.map(n=>recordWin(n)));
  toast(`${winners.length} win${winners.length!==1?'s':''} recorded on leaderboard!`);
}

async function endGameEarly(){
  if(!confirm('End the game and send all players back to lobby?')) return;
  await fb('PUT','/mafia2/phase','reset');
  setTimeout(()=>fb('DELETE','/mafia2'),3000);
  isHost=false;hostName='';rolesMap={};aliveMap={};round=1;
  knownPhase='';isEnded=false;myRole=null;myAction=null;myVote=null;
  mySuspect=null;amReady=false;lobbyPlayers={};myEliminated=false;
  enterLobby();
}

async function hostReset(){
  await fb('DELETE','/mafia2');
  rolesMap={};aliveMap={};round=1;knownPhase='';hostName='';isHost=false;isEnded=false;
  myRole=null;myAction=null;myVote=null;mySuspect=null;amReady=false;lobbyPlayers={};
  enterLobby();
}

async function resetStaleGame(){
  if(!isHost){const h=await fb('GET','/mafia2/host');if(h&&h!==myName){toast('Only the host can reset the game.');return;}}
  await fb('DELETE','/mafia2');
  rolesMap={};aliveMap={};round=1;knownPhase='';hostName='';isHost=false;isEnded=false;
  myRole=null;myAction=null;myVote=null;amReady=false;lobbyPlayers={};
  toast('Game data cleared — lobby is open');
  enterLobby();
}

function renderNotInGame(){
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card">
      <div class="phase-icon">🚫</div>
      <div class="phase-title">Not In This Game</div>
      <div class="phase-desc">You weren't selected for this round.<br>Wait for the next game.</div>
    </div>
    <button class="btn btn-secondary" onclick="enterLobby()"
      style="margin-top:14px;width:100%;max-width:400px">← Back to Lobby</button>`;
}

/* ════════════════════════════════
   PLAYER
════════════════════════════════ */
function startPlayerPolling(){
  stopIvs();
  const badge=document.getElementById('p-name-badge');
  if(badge&&myName) badge.innerHTML=`<span>${myAvatar||getAvatar(myName)}</span><span>${escHtml(myName)}</span>`;
  ivs.push(setInterval(pollPhase,1500));
}

function renderWaiting(){
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card">
      <div class="phase-icon">🎭</div>
      <div class="phase-title">Stand By</div>
      <div class="phase-desc">Host is assigning roles…<br>Hang tight, <strong>${myName}</strong>.</div>
    </div>`;
}

async function pollPhase(){
  const [phD,roundD,annD,winner,aliveD,avsD]=await Promise.all([
    fb('GET','/mafia2/phase'),fb('GET','/mafia2/round'),fb('GET','/mafia2/announcement'),
    fb('GET','/mafia2/winner'),fb('GET','/mafia2/alive'),fb('GET','/mafia2/avatars'),
  ]);
  if(aliveD)Object.entries(aliveD).forEach(([k,v])=>aliveMap[decN(k)]=v);
  if(avsD)Object.entries(avsD).forEach(([k,v])=>{avatarsMap[decN(k)]=v;});
  if(roundD)round=roundD;
  if(!phD||phD===knownPhase) return;
  const prevPhase=knownPhase;
  knownPhase=phD;
  if(phD==='reset'){
    stopIvs();
    toast('Host ended the game — returning to lobby…',3000);
    myRole=null;myAction=null;myVote=null;mySuspect=null;myEliminated=false;knownPhase='';
    setTimeout(enterLobby,1500);
    return;
  }
  if(phD==='assigning'){
    renderWaiting();
  } else if(phD==='night'){
    myAction=null;mySuspect=null;
    if(aliveMap[myName]===false&&!myEliminated){
      const wasVoted=await fb('GET',`/mafia2/eliminatedByVote/${encN(myName)}`);
      if(wasVoted) myEliminated=true;
    }
    myRole=null;
    const fetched=await fb('GET',`/mafia2/roles/${encN(myName)}`);
    if(!fetched){stopIvs();renderNotInGame();return;}
    myRole=fetched;
    // Restore any already-submitted night action (reconnect safety)
    if(myRole==='civilian'){
      const prev=await fb('GET',`/mafia2/night/suspect/${encN(myName)}`);
      if(prev)mySuspect=prev;
    } else {
      const p={murderer:'/mafia2/night/kill',doctor:'/mafia2/night/save',investigator:'/mafia2/night/inspect'};
      const prev=await fb('GET',p[myRole]);
      if(prev)myAction=prev;
    }
    // Doctor: fetch who was saved last round (can't repeat)
    if(myRole==='doctor'){
      const ls=await fb('GET','/mafia2/lastSave');
      lastSave=ls||'';
    }
    // Show role reveal only on a fresh round-1 first connect; skip it on reconnects
    if(!myAction&&!mySuspect&&round===1) showRoleReveal();
    else showNightUI();
  } else if(phD==='day'){
    if(aliveMap[myName]===false){
      document.getElementById('p-content').innerHTML=`
        <div class="phase-card day">
          <div class="phase-icon">👻</div>
          <div class="phase-title">${myEliminated?'You Were Eliminated':'You Are Dead'}</div>
          <div class="phase-desc">Watch as the town discusses.</div>
        </div>`;
    } else showDayAnn(annD||'');
  } else if(phD==='vote'){
    // Restore existing vote on reconnect so player doesn't see the grid again
    const prev=await fb('GET',`/mafia2/day/votes/${encN(myName)}`);
    myVote=prev||null;
    showVoteUI();
  }
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
  let s=5;const cd=document.getElementById('rr-cd');
  const t=setInterval(()=>{cd.textContent=`Starting in ${--s}…`;if(s<=0){clearInterval(t);showNightUI();}},1000);
}

async function showNightUI(){
  const amAlive=aliveMap[myName]!==false;
  if(!amAlive){
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card night">
        <div class="phase-icon">👻</div>
        <div class="phase-title">${myEliminated?'You Were Eliminated':'You Are Dead'}</div>
        <div class="phase-desc">${myEliminated?'The town has spoken.':'The night carries on without you…'}</div>
      </div>`;
    return;
  }
  // Generic identical screen for all roles — no role name/icon visible during
  // action selection so bystanders can't tell who has a special role.
  if(myRole==='civilian'){
    if(mySuspect){
      document.getElementById('p-content').innerHTML=`
        <div class="phase-card night">
          <div class="phase-icon">🌙</div>
          <div class="phase-title">Prediction Locked</div>
          <div class="phase-desc">Waiting for morning…</div>
          <button class="btn btn-secondary" onclick="changeSuspect()"
            style="font-size:.72rem;padding:8px 18px;margin-top:14px">↩ Change</button>
        </div>`;
      return;
    }
    const alive=Object.keys(aliveMap).filter(n=>aliveMap[n]!==false);
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card night" style="padding:20px 16px;margin-bottom:12px">
        <div class="rr-icon">🌙</div>
        <div class="phase-title" style="font-size:1rem">Night Action</div>
        <div class="phase-desc">Who do you think will die tonight?</div>
      </div>
      <div class="action-grid">${alive.filter(n=>n!==myName).map(n=>`
        <div class="ag-card" data-n="${escHtml(n)}" onclick="submitSuspect(this.dataset.n)">
          <div class="ag-av">${getAvatar(n)}</div>
          <div class="ag-name">${escHtml(n)}</div>
        </div>`).join('')}</div>`;
    return;
  }
  if(myAction){
    if(myRole==='investigator'){
      const r=await fb('GET',`/mafia2/roles/${encN(myAction)}`);
      const suspicious=r==='murderer'||r==='doctor';
      document.getElementById('p-content').innerHTML=`
        <div class="phase-card night">
          <div class="phase-icon">${suspicious?'⚠️':'✅'}</div>
          <div class="phase-title">${suspicious?'Suspicious':'Not Suspicious'}</div>
          <div class="phase-desc">
            <strong style="color:#FFD200">${escHtml(myAction)}</strong>
            seems ${suspicious?'<strong style="color:#ff6b6b">suspicious.</strong>':'clear.'}<br>
            <span style="opacity:.55">Keep this to yourself — or not.</span>
          </div>
        </div>`;
      return;
    }
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card night">
        <div class="phase-icon">🌙</div>
        <div class="phase-title">Choice Made</div>
        <div class="phase-desc">Waiting for morning…</div>
      </div>`;
    return;
  }
  const alive=Object.keys(aliveMap).filter(n=>aliveMap[n]!==false);
  const targets=myRole==='doctor'?alive:alive.filter(n=>n!==myName);
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card night" style="padding:20px 16px;margin-bottom:12px">
      <div class="rr-icon">🌙</div>
      <div class="phase-title" style="font-size:1rem">Night Action</div>
      <div class="phase-desc">Tap a player</div>
    </div>
    <div class="action-grid">${targets.map(n=>{
      const blocked=myRole==='doctor'&&n===lastSave;
      return blocked
        ?`<div class="ag-card" style="opacity:.3;pointer-events:none">
            <div class="ag-av">${getAvatar(n)}</div>
            <div class="ag-name">${n}</div>
            <div style="font-size:.58rem;color:#ff6b6b;margin-top:3px">saved last round</div>
          </div>`
        :`<div class="ag-card" data-n="${escHtml(n)}" onclick="submitAction(this.dataset.n)">
            <div class="ag-av">${getAvatar(n)}</div>
            <div class="ag-name">${escHtml(n)}</div>
          </div>`;
    }).join('')}</div>`;
}

async function submitAction(target){
  myAction=target;
  const paths={murderer:'/mafia2/night/kill',doctor:'/mafia2/night/save',investigator:'/mafia2/night/inspect'};
  await fb('PUT',paths[myRole],target);
  showNightUI();snd('click');
}

async function submitSuspect(target){
  mySuspect=target;
  await fb('PUT',`/mafia2/night/suspect/${encN(myName)}`,target);
  showNightUI();snd('click');
}

function changeSuspect(){
  mySuspect=null;
  showNightUI();
}

function showDayAnn(ann){
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card day">
      <div class="phase-icon">☀️</div>
      <div class="phase-title">Morning</div>
    </div>
    <div class="ann-card">${escHtml(ann||'The town awakens…')}</div>
    <div style="opacity:.45;font-size:.8rem;text-align:center;letter-spacing:1px;padding:0 8px">
      Discuss with the group.<br>The host will open voting soon.</div>`;
}

function showVoteUI(){
  const alive=Object.keys(aliveMap).filter(n=>aliveMap[n]!==false);
  const amAlive=aliveMap[myName]!==false;
  if(!amAlive){
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card">
        <div class="phase-icon">👻</div>
        <div class="phase-title">${myEliminated?'You Were Eliminated':'You Are Dead'}</div>
        <div class="phase-desc">Watch as the living vote.</div>
      </div>`;
    return;
  }
  if(myVote){
    const deferred=myVote==='defer';
    document.getElementById('p-content').innerHTML=`
      <div class="phase-card day">
        <div class="phase-icon">${deferred?'⏭️':'🗳️'}</div>
        <div class="phase-title">${deferred?'Deferred':'Vote Cast'}</div>
        <div class="phase-desc">${deferred
          ?'You chose not to vote this round.'
          :`You voted for <strong style="color:#FFD200">${myVote}</strong>.`}<br>
          Waiting for the host to resolve…</div>
        <button class="btn btn-secondary" onclick="changeVote()"
          style="font-size:.72rem;padding:8px 18px;margin-top:14px">↩ Change Vote</button>
      </div>`;
    return;
  }
  const candidates=alive.filter(n=>n!==myName);
  document.getElementById('p-content').innerHTML=`
    <div class="phase-card day" style="padding:20px 16px;margin-bottom:12px">
      <div class="phase-icon">🗳️</div>
      <div class="phase-title" style="font-size:1.1rem">Vote to Eliminate</div>
      <div class="phase-desc">Who is the murderer?</div>
    </div>
    <div class="action-grid">${candidates.map(n=>`
      <div class="ag-card" data-n="${escHtml(n)}" onclick="submitVote(this.dataset.n)">
        <div class="ag-av">${getAvatar(n)}</div>
        <div class="ag-name">${escHtml(n)}</div>
      </div>`).join('')}</div>
    <button class="btn btn-secondary w100" onclick="submitVote('defer')"
      style="margin-top:8px;max-width:400px">⏭️ Defer — I pass this round</button>`;
}

async function submitVote(target){
  myVote=target;
  await fb('PUT',`/mafia2/day/votes/${encN(myName)}`,target);
  showVoteUI();snd('click');
}

function changeVote(){
  myVote=null;
  showVoteUI();
}

async function showPlayerEnd(winner){
  const badge=document.getElementById('p-name-badge');
  if(badge&&myName&&!badge.textContent) badge.innerHTML=`<span>${myAvatar||getAvatar(myName)}</span><span>${escHtml(myName)}</span>`;
  const allRoles=await fb('GET','/mafia2/allRoles')||{};
  if(!myRole){const e=Object.entries(allRoles).find(([k])=>decN(k)===myName);if(e)myRole=e[1];}
  const myWin=(winner==='murderer'&&myRole==='murderer')||(winner==='civilians'&&myRole!=='murderer');
  const recap=await buildRecapHtml(allRoles,true);
  document.getElementById('p-content').innerHTML=`
    <div class="end-icon">${winner==='murderer'?'🔪':'🛡️'}</div>
    <div class="end-title">${winner==='murderer'?'MURDERER WINS!':'CIVILIANS WIN!'}</div>
    <div class="end-sub">${myWin?'You won! 🎉':'Better luck next time…'}</div>
    ${recap}
    <button class="btn btn-secondary" onclick="location.href='index.html'" style="margin-top:14px">↩ Back to Arena</button>`;
}

/* ─── Sound ─── */
let _actx;
function _ac(){if(!_actx)_actx=new(window.AudioContext||window.webkitAudioContext)();return _actx;}
function snd(type){
  try{const ac=_ac();if(type==='click'){const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=440;g.gain.setValueAtTime(0.12,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.08);o.start();o.stop(ac.currentTime+0.08);}}catch{}
}

/* ─── Init ─── */
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopIvs();return;}
  if(!myName) return;
  if(document.getElementById('s-lobby')?.classList.contains('active')) startLobbyPolling();
  else if(document.getElementById('s-player')?.classList.contains('active')) startPlayerPolling();
  else if(isHost&&document.getElementById('s-host')?.classList.contains('active')){
    fb('GET','/mafia2/phase').then(phD=>{
      if(phD==='night'){stopIvs();ivs.push(setInterval(pollNightActions,1500));}
      else if(phD==='vote'){stopIvs();ivs.push(setInterval(pollVotes,1000));}
    });
  }
});

window.addEventListener('beforeunload', () => {
  if (myName) {
    fetch(`${DB}/online/${encodeURIComponent(myName)}.json`, { method: 'DELETE', keepalive: true });
    fetch(`${DB}/mafia2/lobby/${encN(myName)}.json`, { method: 'DELETE', keepalive: true });
  }
});

init();
