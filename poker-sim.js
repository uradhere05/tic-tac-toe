/**
 * Poker Sim — starts at index.html.
 *
 * Journey: index.html → name click → Arena lobby → Room 7 → poker.html
 *          → role-select → Kuya AD = dealer, 3 players → 1 complete hand
 *
 * Run: node poker-sim.js
 */
'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');

const INDEX = 'http://localhost:8080/index.html';
const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getScreenSize(){
  try{
    const out=execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const[,,w,h]=out.split(',').map(Number);return{w,h};
  }catch{return{w:1440,h:900};}
}
const{w:SCR_W,h:SCR_H}=getScreenSize();
const COLS=5,WIN_W=Math.floor(SCR_W/COLS),WIN_H=SCR_H;

const fb=(path,method='GET',body)=>fetch(`${DB}${path}.json`,
  body!==undefined?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{method}
).then(r=>r.json()).catch(()=>null);

let passed=0,failed=0;
function assert(ok,label,detail=''){
  if(ok){console.log(`  ✅ ${label}`);passed++;}
  else{console.log(`  ❌ ${label}${detail?'  ← '+detail:''}`);failed++;}
}

async function openWindow(browser,x){
  const ctx=await browser.newContext({viewport:null});
  const page=await ctx.newPage();
  const cdp=await ctx.newCDPSession(page);
  const{windowId}=await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds',{windowId,bounds:{left:x,top:0,width:WIN_W,height:WIN_H,windowState:'normal'}});
  await page.goto(INDEX);
  return page;
}

async function waitScreen(pages,id,timeout=22000){
  const dl=Date.now()+timeout;
  const arr=Array.isArray(pages)?pages:[pages];
  while(Date.now()<dl){
    const r=await Promise.all(arr.map(p=>p.evaluate(sid=>document.getElementById(sid)?.classList.contains('active'),id).catch(()=>false)));
    if(r.every(Boolean))return true;
    await sleep(400);
  }
  return false;
}

async function waitFb(path,expected,timeout=12000){
  const dl=Date.now()+timeout;
  while(Date.now()<dl){
    if((await fb(path))===expected)return true;
    await sleep(500);
  }
  return false;
}

const GM={name:'Kuya AD'};
const PLAYERS=[{name:'Matt'},{name:'Gianne'},{name:'Austin'},{name:'Charm'}];

async function run(){
  console.log('\n🃏 Poker Sim — starts at index.html');
  console.log('   Full journey: name click → Room 7 → role-select → lobby → 1 hand\n');

  // Clear Firebase
  console.log('🗑️  Clearing /poker2 Firebase data…');
  await fb('/poker2','DELETE');
  await Promise.all([GM,...PLAYERS].map(p=>fb(`/online/${encodeURIComponent(p.name)}`,'DELETE')));
  await sleep(800);
  assert(await fb('/poker2/phase')===null,'Firebase /poker2 cleared');

  console.log(`🖥️  Screen ${SCR_W}×${SCR_H} → ${COLS} cols · each ${WIN_W}×${WIN_H}\n`);
  const browser=await chromium.launch({
    headless:false,channel:'chrome',
    args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows','--disable-infobars','--no-default-browser-check'],
  });

  // Open 5 windows
  console.log('── Opening 5 windows at index.html ─────────────────\n');
  const gmPage=await openWindow(browser,0);
  const playerPages=[];
  for(let i=0;i<PLAYERS.length;i++){
    playerPages.push(await openWindow(browser,(i+1)*WIN_W));
    await sleep(250);
  }

  // T0: ensure name screen is shown, click name card → lobby
  // If localStorage has a stale name the page boots straight to s-lobby,
  // bypassing s-name. Clear it first so the name-card click path is exercised.
  console.log('🖱️  Ensuring name screen, then clicking name cards…');
  const allPages=[gmPage,...playerPages];
  const allNames=[GM.name,...PLAYERS.map(p=>p.name)];
  for(let i=0;i<allPages.length;i++){
    await allPages[i].evaluate(()=>localStorage.clear());
    await allPages[i].reload();
    await sleep(400);
  }
  // Now all pages should be on s-name
  for(let i=0;i<allPages.length;i++){
    await allPages[i].click(`[data-name="${allNames[i]}"]`);
    await sleep(250);
  }
  assert(await waitScreen([gmPage,...playerPages],'s-lobby',18000),'T0a: all reach Arena lobby');

  console.log('🚪 Clicking Room 7 (Poker)…');
  await gmPage.click('.room-card-poker');
  await sleep(400);
  for(const p of playerPages){await p.click('.room-card-poker');await sleep(250);}
  assert(await waitScreen([gmPage,...playerPages],'s-role-select',22000),'T0b: all reach poker role-select');

  // T1: GM = dealer, players join
  console.log('🎭 Selecting roles…');
  await gmPage.click('button:has-text("Be the Dealer")');
  await sleep(400);
  for(const p of playerPages){await p.click('button:has-text("Join as Player")');await sleep(250);}
  assert(await waitScreen([gmPage,...playerPages],'s-lobby',22000),'T1a: all reach poker lobby');
  await sleep(2000);

  // T2: SpinnerFix on poker lobby
  console.log('\n── T2: SpinnerFix ───────────────────────────────────');
  const spinInfo=await gmPage.evaluate(()=>{
    const s=document.querySelector('.screen.active .btn-primary');
    if(!s)return{ok:false,h:0,fs:'missing'};
    const r=s.getBoundingClientRect();
    const cs=getComputedStyle(s);
    return{ok:r.height>=30&&cs.flexShrink==='0',h:r.height,fs:cs.flexShrink};
  }).catch(()=>({ok:false,h:0,fs:'err'}));
  assert(spinInfo.ok,`T2: lobby btn not squished (h=${spinInfo.h?.toFixed(1)}px, flex-shrink=${spinInfo.fs})`);

  // Ready up all players
  console.log('\n✅ Players readying up…');
  for(let i=0;i<playerPages.length;i++){
    await playerPages[i].evaluate(()=>toggleReady()).catch(()=>{});
    await sleep(400);
  }
  await sleep(2000);

  // GM starts session
  console.log('\n▶ Dealer starting session…');
  await gmPage.evaluate(async()=>{await startGame();await confirmSeats();}).catch(()=>{});
  await sleep(1500);
  assert(await waitScreen([gmPage],'s-dealer',10000),'T1b: GM on dealer console');
  // Note: players stay on s-lobby until hostStartHand() fires phase=preflop
  // T1c is checked after the hand starts (below).
  await sleep(1500);

  // Deal hand — this fires phase=preflop which triggers player transition to s-player
  console.log('\n🃏 Dealing first hand…');
  await gmPage.evaluate(()=>hostStartHand()).catch(()=>{});
  assert(await waitFb('/poker2/phase','preflop',8000),'T3a: phase = preflop');
  assert(await waitScreen(playerPages,'s-player',12000),'T1c: all players on player view');
  await sleep(2000);

  // T3: hole cards dealt
  const handsSnap=await fb('/poker2/hands');
  assert(handsSnap&&Object.keys(handsSnap).length===4,'T3b: 4 players have hole cards');
  assert(Object.values(handsSnap).every(h=>Array.isArray(h)&&h.length===2),'T3c: each player has 2 cards');

  // T4: pre-flop betting
  // Each action is processed by the dealer's pollBettingActions (1.5s interval).
  // After submitting, wait for betOn to change before submitting the next action.
  console.log('\n🎰 Pre-flop betting…');
  const byName=name=>playerPages[PLAYERS.findIndex(p=>p.name===name)];

  async function waitBetOnChange(prevOn,timeout=8000){
    const dl=Date.now()+timeout;
    while(Date.now()<dl){
      const cur=await fb('/poker2/bet/on');
      if(cur!==prevOn)return cur;
      await sleep(400);
    }
    return await fb('/poker2/bet/on');
  }

  let gianneRaised=false;
  for(let i=0;i<10;i++){
    const on=await fb('/poker2/bet/on');
    if(!on)break;
    console.log(`    betOn=${on}, submitting action…`);
    if(on==='Matt'){
      await byName('Matt').evaluate(()=>submitAction('fold',0)).catch(()=>{});
    } else if(on==='Gianne'&&!gianneRaised){
      gianneRaised=true;
      await byName('Gianne').evaluate(()=>submitAction('raise',40)).catch(()=>{});
    } else {
      // call if there's a bet, otherwise check
      const curBet=await fb('/poker2/bet/current');
      if(curBet>0){
        await byName(on)?.evaluate(()=>submitAction('call',0)).catch(()=>{});
      } else {
        await byName(on)?.evaluate(()=>submitAction('check',0)).catch(()=>{});
      }
    }
    // Wait for dealer to process and advance betOn
    await waitBetOnChange(on,8000);
  }
  assert(!!(await fb('/poker2/bet/on'))==false,'T4: pre-flop betting complete (betOn=null)');

  // T5: pot check
  const potSnap=await fb('/poker2/pot');
  assert(potSnap>=40,'T5: pot ≥ 40¢ after pre-flop',`got ${potSnap}¢`);
  console.log(`  Pot after pre-flop: $${(potSnap/100).toFixed(2)}`);

  // T6: deal flop
  console.log('\n🃏 Dealing flop…');
  await gmPage.evaluate(()=>hostDealFlop()).catch(()=>{});
  assert(await waitFb('/poker2/phase','flop',6000),'T6a: phase = flop');
  const commSnap=await fb('/poker2/community')||{};
  assert(commSnap[0]&&commSnap[1]&&commSnap[2],'T6b: 3 community cards revealed');
  assert(!commSnap[3]&&!commSnap[4],'T6c: turn/river still hidden');
  await sleep(2000);

  // T7: check through flop/turn/river
  async function checkAllActive(){
    for(let i=0;i<6;i++){
      const on=await fb('/poker2/bet/on');
      if(!on)break;
      console.log(`    betOn=${on}, checking…`);
      await byName(on)?.evaluate(()=>submitAction('check',0)).catch(()=>{});
      await waitBetOnChange(on,8000);
    }
  }

  console.log('\n🃏 Flop: check around…');
  await checkAllActive();
  assert(!await fb('/poker2/bet/on'),'T7a: flop betting done');

  console.log('\n🃏 Dealing turn…');
  await gmPage.evaluate(()=>hostDealTurn()).catch(()=>{});
  assert(await waitFb('/poker2/phase','turn',6000),'T7b: phase = turn');
  await sleep(2000);
  await checkAllActive();

  console.log('\n🃏 Dealing river…');
  await gmPage.evaluate(()=>hostDealRiver()).catch(()=>{});
  assert(await waitFb('/poker2/phase','river',6000),'T7c: phase = river');
  await sleep(2000);
  await checkAllActive();

  // T8: showdown
  console.log('\n⚖️  Showdown…');
  await gmPage.evaluate(()=>hostShowdown()).catch(()=>{});
  assert(await waitFb('/poker2/phase','showdown',6000),'T8a: phase = showdown');
  const winnerSnap=await fb('/poker2/winner');
  assert(!!winnerSnap,'T8b: winner recorded');
  const potAfter=await fb('/poker2/pot');
  assert(potAfter===0,'T8c: pot cleared after showdown');
  const chipsSnap=await fb('/poker2/chips')||{};
  const totalChips=Object.values(chipsSnap).reduce((s,v)=>s+(v||0),0);
  assert(totalChips===2000*PLAYERS.length,'T8d: total chips conserved',`got $${(totalChips/100).toFixed(2)}`);
  console.log(`  Winner: ${winnerSnap} · Total chips: $${(totalChips/100).toFixed(2)}`);

  // T9: leaderboard
  const weekKey=(()=>{const now=new Date();const diff=now.getDay()===0?-6:1-now.getDay();const mon=new Date(now);mon.setDate(now.getDate()+diff);return`${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;})();
  await sleep(1500);
  const lbSnap=await fb(`/leaderboard/${weekKey}/${encodeURIComponent(winnerSnap.split(' & ')[0])}`);
  assert(lbSnap>=1,`T9: ${winnerSnap.split(' & ')[0]} win in leaderboard (got ${lbSnap})`);

  // T10: next hand
  console.log('\n🃏 Dealing next hand…');
  await gmPage.evaluate(()=>hostStartHand()).catch(()=>{});
  assert(await waitFb('/poker2/round',2,8000),'T10: round increments to 2');
  const phase2=await fb('/poker2/phase');
  assert(phase2==='preflop','T10b: second hand in preflop');

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Poker Sim Results (started from index.html)');
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed+failed} total)`);
  console.log(failed===0?'🎉 ALL TESTS PASSED':`⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open 15 s for inspection…');
  await sleep(15000);
  await browser.close();
}

run().catch(err=>{console.error('\n❌ Sim error:',err.message);process.exit(1);});
