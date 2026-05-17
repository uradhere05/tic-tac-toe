'use strict';
/* ─── Constants ─── */
const DB='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
const AVATARS=['🕵️','🤵','👩‍⚕️','👨‍💼','👩‍💼','🧑‍🌾','👩‍🍳','🧑‍🔧','👮','👨‍🍳'];
const AMAP=Object.fromEntries(NAMES.map((n,i)=>[n,AVATARS[i]]));
const RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS=['♠','♥','♦','♣'];
const RED_SUITS=new Set([1,2]); // ♥=1, ♦=2
const STARTING_CHIPS=2000; // $20.00 in cents
const SB=10, BB=20;        // small blind=10¢, big blind=20¢
const MIN_PLAYERS=2;
const STALE_MS=75000;

/* ─── State ─── */
let myName='',myAvatar='',isHost=false,hostName='';
let phase='',round=0;
let chipsMap={},foldedMap={},allInMap={},betStreetMap={};
let pot=0,currentBet=0,betLastRaise=BB;
let betQueue=[],betOn='',handStartTs=0;
let holeCards=[],communityCards=[],communityFull=[];
let playersInHand=[],dealerPos=0;
let avatarsMap={},lobbyPlayers={};
let amReady=false,ivs=[],_lobbyRunning=false,_pollRunning=false;
let _dealerDeck=[];

/* ─── Firebase ─── */
const encN=n=>n.replace(/ /g,'_');
const decN=k=>k.replace(/_/g,' ');

async function fb(method,path,data){
  const opts={method};
  if(data!==undefined){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
  try{const r=await fetch(`${DB}${path}.json`,opts);return await r.json();}catch{return null;}
}

function getWeekKey(){
  const now=new Date();
  const diff=now.getDay()===0?-6:1-now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()+diff);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}
async function recordWin(name){
  const url=`${DB}/leaderboard/${getWeekKey()}/${encodeURIComponent(name)}.json`;
  try{const cur=await fetch(url).then(r=>r.json()).catch(()=>0)||0;
    await fetch(url,{method:'PUT',body:JSON.stringify(cur+1)});}catch{}
}

/* ─── Card utilities ─── */
function createDeck(){
  const d=[];
  for(let s=0;s<4;s++) for(let r=0;r<13;r++) d.push({r,s});
  return d;
}
function shuffle(deck){
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}
function cardHTML(card,small=false){
  if(!card) return `<div class="card-back${small?' small':''}"></div>`;
  const red=RED_SUITS.has(card.s)?' red':'';
  const r=RANKS[card.r], s=SUITS[card.s];
  return `<div class="card${red}">
    <div class="card-top">${r}<br>${s}</div>
    <div class="card-mid">${s}</div>
    <div class="card-bot">${r}<br>${s}</div>
  </div>`;
}
function emptyCardHTML(){return '<div class="card-empty"></div>';}
function fmtChips(cents){return `$${(cents/100).toFixed(2)}`;}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* ─── UI helpers ─── */
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
let _tt;
function toast(m,d=2600){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>e.classList.remove('show'),d);}
function stopIvs(){ivs.forEach(clearInterval);ivs=[];}
function getAvatar(name){return avatarsMap[name]||AMAP[name]||'🃏';}

/* ─── Init ─── */
function init(){
  const params=new URLSearchParams(location.search);
  const simName=params.get('simName');
  if(simName){myName=simName;myAvatar=params.get('simAvatar')||'🃏';}
  else{
    const stored=localStorage.getItem('filoName');
    if(!stored){location.replace('index.html');return;}
    myName=stored;
    myAvatar=localStorage.getItem('filoAvatar')||'🃏';
  }
  document.getElementById('rs-name').textContent=myName;
  checkActiveGame();
}
async function checkActiveGame(){
  const [phaseD,hostD]=await Promise.all([fb('GET','/poker2/phase'),fb('GET','/poker2/host')]);
  if(!phaseD||phaseD==='reset'){enterRoleSelect();return;}
  isHost=hostD===myName;hostName=hostD||'';
  const iAmDealer=isHost;
  const chipsVal=await fb('GET',`/poker2/chips/${encN(myName)}`);
  const inGame=iAmDealer||(chipsVal!=null);
  if(!inGame){enterRoleSelect();return;}
  if(phaseD==='lobby'){enterLobby();return;}
  if(iAmDealer){await reloadDealerState();reconnectDealer(phaseD);}
  else{show('s-player');startPlayerPolling();}
}

function enterRoleSelect(){
  document.getElementById('rs-name').textContent=myName;
  show('s-role-select');
}

async function joinAsPlayer(){enterLobby();}

async function joinAsDealer(){
  const cur=await fb('GET','/poker2/host');
  if(cur&&cur!==myName){toast(`${cur} is already the Dealer`);return;}
  await fb('PUT','/poker2/host',myName);
  isHost=true;hostName=myName;
  enterLobby();
}
/* ─── Hand Evaluator ─── */
// score = (handRank<<20)|(r0<<16)|(r1<<12)|(r2<<8)|(r3<<4)|r4
// handRank: 0=High Card … 8=Straight Flush (higher=better)
function evalHand5(cards){
  const rs=cards.map(c=>c.r).sort((a,b)=>b-a);
  const ss=cards.map(c=>c.s);
  const isFlush=ss.every(s=>s===ss[0]);
  let isStraight=false,straightHigh=0;
  if(rs[0]-rs[4]===4&&new Set(rs).size===5){isStraight=true;straightHigh=rs[0];}
  // Wheel A-2-3-4-5
  if(rs[0]===12&&rs[1]===3&&rs[2]===2&&rs[3]===1&&rs[4]===0){isStraight=true;straightHigh=3;}

  const cnt={};
  rs.forEach(r=>cnt[r]=(cnt[r]||0)+1);
  const grp=Object.entries(cnt).map(([r,c])=>[+r,c]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const f=grp.map(([,c])=>c);
  const t=grp.map(([r])=>r);

  let type,key;
  if(isStraight&&isFlush){type=8;key=[straightHigh,0,0,0,0];}
  else if(f[0]===4)       {type=7;key=[t[0],t[1],0,0,0];}
  else if(f[0]===3&&f[1]===2){type=6;key=[t[0],t[1],0,0,0];}
  else if(isFlush)         {type=5;key=rs;}
  else if(isStraight)      {type=4;key=[straightHigh,0,0,0,0];}
  else if(f[0]===3)        {type=3;key=[t[0],t[1],t[2],0,0];}
  else if(f[0]===2&&f[1]===2){type=2;key=[t[0],t[1],t[2],0,0];}
  else if(f[0]===2)        {type=1;key=[t[0],t[1],t[2],t[3],0];}
  else                     {type=0;key=rs;}

  return(type<<20)|(key[0]<<16)|(key[1]<<12)|(key[2]<<8)|(key[3]<<4)|(key[4]||0);
}

function bestOf7(cards7){
  let best=-1;
  for(let i=0;i<7;i++) for(let j=i+1;j<7;j++){
    const five=cards7.filter((_,k)=>k!==i&&k!==j);
    const s=evalHand5(five);
    if(s>best)best=s;
  }
  return best;
}

const HAND_NAMES=['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];
function handName(score){return HAND_NAMES[score>>20]||'High Card';}

/* ─── Lobby ─── */
async function enterLobby(){
  amReady=false;
  show('s-lobby');
  await writeLobbyPresence();
  startLobbyPolling();
}

async function writeLobbyPresence(){
  await Promise.all([
    fb('PUT',`/poker2/lobby/${encN(myName)}`,{name:myName,ts:Date.now(),ready:amReady,avatar:myAvatar}),
    fb('PUT',`/online/${encodeURIComponent(myName)}`,{ts:Date.now()}),
    fb('PUT',`/rooms/room-7/lobby/${encN(myName)}`,{name:myName,ts:Date.now()}),
  ]);
}

function startLobbyPolling(){
  stopIvs();
  lobbyTick();
  ivs.push(setInterval(lobbyTick,2000));
  ivs.push(setInterval(writeLobbyPresence,20000));
}

async function lobbyTick(){
  if(!document.getElementById('s-lobby').classList.contains('active'))return;
  if(_lobbyRunning)return;_lobbyRunning=true;
  try{
    const[lobbyD,hostD,phaseD,chipsD]=await Promise.all([
      fb('GET','/poker2/lobby'),fb('GET','/poker2/host'),
      fb('GET','/poker2/phase'),fb('GET','/poker2/chips'),
    ]);
    if(!document.getElementById('s-lobby').classList.contains('active'))return;
    if(phaseD&&phaseD!=='lobby'&&phaseD!=='reset'){
      stopIvs();
      isHost=hostD===myName;hostName=hostD||'';
      if(isHost){await reloadDealerState();reconnectDealer(phaseD);}
      else{show('s-player');startPlayerPolling();}
      return;
    }
    if(chipsD)Object.entries(chipsD).forEach(([k,v])=>{chipsMap[decN(k)]=v;});
    hostName=hostD||'';
    lobbyPlayers=lobbyD||{};
    Object.values(lobbyPlayers).forEach(p=>{if(p?.name&&p.avatar)avatarsMap[p.name]=p.avatar;});
    renderLobbyUI();
  }finally{_lobbyRunning=false;}
}

function renderLobbyUI(){
  const now=Date.now();
  const players=Object.values(lobbyPlayers)
    .filter(p=>p?.name&&now-p.ts<STALE_MS)
    .sort((a,b)=>a.name.localeCompare(b.name));
  const readyCount=players.filter(p=>p.ready).length;
  document.getElementById('lb-count').textContent=
    `Lobby — ${players.length} player${players.length!==1?'s':''} · ${readyCount} ready`;
  document.getElementById('lb-players').innerHTML=players.length
    ?players.map(p=>`<div class="lp-row${p.ready?' is-ready':''}">
        <span class="lp-av">${getAvatar(p.name)}</span>
        <span class="lp-name">${escHtml(p.name)}${p.name===hostName?' 🃏':''}</span>
        <span class="lp-chips">${chipsMap[p.name]!=null?fmtChips(chipsMap[p.name]):''}</span>
        ${p.ready?'<span style="font-size:.75rem">✅</span>':''}
      </div>`).join('')
    :'<div style="opacity:.35;font-size:.8rem;text-align:center;padding:16px">Waiting for players…</div>';

  const hbar=document.getElementById('lb-host-bar');
  if(hostName===myName){isHost=true;hbar.innerHTML='<div class="host-badge">🃏 You are the Dealer</div>';}
  else if(hostName){hbar.innerHTML=`<div style="font-size:.75rem;opacity:.55">🃏 ${escHtml(hostName)} is Dealer</div>`;}
  else{hbar.innerHTML='';}

  document.getElementById('lb-claim-btn').style.display=hostName?'none':'';
  const rBtn=document.getElementById('lb-ready-btn');
  rBtn.textContent=amReady?'⬜ Cancel Ready':'✅ Ready Up';
  rBtn.className='btn w100'+(amReady?' btn-secondary':' btn-primary');

  const readyPlayers=players.filter(p=>p.name!==hostName&&p.ready);
  const canStart=isHost&&readyPlayers.length>=MIN_PLAYERS;
  const startBtn=document.getElementById('lb-start-btn');
  startBtn.style.display=canStart?'':'none';
  if(canStart)startBtn.textContent=`▶ Start Game (${readyPlayers.length} players)`;
}

async function toggleReady(){
  amReady=!amReady;
  await fb('PUT',`/poker2/lobby/${encN(myName)}`,{name:myName,ts:Date.now(),ready:amReady,avatar:myAvatar});
  renderLobbyUI();
}

async function claimDealer(){
  const cur=await fb('GET','/poker2/host');
  if(cur){toast(`${cur} is already the Dealer`);return;}
  await fb('PUT','/poker2/host',myName);
  isHost=true;hostName=myName;
  lobbyTick();
}

async function hostStartSession(){
  const freshLobby=await fb('GET','/poker2/lobby')||{};
  const now=Date.now();
  const readyPlayers=Object.values(freshLobby)
    .filter(p=>p?.name&&p.name!==hostName&&p.ready&&now-p.ts<STALE_MS)
    .map(p=>p.name);
  if(readyPlayers.length<MIN_PLAYERS){toast('Need at least 2 ready players');return;}

  const chipsInit={};
  readyPlayers.forEach(n=>{
    chipsInit[encN(n)]=STARTING_CHIPS;
    chipsMap[n]=STARTING_CHIPS;
    if(freshLobby[encN(n)]?.avatar)avatarsMap[n]=freshLobby[encN(n)].avatar;
  });
  await Promise.all([
    fb('PUT','/poker2/chips',chipsInit),
    fb('PUT','/poker2/phase','lobby'),
    fb('PUT','/poker2/round',0),
    fb('DELETE','/poker2/hands'),
    fb('DELETE','/poker2/community'),
    fb('DELETE','/poker2/communityFull'),
    fb('DELETE','/poker2/folded'),
    fb('DELETE','/poker2/allIn'),
    fb('DELETE','/poker2/bet'),
    fb('PUT','/poker2/pot',0),
    fb('PUT','/poker2/dealerPos',0),
    fb('PUT','/poker2/avatars',Object.fromEntries(readyPlayers.filter(n=>avatarsMap[n]).map(n=>[encN(n),avatarsMap[n]]))),
  ]);
  playersInHand=readyPlayers;
  dealerPos=-1;
  stopIvs();
  show('s-dealer');
  renderDealerConsole('lobby');
}

/* ─── Dealer: Game Control ─── */
async function reloadDealerState(){
  const[handsD,chipsD,foldedD,allInD,communityD,communityFullD,potD,betD,roundD,playersD,dealerPosD,avsD]=await Promise.all([
    fb('GET','/poker2/hands'),fb('GET','/poker2/chips'),
    fb('GET','/poker2/folded'),fb('GET','/poker2/allIn'),
    fb('GET','/poker2/community'),fb('GET','/poker2/communityFull'),
    fb('GET','/poker2/pot'),fb('GET','/poker2/bet'),
    fb('GET','/poker2/round'),fb('GET','/poker2/players'),
    fb('GET','/poker2/dealerPos'),fb('GET','/poker2/avatars'),
  ]);
  if(chipsD)Object.entries(chipsD).forEach(([k,v])=>{chipsMap[decN(k)]=v;});
  if(foldedD)Object.entries(foldedD).forEach(([k,v])=>{foldedMap[decN(k)]=v;});
  if(allInD)Object.entries(allInD).forEach(([k,v])=>{allInMap[decN(k)]=v;});
  if(communityD){
    communityCards=[];
    for(let i=0;i<5;i++) communityCards[i]=communityD[i]||null;
  }
  if(communityFullD){communityFull=communityFullD;}
  if(potD!=null)pot=potD;
  if(roundD!=null)round=roundD;
  if(playersD)playersInHand=playersD;
  if(dealerPosD!=null)dealerPos=dealerPosD;
  if(avsD)Object.entries(avsD).forEach(([k,v])=>{avatarsMap[decN(k)]=v;});
  if(betD){
    currentBet=betD.current||0;
    betLastRaise=betD.lastRaise||BB;
    betOn=betD.on||'';
    betQueue=betD.queue||[];
    if(betD.street)Object.entries(betD.street).forEach(([k,v])=>{betStreetMap[decN(k)]=v;});
  }
  phase=await fb('GET','/poker2/phase')||'';
}

function reconnectDealer(phaseD){
  show('s-dealer');
  renderDealerConsole(phaseD||phase);
  stopIvs();
  ivs.push(setInterval(pollBettingActions,1500));
}

async function hostStartHand(){
  const activePlayers=playersInHand.filter(n=>chipsMap[n]>0);
  if(activePlayers.length<2){toast('Need at least 2 players with chips');return;}

  round++;
  dealerPos=(dealerPos+1)%activePlayers.length;
  foldedMap={};allInMap={};betStreetMap={};pot=0;currentBet=BB;betLastRaise=BB;
  communityCards=[null,null,null,null,null];
  handStartTs=Date.now();

  const n=activePlayers.length;
  const sbIdx=(dealerPos+1)%n;
  const bbIdx=(dealerPos+2)%n;
  const sbName=n===2?activePlayers[dealerPos]:activePlayers[sbIdx];
  const bbName=n===2?activePlayers[sbIdx]:activePlayers[bbIdx];

  chipsMap[sbName]-=Math.min(SB,chipsMap[sbName]);
  chipsMap[bbName]-=Math.min(BB,chipsMap[bbName]);
  betStreetMap[sbName]=Math.min(SB,SB);
  betStreetMap[bbName]=Math.min(BB,BB);
  pot=betStreetMap[sbName]+betStreetMap[bbName];

  _dealerDeck=shuffle(createDeck());
  const handsObj={};
  const chipsObj={};
  activePlayers.forEach(p=>{
    handsObj[encN(p)]=[_dealerDeck.pop(),_dealerDeck.pop()];
    chipsObj[encN(p)]=chipsMap[p];
  });

  communityFull=[_dealerDeck.pop(),_dealerDeck.pop(),_dealerDeck.pop(),_dealerDeck.pop(),_dealerDeck.pop()];

  let utg;
  if(n===2){utg=activePlayers[(dealerPos+1)%n];}
  else{utg=activePlayers[(dealerPos+3)%n];}
  betQueue=buildQueue(activePlayers,activePlayers.indexOf(utg));
  betQueue=betQueue.filter(p=>p!==bbName);
  betQueue.push(bbName);
  betOn=betQueue[0]||'';

  await Promise.all([
    fb('PUT','/poker2/hands',handsObj),
    fb('PUT','/poker2/communityFull',communityFull),
    fb('PUT','/poker2/community',{0:null,1:null,2:null,3:null,4:null}),
    fb('PATCH','/poker2/chips',chipsObj),
    fb('PUT','/poker2/pot',pot),
    fb('PUT','/poker2/players',activePlayers),
    fb('PUT','/poker2/dealerPos',dealerPos),
    fb('PUT','/poker2/round',round),
    fb('PUT','/poker2/bet',{
      current:currentBet,lastRaise:betLastRaise,
      on:betOn,queue:betQueue,
      street:Object.fromEntries(Object.entries(betStreetMap).map(([k,v])=>[encN(k),v])),
    }),
    fb('DELETE','/poker2/folded'),
    fb('DELETE','/poker2/allIn'),
    fb('DELETE','/poker2/announcement'),
    fb('DELETE','/poker2/winner'),
    fb('DELETE','/poker2/showdown'),
  ]);
  await fb('PUT','/poker2/phase','preflop');
  phase='preflop';
  stopIvs();
  renderDealerConsole('preflop');
  ivs.push(setInterval(pollBettingActions,1500));
}

function buildQueue(players,startIdx){
  const q=[];
  for(let i=0;i<players.length;i++){
    const p=players[(startIdx+i)%players.length];
    if(!foldedMap[p]&&!allInMap[p])q.push(p);
  }
  return q;
}

function renderDealerConsole(ph){
  phase=ph||phase;
  document.getElementById('d-phase').textContent=(phase||'lobby').toUpperCase();
  document.getElementById('d-round').textContent=round;
  document.getElementById('d-pot').textContent=fmtChips(pot);

  const comm=document.getElementById('d-community');
  comm.innerHTML='';
  for(let i=0;i<5;i++){
    const card=communityCards[i];
    comm.innerHTML+=card?cardHTML(card):emptyCardHTML();
  }

  const prows=document.getElementById('d-players');
  prows.innerHTML='';
  const activePlayers=playersInHand.length?playersInHand:Object.keys(chipsMap);
  activePlayers.forEach(async name=>{
    const folded=foldedMap[name];
    const allin=allInMap[name];
    const isActing=betOn===name;
    const chips=chipsMap[name]??0;
    const bet=betStreetMap[name]||0;
    let statusCls='s-waiting',statusTxt='waiting';
    if(isActing){statusCls='s-acting';statusTxt='acting…';}
    else if(folded){statusCls='s-folded';statusTxt='folded';}
    else if(allin){statusCls='s-allin';statusTxt='all-in';}

    prows.innerHTML+=`<div class="pr-row${folded?' pr-folded':''}${isActing?' pr-acting':''}">
      <span class="pr-av">${getAvatar(name)}</span>
      <span class="pr-name">${escHtml(name)}${name===playersInHand[dealerPos]?' 🔘':''}</span>
      <span class="pr-chips">${fmtChips(chips)}</span>
      <span class="pr-bet">${bet?fmtChips(bet):''}</span>
      <span class="pr-status ${statusCls}">${statusTxt}</span>
      <span class="pr-cards" id="pr-cards-${encN(name)}"></span>
    </div>`;
  });

  if(phase!=='lobby'){
    fb('GET','/poker2/hands').then(handsD=>{
      if(!handsD)return;
      Object.entries(handsD).forEach(([k,cards])=>{
        const el=document.getElementById(`pr-cards-${k}`);
        if(el&&Array.isArray(cards)) el.innerHTML=cards.map(c=>cardHTML(c,true)).join('');
      });
    });
    fb('GET','/poker2/showdown').then(sd=>{
      if(!sd)return;
      Object.entries(sd).forEach(([k,cards])=>{
        const el=document.getElementById(`pr-cards-${k}`);
        if(el&&Array.isArray(cards))el.innerHTML=cards.map(c=>cardHTML(c,true)).join('')+
          '<br><span style="font-size:.55rem;opacity:.6">'+handName(bestOf7([...cards,...communityCards.filter(Boolean)]))+'</span>';
      });
    });
  }

  const ctrl=document.getElementById('d-controls');
  ctrl.innerHTML='';
  const btn=(label,fn,cls='btn-primary')=>`<button class="btn ${cls} btn-sm" onclick="${fn}">${label}</button>`;

  if(phase==='lobby'||phase==='showdown'){
    ctrl.innerHTML=btn('🃏 Deal New Hand','hostStartHand()','btn-gold');
  }
  if(phase==='preflop'&&!betOn){
    ctrl.innerHTML=btn('🃏 Deal Flop','hostDealFlop()','btn-primary');
  }
  if(phase==='flop'&&!betOn){
    ctrl.innerHTML=btn('🃏 Deal Turn','hostDealTurn()','btn-primary');
  }
  if(phase==='turn'&&!betOn){
    ctrl.innerHTML=btn('🃏 Deal River','hostDealRiver()','btn-primary');
  }
  if(phase==='river'&&!betOn){
    ctrl.innerHTML=btn('⚖️ Showdown','hostShowdown()','btn-gold');
  }
}

/* ─── Betting Engine ─── */
let _processingAction=false;

async function pollBettingActions(){
  if(!isHost||!betOn||_processingAction)return;
  const enc=encN(betOn);
  const actionD=await fb('GET',`/poker2/bet/action/${enc}`);
  if(!actionD||!actionD.ts||actionD.ts<handStartTs)return;
  _processingAction=true;
  try{await processAction(betOn,actionD);}
  finally{_processingAction=false;}
}

async function processAction(playerName,action){
  const{type,amount}=action;
  const enc=encN(playerName);
  await fb('DELETE',`/poker2/bet/action/${enc}`);

  if(type==='fold'){
    foldedMap[playerName]=true;
    await fb('PUT',`/poker2/folded/${enc}`,true);
    betQueue=betQueue.filter(n=>n!==playerName);
  } else if(type==='check'){
    betQueue=betQueue.filter(n=>n!==playerName);
  } else if(type==='call'){
    const owe=Math.max(0,currentBet-(betStreetMap[playerName]||0));
    const toCall=Math.min(owe,chipsMap[playerName]||0);
    chipsMap[playerName]=(chipsMap[playerName]||0)-toCall;
    betStreetMap[playerName]=(betStreetMap[playerName]||0)+toCall;
    pot+=toCall;
    if(chipsMap[playerName]<=0){allInMap[playerName]=true;await fb('PUT',`/poker2/allIn/${enc}`,true);}
    await fb('PATCH','/poker2/chips',{[enc]:chipsMap[playerName]});
    await fb('PUT','/poker2/pot',pot);
    await fb('PATCH','/poker2/bet/street',{[enc]:betStreetMap[playerName]});
    betQueue=betQueue.filter(n=>n!==playerName);
  } else if(type==='raise'){
    const raiseTotal=Math.max(amount,currentBet+BB);
    const owe=Math.max(0,raiseTotal-(betStreetMap[playerName]||0));
    const toAdd=Math.min(owe,chipsMap[playerName]||0);
    chipsMap[playerName]=(chipsMap[playerName]||0)-toAdd;
    betStreetMap[playerName]=(betStreetMap[playerName]||0)+toAdd;
    pot+=toAdd;
    betLastRaise=raiseTotal-currentBet;
    currentBet=raiseTotal;
    if(chipsMap[playerName]<=0){allInMap[playerName]=true;await fb('PUT',`/poker2/allIn/${enc}`,true);}
    await fb('PATCH','/poker2/chips',{[enc]:chipsMap[playerName]});
    await fb('PUT','/poker2/pot',pot);
    await fb('PUT','/poker2/bet/current',currentBet);
    await fb('PUT','/poker2/bet/lastRaise',betLastRaise);
    await fb('PATCH','/poker2/bet/street',{[enc]:betStreetMap[playerName]});
    const raiserIdx=playersInHand.indexOf(playerName);
    betQueue=[];
    for(let i=1;i<=playersInHand.length;i++){
      const p=playersInHand[(raiserIdx+i)%playersInHand.length];
      if(!foldedMap[p]&&!allInMap[p])betQueue.push(p);
    }
  }

  const alive=playersInHand.filter(n=>!foldedMap[n]);
  if(alive.length===1){
    await autoWin(alive[0]);
    return;
  }

  betOn=betQueue[0]||'';
  await fb('PUT','/poker2/bet/on',betOn||null);
  await fb('PUT','/poker2/bet/queue',betQueue);
  renderDealerConsole(phase);
}

async function autoWin(winner){
  chipsMap[winner]=(chipsMap[winner]||0)+pot;
  await Promise.all([
    fb('PATCH','/poker2/chips',{[encN(winner)]:chipsMap[winner]}),
    fb('PUT','/poker2/winner',winner),
    fb('PUT','/poker2/announcement',`${winner} wins $${(pot/100).toFixed(2)}! (everyone folded)`),
    fb('PUT','/poker2/pot',0),
    fb('PUT','/poker2/bet/on',null),
    fb('PUT','/poker2/bet/queue',[]),
  ]);
  pot=0;betOn='';betQueue=[];
  await recordWin(winner);
  phase='showdown';
  await fb('PUT','/poker2/phase','showdown');
  toast(`${winner} wins (everyone folded)!`);
  renderDealerConsole('showdown');
}

async function newBettingStreet(ph,startIdx){
  betStreetMap={};currentBet=0;betLastRaise=BB;
  betQueue=buildQueue(playersInHand,startIdx);
  betOn=betQueue[0]||'';
  await Promise.all([
    fb('PUT','/poker2/bet',{
      current:0,lastRaise:BB,on:betOn||null,queue:betQueue,street:{},
    }),
    fb('PUT','/poker2/phase',ph),
  ]);
}

/* ─── Dealer Phase Controls ─── */
async function hostDealFlop(){
  if(betOn){toast('Betting not complete');return;}
  communityCards[0]=communityFull[0];
  communityCards[1]=communityFull[1];
  communityCards[2]=communityFull[2];
  const leftOfDealer=(dealerPos+1)%playersInHand.length;
  const startIdx=playersInHand.findIndex((_,i)=>i===leftOfDealer&&!foldedMap[playersInHand[i]])||0;
  await fb('PUT','/poker2/community',{
    0:communityCards[0],1:communityCards[1],2:communityCards[2],3:null,4:null});
  await newBettingStreet('flop',startIdx);
  renderDealerConsole('flop');
  ivs.push(setInterval(pollBettingActions,1500));
}

async function hostDealTurn(){
  if(betOn){toast('Betting not complete');return;}
  communityCards[3]=communityFull[3];
  const leftOfDealer=(dealerPos+1)%playersInHand.length;
  const startIdx=playersInHand.findIndex((_,i)=>i===leftOfDealer&&!foldedMap[playersInHand[i]])||0;
  await fb('PUT','/poker2/community',{
    0:communityCards[0],1:communityCards[1],2:communityCards[2],3:communityCards[3],4:null});
  await newBettingStreet('turn',startIdx);
  renderDealerConsole('turn');
}

async function hostDealRiver(){
  if(betOn){toast('Betting not complete');return;}
  communityCards[4]=communityFull[4];
  const leftOfDealer=(dealerPos+1)%playersInHand.length;
  const startIdx=playersInHand.findIndex((_,i)=>i===leftOfDealer&&!foldedMap[playersInHand[i]])||0;
  await fb('PUT','/poker2/community',{
    0:communityCards[0],1:communityCards[1],2:communityCards[2],
    3:communityCards[3],4:communityCards[4]});
  await newBettingStreet('river',startIdx);
  renderDealerConsole('river');
}

async function hostShowdown(){
  if(betOn){toast('Betting not complete');return;}
  const alive=playersInHand.filter(n=>!foldedMap[n]);
  const board=communityCards.filter(Boolean);

  const handsD=await fb('GET','/poker2/hands')||{};
  const scores={};
  const showdownObj={};
  alive.forEach(n=>{
    const hole=handsD[encN(n)]||[];
    showdownObj[encN(n)]=hole;
    if(hole.length===2&&board.length>=3){
      scores[n]=bestOf7([...hole,...board]);
    } else {
      scores[n]=-1;
    }
  });

  const maxScore=Math.max(...Object.values(scores));
  const winners=alive.filter(n=>scores[n]===maxScore);
  const share=Math.floor(pot/winners.length);
  const remainder=pot-share*winners.length;

  winners.forEach((n,i)=>{
    chipsMap[n]=(chipsMap[n]||0)+share+(i===0?remainder:0);
  });

  const winnerNames=winners.join(' & ');
  const handStr=winners.length===1?handName(maxScore):'split pot';
  const ann=`${winnerNames} wins ${fmtChips(pot)} with ${handStr}!`;

  const chipsUpdate={};
  winners.forEach(n=>{chipsUpdate[encN(n)]=chipsMap[n];});

  await Promise.all([
    fb('PUT','/poker2/showdown',showdownObj),
    fb('PATCH','/poker2/chips',chipsUpdate),
    fb('PUT','/poker2/winner',winnerNames),
    fb('PUT','/poker2/announcement',ann),
    fb('PUT','/poker2/pot',0),
    fb('PUT','/poker2/phase','showdown'),
  ]);
  pot=0;
  await Promise.all(winners.map(n=>recordWin(n)));
  toast(`${winnerNames} wins!`);
  phase='showdown';
  renderDealerConsole('showdown');
}

async function hostEndSession(){
  if(!confirm('End the poker session?'))return;
  await fb('PUT','/poker2/phase','reset');
  stopIvs();
  isHost=false;hostName='';
  playersInHand=[];chipsMap={};foldedMap={};allInMap={};betStreetMap={};pot=0;round=0;
  setTimeout(()=>Promise.all([
    fb('DELETE','/poker2/hands'),fb('DELETE','/poker2/community'),
    fb('DELETE','/poker2/communityFull'),fb('DELETE','/poker2/folded'),
    fb('DELETE','/poker2/allIn'),fb('DELETE','/poker2/bet'),
    fb('DELETE','/poker2/pot'),fb('DELETE','/poker2/winner'),
    fb('DELETE','/poker2/showdown'),fb('DELETE','/poker2/announcement'),
    fb('DELETE','/poker2/round'),fb('DELETE','/poker2/players'),
    fb('DELETE','/poker2/host'),fb('DELETE','/poker2/chips'),
    fb('DELETE','/poker2/phase'),
  ]),3000);
  enterLobby();
}

window.addEventListener('beforeunload',()=>{
  if(myName){
    fetch(`${DB}/online/${encodeURIComponent(myName)}.json`,{method:'DELETE',keepalive:true});
    fetch(`${DB}/poker2/lobby/${encN(myName)}.json`,{method:'DELETE',keepalive:true});
  }
});

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopIvs();return;}
  if(!myName)return;
  const active=id=>document.getElementById(id)?.classList.contains('active');
  if(active('s-lobby'))startLobbyPolling();
  else if(active('s-player'))startPlayerPolling();
  else if(isHost&&active('s-dealer')){
    stopIvs();
    ivs.push(setInterval(pollBettingActions,1500));
  }
});

init();
