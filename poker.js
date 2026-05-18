'use strict';
/* ─── Constants ─── */
const DB='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
const AVATARS=['🕵️','🤵','👩‍⚕️','👨‍💼','👩‍💼','🧑‍🌾','👩‍🍳','🧑‍🔧','👮','👨‍🍳'];
const AMAP=Object.fromEntries(NAMES.map((n,i)=>[n,AVATARS[i]]));
const RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS=['♠','♥','♦','♣'];
const RED_SUITS=new Set([1,2]); // ♥=1, ♦=2
const STARTING_CHIPS=2000; // $20.00
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
let seatOrder=[],_dragFrom=-1,_touchDragIdx=-1;
let onlineMap={};
let dealerHandsCache={},hiddenCards={};

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
  const url=`${DB}/leaderboard/${getWeekKey()}/${encodeURIComponent(name)}/poker.json`;
  try{const cur=await fetch(url).then(r=>r.json()).catch(()=>0)||0;
    await fetch(url,{method:'PUT',body:JSON.stringify(cur+1)});}catch{}
}

function getMonthKey(){
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
function getMonthLabel(){
  return new Date().toLocaleDateString('en-AU',{month:'long',year:'numeric'});
}
function fmtNet(cents){
  if(cents===0)return '$0.00';
  const sign=cents>0?'+':'-';
  return `${sign}$${(Math.abs(cents)/100).toFixed(2)}`;
}
function netCls(cents){return cents>0?'chip-pos':cents<0?'chip-neg':'chip-zero';}

async function recordPokerSession(){
  if(!isHost||!Object.keys(chipsMap).length)return;
  const monthKey=getMonthKey();
  const now=new Date();
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  // daily game number — resets to 1 each new day
  const dailyCount=await fb('GET',`/poker-hall/${monthKey}/daily/${today}`)||0;
  const gameNum=dailyCount+1;
  await fb('PUT',`/poker-hall/${monthKey}/daily/${today}`,gameNum);
  // monthly session id for unique storage key
  const totalCount=await fb('GET',`/poker-hall/${monthKey}/count`)||0;
  const sessionId=totalCount+1;
  await fb('PUT',`/poker-hall/${monthKey}/count`,sessionId);
  const rebuysData=await fb('GET','/poker2/rebuys')||{};
  const results={};
  for(const[name,chips]of Object.entries(chipsMap)){
    const rebuys=rebuysData[encN(name)]||0;
    const buyIn=(1+rebuys)*STARTING_CHIPS;
    results[encN(name)]={buyIn,net:chips-buyIn};
  }
  const timeStr=new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true});
  await fb('PUT',`/poker-hall/${monthKey}/sessions/${sessionId}`,{date:today,time:timeStr,gameNum,results});
}

async function loadPokerHall(){
  const bodies=document.querySelectorAll('.hall-body');
  const monthLbls=document.querySelectorAll('.hall-month-lbl');
  if(!bodies.length)return;
  monthLbls.forEach(el=>el.textContent=getMonthLabel());
  bodies.forEach(el=>el.innerHTML='<div class="hall-empty">Loading…</div>');
  const monthKey=getMonthKey();
  const data=await fb('GET',`/poker-hall/${monthKey}`)||{};
  const sessions=Object.values(data.sessions||{}).filter(Boolean).sort((a,b)=>b.gameNum-a.gameNum);
  if(!sessions.length){
    bodies.forEach(el=>el.innerHTML='<div class="hall-empty">No sessions this month</div>');
    return;
  }
  // parse result entry — supports old flat number and new {buyIn,net} object
  const parseEntry=v=>typeof v==='object'&&v!==null?{buyIn:v.buyIn||STARTING_CHIPS,net:v.net||0}:{buyIn:STARTING_CHIPS,net:v||0};
  // accumulate monthly totals
  const totals={};   // { name: { buyIn, net } }
  for(const s of sessions){
    for(const[enc,val]of Object.entries(s.results||{})){
      const n=decN(enc);
      const{buyIn,net}=parseEntry(val);
      if(!totals[n])totals[n]={buyIn:0,net:0};
      totals[n].buyIn+=buyIn;
      totals[n].net+=net;
    }
  }
  const sortedTotals=Object.entries(totals).sort((a,b)=>b[1].net-a[1].net);
  const medals=['🥇','🥈','🥉'];
  let html='<div class="hall-sub-hdr">Monthly Totals</div>';
  sortedTotals.forEach(([name,t],i)=>{
    html+=`<div class="hall-total-row">
      <span class="hall-tr-rank">${medals[i]||i+1}</span>
      <span class="hall-tr-name">${name}</span>
      <span class="hall-tr-buyin">$${(t.buyIn/100).toFixed(0)} in</span>
      <span class="hall-tr-amt ${netCls(t.net)}">${fmtNet(t.net)}</span>
    </div>`;
  });
  html+='<div class="hall-sub-hdr" style="margin-top:14px">Session History</div>';
  for(const s of sessions){
    const d=new Date(s.date+'T12:00:00');
    const dateStr=d.toLocaleDateString('en-AU',{month:'short',day:'numeric'});
    const players=Object.entries(s.results||{})
      .map(([k,v])=>{const{buyIn,net}=parseEntry(v);return[decN(k),buyIn,net];})
      .sort((a,b)=>b[2]-a[2]);
    html+=`<div class="hall-session"><div class="hall-session-hdr">Game #${s.gameNum} · ${dateStr}${s.time?' · '+s.time:''}</div>`;
    players.forEach(([name,buyIn,net])=>{
      html+=`<div class="hall-session-row">
        <span class="hall-sr-name">${name}</span>
        <span class="hall-sr-buyin">$${(buyIn/100).toFixed(0)}</span>
        <span class="hall-sr-amt ${netCls(net)}">${fmtNet(net)}</span>
      </div>`;
    });
    html+='</div>';
  }
  bodies.forEach(el=>el.innerHTML=html);
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
const RANK_CODES=['2','3','4','5','6','7','8','9','0','J','Q','K','A'];
const SUIT_CODES=['S','H','D','C'];
function cardHTML(card,small=false){
  const cls=small?'card-img card-img-sm':'card-img';
  if(!card) return `<img class="${cls}" src="https://deckofcardsapi.com/static/img/back.png" alt="card back">`;
  const rc=RANK_CODES[card.r],sc=SUIT_CODES[card.s];
  return `<img class="${cls}" src="https://deckofcardsapi.com/static/img/${rc}${sc}.png" alt="${RANKS[card.r]}${SUITS[card.s]}">`;
}
function emptyCardHTML(){return '<div class="card-empty"></div>';}
function fmtChips(cents){return `$${(cents/100).toFixed(2)}`;}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

const CHIP_DENOMS=[
  {c:200,cls:'chip-200',lbl:'$2'},
  {c:100,cls:'chip-100',lbl:'$1'},
  {c:50, cls:'chip-50', lbl:'50¢'},
  {c:20, cls:'chip-20', lbl:'20¢'},
  {c:10, cls:'chip-10', lbl:'10¢'},
];
const CHIP_ROUND=CHIP_DENOMS.reduce((s,d)=>s+d.c,0); // 380¢ per balanced round
function chipsHTML(cents){
  if(!cents||cents<=0)return '<div class="chip-row"></div>';
  const counts=CHIP_DENOMS.map(()=>0);
  const base=Math.floor(cents/CHIP_ROUND);
  let rem=cents-base*CHIP_ROUND;
  counts.forEach((_,i)=>counts[i]=base);
  for(let i=0;i<CHIP_DENOMS.length;i++){
    const n=Math.floor(rem/CHIP_DENOMS[i].c);
    if(n){counts[i]+=n;rem-=n*CHIP_DENOMS[i].c;}
  }
  let html='<div class="chip-row">';
  for(let i=0;i<CHIP_DENOMS.length;i++){
    if(!counts[i])continue;
    html+=`<div class="chip ${CHIP_DENOMS[i].cls}"><span class="chip-lbl">${CHIP_DENOMS[i].lbl}</span>${counts[i]>1?`<span class="chip-n">${counts[i]}</span>`:''}</div>`;
  }
  return html+'</div>';
}

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

async function joinAsPlayer(){
  const[phaseD,chipsVal]=await Promise.all([
    fb('GET','/poker2/phase'),
    fb('GET',`/poker2/chips/${encN(myName)}`),
  ]);
  if(phaseD&&phaseD!=='lobby'&&phaseD!=='reset'){
    if(chipsVal==null){toast('A game is already in progress');return;}
    show('s-player');startPlayerPolling();return;
  }
  const lobbyEntry=await fb('GET',`/poker2/lobby/${encN(myName)}`);
  if(lobbyEntry?.name===myName){toast('You are already in the lobby');return;}
  enterLobby();
}

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
  loadPokerHall();
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
  if(canStart)startBtn.textContent=`▶ Arrange Seats (${readyPlayers.length} players)`;
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

async function hostStartSession(orderedPlayers){
  orderedPlayers=[...new Set(orderedPlayers)];
  const chipsInit={};
  orderedPlayers.forEach(n=>{
    chipsInit[encN(n)]=STARTING_CHIPS;
    chipsMap[n]=STARTING_CHIPS;
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
    fb('DELETE','/poker2/rebuys'),
    fb('PUT','/poker2/pot',0),
    fb('PUT','/poker2/dealerPos',0),
    fb('PUT','/poker2/players',orderedPlayers),
    fb('PUT','/poker2/avatars',Object.fromEntries(
      orderedPlayers.filter(n=>avatarsMap[n]).map(n=>[encN(n),avatarsMap[n]])
    )),
  ]);
  playersInHand=orderedPlayers;
  dealerPos=-1;
  stopIvs();
  show('s-dealer');
  renderDealerConsole('lobby');
  loadPokerHall();
}

/* ─── Dealer: Game Control ─── */
async function reloadDealerState(){
  const[,chipsD,foldedD,allInD,communityD,communityFullD,potD,betD,roundD,playersD,dealerPosD,avsD]=await Promise.all([
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
  ivs.push(setInterval(pollPresence,6000));
  pollPresence();
}

async function pollPresence(){
  onlineMap=await fb('GET','/online')||{};
  if(!document.getElementById('s-dealer')?.classList.contains('active'))return;
  const activePlayers=playersInHand.length?playersInHand:Object.keys(chipsMap);
  activePlayers.forEach(name=>{
    const dot=document.getElementById(`pdot-${encN(name)}`);
    if(dot)dot.className=`pdot ${isOnline(name)?'pdot-on':'pdot-off'}`;
  });
}

function isOnline(name){
  const entry=onlineMap[name]||onlineMap[encodeURIComponent(name)];
  if(!entry)return false;
  const ts=typeof entry==='object'?entry.ts:entry;
  return Date.now()-ts<40000;
}

function togglePlayerCards(enc){
  hiddenCards[enc]=!hiddenCards[enc];
  const el=document.getElementById(`pr-cards-${enc}`);
  const btn=document.getElementById(`pr-reveal-${enc}`);
  if(!el)return;
  if(hiddenCards[enc]){
    el.innerHTML=cardHTML(null,true)+cardHTML(null,true);
    if(btn)btn.textContent='👁';
  }else{
    const cards=dealerHandsCache[enc];
    if(cards&&Array.isArray(cards))el.innerHTML=cards.map(c=>cardHTML(c,true)).join('');
    if(btn)btn.textContent='🙈';
  }
}

async function hostStartHand(){
  const activePlayers=playersInHand.filter(n=>chipsMap[n]>0);
  if(activePlayers.length<2){toast('Need at least 2 players with chips');return;}
  playersInHand=activePlayers;

  round++;
  dealerPos=(dealerPos+1)%activePlayers.length;
  foldedMap={};allInMap={};betStreetMap={};dealerHandsCache={};pot=0;currentBet=BB;betLastRaise=BB;
  communityCards=[null,null,null,null,null];
  handStartTs=Date.now();

  const n=activePlayers.length;
  const sbIdx=(dealerPos+1)%n;
  const bbIdx=(dealerPos+2)%n;
  const sbName=n===2?activePlayers[dealerPos]:activePlayers[sbIdx];
  const bbName=n===2?activePlayers[sbIdx]:activePlayers[bbIdx];

  const sbPosted=Math.min(SB,chipsMap[sbName]);
  const bbPosted=Math.min(BB,chipsMap[bbName]);
  chipsMap[sbName]-=sbPosted;
  chipsMap[bbName]-=bbPosted;
  betStreetMap[sbName]=sbPosted;
  betStreetMap[bbName]=bbPosted;
  pot=sbPosted+bbPosted;
  if(chipsMap[sbName]<=0)allInMap[sbName]=true;
  if(chipsMap[bbName]<=0)allInMap[bbName]=true;

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
  ivs.push(setInterval(pollPresence,6000));
  pollPresence();
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

    const enc=encN(name);
    prows.innerHTML+=`<div class="pr-row${folded?' is-folded':''}${isActing?' pr-acting':''}">
      <span class="pdot ${isOnline(name)?'pdot-on':'pdot-off'}" id="pdot-${enc}"></span>
      <span class="pr-av">${getAvatar(name)}</span>
      <span class="pr-name">${escHtml(name)}${name===playersInHand[dealerPos]?' 🔘':''}</span>
      <span class="pr-stack">${fmtChips(chips)}</span>
      <span class="pr-bet">${bet?fmtChips(bet):''}</span>
      <span class="pr-status ${statusCls}">${statusTxt}</span>
      ${phase!=='lobby'?`<button class="btn-reveal" id="pr-reveal-${enc}" onclick="togglePlayerCards('${enc}')" title="Show/hide cards">${hiddenCards[enc]?'👁':'🙈'}</button>`:''}
      <span class="pr-cards" id="pr-cards-${enc}">${phase!=='lobby'?cardHTML(null,true)+cardHTML(null,true):''}</span>
    </div>`;
  });

  if(phase!=='lobby'){
    fb('GET','/poker2/hands').then(handsD=>{
      if(!handsD)return;
      dealerHandsCache=handsD;
      Object.entries(handsD).forEach(([k,cards])=>{
        if(hiddenCards[k])return;
        const el=document.getElementById(`pr-cards-${k}`);
        if(el&&Array.isArray(cards))el.innerHTML=cards.map(c=>cardHTML(c,true)).join('');
      });
    });
    fb('GET','/poker2/showdown').then(sd=>{
      if(!sd)return;
      Object.entries(sd).forEach(([k,cards])=>{
        const el=document.getElementById(`pr-cards-${k}`);
        if(el&&Array.isArray(cards))el.innerHTML=cards.map(c=>cardHTML(c,true)).join('')+
          '<br><span style="font-size:.55rem;opacity:.6">'+handName(bestOf7([...cards,...communityCards.filter(Boolean)]))+'</span>';
        const btn=document.getElementById(`pr-reveal-${k}`);
        if(btn)btn.style.display='none';
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
    const raiseTotal=Math.max(amount,currentBet+betLastRaise);
    const owe=Math.max(0,raiseTotal-(betStreetMap[playerName]||0));
    const toAdd=Math.min(owe,chipsMap[playerName]||0);
    chipsMap[playerName]=(chipsMap[playerName]||0)-toAdd;
    betStreetMap[playerName]=(betStreetMap[playerName]||0)+toAdd;
    pot+=toAdd;
    const increment=raiseTotal-currentBet;
    if(increment>=betLastRaise)betLastRaise=increment;
    currentBet=raiseTotal;
    if(chipsMap[playerName]<=0){allInMap[playerName]=true;await fb('PUT',`/poker2/allIn/${enc}`,true);}
    await fb('PATCH','/poker2/chips',{[enc]:chipsMap[playerName]});
    await fb('PUT','/poker2/pot',pot);
    await fb('PUT','/poker2/bet/current',currentBet);
    await fb('PUT','/poker2/bet/lastRaise',betLastRaise);
    await fb('PATCH','/poker2/bet/street',{[enc]:betStreetMap[playerName]});
    const raiserIdx=playersInHand.indexOf(playerName);
    betQueue=[];
    for(let i=1;i<playersInHand.length;i++){
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
function firstActiveFromDealer(){
  const n=playersInHand.length;
  const left=(dealerPos+1)%n;
  for(let i=0;i<n;i++){
    const idx=(left+i)%n;
    if(!foldedMap[playersInHand[idx]]&&!allInMap[playersInHand[idx]])return idx;
  }
  return left;
}

async function hostDealFlop(){
  if(betOn){toast('Betting not complete');return;}
  communityCards[0]=communityFull[0];
  communityCards[1]=communityFull[1];
  communityCards[2]=communityFull[2];
  await fb('PUT','/poker2/community',{
    0:communityCards[0],1:communityCards[1],2:communityCards[2],3:null,4:null});
  await newBettingStreet('flop',firstActiveFromDealer());
  renderDealerConsole('flop');
}

async function hostDealTurn(){
  if(betOn){toast('Betting not complete');return;}
  communityCards[3]=communityFull[3];
  await fb('PUT','/poker2/community',{
    0:communityCards[0],1:communityCards[1],2:communityCards[2],3:communityCards[3],4:null});
  await newBettingStreet('turn',firstActiveFromDealer());
  renderDealerConsole('turn');
}

async function hostDealRiver(){
  if(betOn){toast('Betting not complete');return;}
  communityCards[4]=communityFull[4];
  await fb('PUT','/poker2/community',{
    0:communityCards[0],1:communityCards[1],2:communityCards[2],
    3:communityCards[3],4:communityCards[4]});
  await newBettingStreet('river',firstActiveFromDealer());
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
  await recordPokerSession();
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
    fb('DELETE','/poker2/rebuys'),fb('DELETE','/poker2/phase'),
  ]),3000);
  enterLobby();
}

/* ─── HTML button handlers ─── */
async function startGame(){
  const freshLobby=await fb('GET','/poker2/lobby')||{};
  const now=Date.now();
  const readyPlayers=[...new Set(Object.values(freshLobby)
    .filter(p=>p?.name&&p.name!==hostName&&p.ready&&now-p.ts<STALE_MS)
    .map(p=>p.name))];
  if(readyPlayers.length<MIN_PLAYERS){toast('Need at least 2 ready players');return;}
  readyPlayers.forEach(n=>{if(freshLobby[encN(n)]?.avatar)avatarsMap[n]=freshLobby[encN(n)].avatar;});
  enterSeating(readyPlayers);
}
async function sendAnnouncement(){
  const text=document.getElementById('d-ann').value.trim();
  if(!text)return;
  await fb('PUT','/poker2/announcement',text);
  toast('Announcement sent');
}
function endSession(){hostEndSession();}

/* ─── Seat Arrangement ─── */
function enterSeating(players){
  seatOrder=[...players];
  renderSeatList();
  show('s-seating');
}

function renderSeatList(){
  const list=document.getElementById('seat-list');
  list.innerHTML=seatOrder.map((name,i)=>`
    <div class="seat-row" data-idx="${i}"
         draggable="true"
         ondragstart="seatDragStart(event,${i})"
         ondragover="seatDragOver(event,${i})"
         ondrop="seatDrop(event,${i})"
         ondragend="seatDragEnd()">
      <span class="seat-handle">☰</span>
      <span class="seat-num">${i+1}</span>
      <span class="seat-av">${getAvatar(name)}</span>
      <span class="seat-name">${escHtml(name)}</span>
    </div>`).join('');
  list.querySelectorAll('.seat-row').forEach((row,i)=>{
    row.addEventListener('touchstart',e=>touchSeatStart(e,i),{passive:false});
    row.addEventListener('touchmove', e=>touchSeatMove(e),   {passive:false});
    row.addEventListener('touchend',  ()=>touchSeatEnd(),    {passive:false});
  });
}

function seatDragStart(e,i){
  _dragFrom=i;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
}
function seatDragOver(e,i){
  e.preventDefault();
  if(i===_dragFrom)return;
  document.querySelectorAll('#seat-list .seat-row').forEach(r=>r.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
function seatDrop(e,i){
  e.preventDefault();
  const from=_dragFrom;
  _dragFrom=-1;
  if(from===-1||i===from)return;
  const arr=[...seatOrder];
  const[moved]=arr.splice(from,1);
  arr.splice(i,0,moved);
  seatOrder=arr;
  renderSeatList();
}
function seatDragEnd(){
  document.querySelectorAll('#seat-list .seat-row').forEach(r=>r.classList.remove('dragging','drag-over'));
  _dragFrom=-1;
}

function touchSeatStart(e,i){
  e.preventDefault();
  _touchDragIdx=i;
  document.querySelectorAll('#seat-list .seat-row')[i].classList.add('dragging');
}
function touchSeatMove(e){
  if(_touchDragIdx===-1)return;
  e.preventDefault();
  const y=e.touches[0].clientY;
  document.querySelectorAll('#seat-list .seat-row').forEach(r=>r.classList.remove('drag-over'));
  for(const r of document.querySelectorAll('#seat-list .seat-row')){
    const rect=r.getBoundingClientRect();
    if(y>=rect.top&&y<=rect.bottom){
      if(+r.dataset.idx!==_touchDragIdx)r.classList.add('drag-over');
      break;
    }
  }
}
function touchSeatEnd(){
  if(_touchDragIdx===-1)return;
  const rows=document.querySelectorAll('#seat-list .seat-row');
  let dropIdx=-1;
  rows.forEach(r=>{if(r.classList.contains('drag-over'))dropIdx=+r.dataset.idx;});
  rows.forEach(r=>r.classList.remove('dragging','drag-over'));
  const from=_touchDragIdx;
  _touchDragIdx=-1;
  if(dropIdx!==-1&&dropIdx!==from){
    const arr=[...seatOrder];
    const[moved]=arr.splice(from,1);
    arr.splice(dropIdx,0,moved);
    seatOrder=arr;
    renderSeatList();
  }
}

async function confirmSeats(){
  if(seatOrder.length<MIN_PLAYERS){toast('Need at least 2 players');return;}
  await hostStartSession(seatOrder);
}

/* ─── Player ─── */
let _knownPhase='',_knownBetOn='';

function startPlayerPolling(){
  stopIvs();
  const badge=document.getElementById('p-hole');
  if(badge)badge.innerHTML='';
  const nb=document.getElementById('p-name-badge');
  if(nb)nb.textContent=`${getAvatar(myName)} ${myName}`;
  ivs.push(setInterval(pollGameState,1500));
  ivs.push(setInterval(writePlayerPresence,20000));
}

async function writePlayerPresence(){
  await fb('PUT',`/online/${encodeURIComponent(myName)}`,{ts:Date.now()});
}

async function pollGameState(){
  if(_pollRunning)return;_pollRunning=true;
  try{
    const[phD,potD,commD,annD,chipsD,betD,foldedD,allInD,winnerD,avsD]=await Promise.all([
      fb('GET','/poker2/phase'),fb('GET','/poker2/pot'),
      fb('GET','/poker2/community'),fb('GET','/poker2/announcement'),
      fb('GET','/poker2/chips'),fb('GET','/poker2/bet'),
      fb('GET','/poker2/folded'),fb('GET','/poker2/allIn'),
      fb('GET','/poker2/winner'),fb('GET','/poker2/avatars'),
    ]);
    if(phD==='reset'){
      stopIvs();
      toast('Dealer ended the session',3000);
      setTimeout(()=>location.replace('index.html'),2000);
      return;
    }
    if(potD!=null)pot=potD;
    if(chipsD)Object.entries(chipsD).forEach(([k,v])=>{chipsMap[decN(k)]=v;});
    foldedMap=foldedD?Object.fromEntries(Object.entries(foldedD).map(([k,v])=>[decN(k),v])):{};
    allInMap=allInD?Object.fromEntries(Object.entries(allInD).map(([k,v])=>[decN(k),v])):{};
    if(avsD)Object.entries(avsD).forEach(([k,v])=>{avatarsMap[decN(k)]=v;});
    if(commD)for(let i=0;i<5;i++) communityCards[i]=commD[i]||null;
    if(betD){
      currentBet=betD.current||0;
      betOn=betD.on||'';
      betStreetMap=betD.street?Object.fromEntries(Object.entries(betD.street).map(([k,v])=>[decN(k),v])):{};
    }
    renderCommunityCards();
    renderStatusRow();
    renderOtherPlayers();
    const annEl=document.getElementById('p-ann');
    if(annEl){annEl.style.display=annD?'':'none';if(annD)annEl.textContent=annD;}
    if(phD!==_knownPhase||betOn!==_knownBetOn){
      _knownPhase=phD;_knownBetOn=betOn;
      await renderPlayerPhase(phD,winnerD);
    }
  }finally{_pollRunning=false;}
}

function renderCommunityCards(){
  const el=document.getElementById('p-community');
  if(!el)return;
  el.innerHTML='';
  for(let i=0;i<5;i++){
    el.innerHTML+=communityCards[i]?cardHTML(communityCards[i]):emptyCardHTML();
  }
}

function renderStatusRow(){
  const myChips=chipsMap[myName]||0;
  const myBet=betStreetMap[myName]||0;
  const toCall=Math.max(0,currentBet-myBet);
  document.getElementById('p-mystack').textContent=fmtChips(myChips);
  document.getElementById('p-pot').textContent=fmtChips(pot);
  const sc=document.getElementById('p-stack-chips');
  const pc=document.getElementById('p-pot-chips');
  if(sc)sc.innerHTML=chipsHTML(myChips);
  if(pc)pc.innerHTML=chipsHTML(pot);
  document.getElementById('p-tocall').textContent=fmtChips(toCall);
}

function renderOtherPlayers(){
  const el=document.getElementById('p-others');
  if(!el)return;
  const players=Object.keys(chipsMap).filter(n=>n!==myName);
  el.innerHTML=players.map(n=>{
    const folded=foldedMap[n];
    const isMe=n===myName;
    return`<div class="pl-row${folded?' pl-folded':''}${isMe?' pl-me':''}">
      <span>${getAvatar(n)} ${escHtml(n)}${n===betOn?' ⏳':''}</span>
      <span class="pl-chips">${fmtChips(chipsMap[n]||0)}</span>
    </div>`;
  }).join('');
}

async function renderPlayerPhase(ph,winner){
  const myChips=chipsMap[myName]||0;
  const myFolded=foldedMap[myName];
  const myBet=betStreetMap[myName]||0;
  const toCall=Math.max(0,currentBet-myBet);
  const isMyTurn=betOn===myName&&!myFolded;
  const actionEl=document.getElementById('p-action');
  const holeEl=document.getElementById('p-hole');

  if(ph==='lobby'||ph==='reset'){
    actionEl.innerHTML='<div style="opacity:.4;font-size:.82rem;text-align:center;padding:16px">Waiting for dealer to start…</div>';
    return;
  }
  if(ph==='preflop'||ph==='flop'||ph==='turn'||ph==='river'){
    if(ph==='preflop'&&holeEl&&holeEl.innerHTML){holeEl.innerHTML='';holeCards=[];}
    if(holeEl&&!holeEl.innerHTML){
      const hD=await fb('GET',`/poker2/hands/${encN(myName)}`);
      if(hD&&Array.isArray(hD))holeEl.innerHTML=hD.map(c=>cardHTML(c)).join('');
      holeCards=hD||[];
    }
    if(myFolded||myChips===0){
      actionEl.innerHTML='<div class="phase-card"><div style="font-size:2rem">👻</div><div style="opacity:.6;margin-top:8px">'+
        (myFolded?'You folded. Watching…':'You\'re all-in. Watching…')+'</div></div>';
      return;
    }
    if(isMyTurn){
      renderActionButtons(toCall,myChips);
    } else {
      actionEl.innerHTML=`<div style="opacity:.45;font-size:.82rem;text-align:center;padding:12px">
        ${betOn?`Waiting for ${escHtml(betOn)}…`:'Waiting for dealer…'}</div>`;
    }
  }
  if(ph==='showdown'){
    const sdD=await fb('GET',`/poker2/showdown/${encN(myName)}`)||[];
    if(holeEl&&sdD.length)holeEl.innerHTML=sdD.map(c=>cardHTML(c)).join('');
    const myScore=holeCards.length===2&&communityCards.filter(Boolean).length>=3
      ?bestOf7([...holeCards,...communityCards.filter(Boolean)]):-1;
    const isWinner=winner&&winner.includes(myName);
    actionEl.innerHTML=`<div class="phase-card" style="border-color:${isWinner?'rgba(255,210,0,.5)':'rgba(76,175,80,.3)'}">
      <div style="font-size:2.2rem">${isWinner?'🏆':'💸'}</div>
      <div style="font-weight:900;font-size:1.1rem;margin:6px 0">${isWinner?'You Win!':'Better luck next time'}</div>
      ${myScore>0?`<div style="font-size:.75rem;opacity:.6">${handName(myScore)}</div>`:''}
      <div style="font-size:.78rem;opacity:.5;margin-top:6px">Waiting for dealer to start next hand…</div>
    </div>`;
    if(myChips===0){
      actionEl.innerHTML+=`<div style="text-align:center;margin-top:10px">
        <div style="font-size:1rem;font-weight:700;margin-bottom:8px">You're out of chips!</div>
        <button class="btn btn-gold btn-sm" onclick="requestRebuy()">💵 Re-buy $20.00</button>
      </div>`;
    }
  }
}

function renderActionButtons(toCall,myChips){
  const canCheck=toCall===0;
  const minRaise=currentBet+betLastRaise;
  const actionEl=document.getElementById('p-action');
  actionEl.innerHTML=`
    <div class="action-panel">
      <div class="action-row">
        <button class="btn btn-danger btn-sm" onclick="submitAction('fold',0)">Fold</button>
        ${canCheck
          ?`<button class="btn btn-primary btn-sm" onclick="submitAction('check',0)">Check</button>`
          :`<button class="btn btn-primary btn-sm" onclick="submitAction('call',${currentBet})">${toCall>=myChips?'All-In':'Call'} ${fmtChips(toCall)}</button>`
        }
      </div>
      <div class="raise-row">
        <input type="number" class="raise-input" id="raise-amt"
          min="${(minRaise/100).toFixed(2)}" max="${((betStreetMap[myName]||0)+myChips)/100}"
          step="0.10" value="${(minRaise/100).toFixed(2)}" placeholder="${fmtChips(minRaise)}">
        <button class="btn btn-gold btn-sm" onclick="submitRaise()">Raise</button>
      </div>
      <div style="font-size:.6rem;opacity:.4;text-align:center;margin-top:4px">
        min raise: ${fmtChips(minRaise)} · max: ${fmtChips((betStreetMap[myName]||0)+myChips)}
      </div>
    </div>`;
}

async function submitAction(type,amount){
  await fb('PUT',`/poker2/bet/action/${encN(myName)}`,{type,amount,ts:Date.now()});
  const actionEl=document.getElementById('p-action');
  actionEl.innerHTML='<div style="opacity:.5;font-size:.82rem;text-align:center;padding:12px">'+
    (type==='fold'?'Folded.':type==='check'?'Checked. Waiting…':'Called. Waiting…')+'</div>';
}

async function submitRaise(){
  const input=document.getElementById('raise-amt');
  const raiseTotal=Math.round(+input.value*100/10)*10;
  const minRaise=currentBet+betLastRaise;
  const myMaxBet=(betStreetMap[myName]||0)+(chipsMap[myName]||0);
  if(raiseTotal<minRaise){toast(`Min raise is ${fmtChips(minRaise)}`);return;}
  if(raiseTotal>myMaxBet){toast(`Max bet is ${fmtChips(myMaxBet)}`);return;}
  await fb('PUT',`/poker2/bet/action/${encN(myName)}`,{type:'raise',amount:raiseTotal,ts:Date.now()});
  const actionEl=document.getElementById('p-action');
  actionEl.innerHTML=`<div style="opacity:.5;font-size:.82rem;text-align:center;padding:12px">Raised to ${fmtChips(raiseTotal)}. Waiting…</div>`;
}

async function requestRebuy(){
  const curChips=await fb('GET',`/poker2/chips/${encN(myName)}`)||0;
  if(curChips>0){toast('You still have chips!');return;}
  const ph=await fb('GET','/poker2/phase');
  if(ph==='preflop'||ph==='flop'||ph==='turn'||ph==='river'){
    toast("Can't rebuy during a live hand");return;
  }
  const curRebuys=await fb('GET',`/poker2/rebuys/${encN(myName)}`)||0;
  await fb('PUT',`/poker2/rebuys/${encN(myName)}`,curRebuys+1);
  chipsMap[myName]=STARTING_CHIPS;
  await fb('PUT',`/poker2/chips/${encN(myName)}`,STARTING_CHIPS);
  toast('Re-bought for $20.00! You\'re back in.');
}

function openCardOverlay(){
  if(!holeCards.length)return;
  const el=document.getElementById('overlay-cards');
  if(el)el.innerHTML=holeCards.map(c=>cardHTML(c)).join('');
  document.getElementById('card-overlay')?.classList.add('active');
}
function closeCardOverlay(){
  document.getElementById('card-overlay')?.classList.remove('active');
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
