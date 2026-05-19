'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');

const NAMES       = ['Kuya AD','Matt','Gianne','Austin','Charm'];
const TOTAL_ROUNDS = 8;
const FB_URL      = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';

/* ── layout ── */
function getScreenSize(){
  try{
    const out=execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const[,,w,h]=out.split(',').map(Number);return{w,h};
  }catch{return{w:1440,h:900};}
}
const{w:SCR_W,h:SCR_H}=getScreenSize();
const COLS=5, WIN_W=Math.floor(SCR_W/COLS), WIN_H=SCR_H;

/* ── Firebase helpers (Node.js side) ── */
async function fbGet(path){
  const r=await fetch(`${FB_URL}${path}.json`);
  return r.json();
}
async function fbPut(path,data){
  await fetch(`${FB_URL}${path}.json`,{method:'PUT',body:JSON.stringify(data),headers:{'Content-Type':'application/json'}});
}
async function fbDelete(path){
  await fetch(`${FB_URL}${path}.json`,{method:'DELETE'});
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fbReset(){
  await Promise.all([
    fbDelete('/poker2/host'),
    fbDelete('/poker2/lobby'),
  ]);
  console.log('Firebase cleared.');
}

/* ── Auto-play one full hand to showdown ── */
// allInHand=true: first actor raises all-in, rest call (tests side pots)
async function autoPlayHand(dealerPage, allInHand=false){
  let lastBetOn=null;
  let firstAction=true;
  const deadline=Date.now()+120_000; // 2 min safety timeout

  while(Date.now()<deadline){
    const [phase, betOn, currentBet, betStreetD, chipsD]=await Promise.all([
      fbGet('/poker2/phase'),
      fbGet('/poker2/bet/on'),
      fbGet('/poker2/bet/current'),
      fbGet('/poker2/bet/street'),
      fbGet('/poker2/chips'),
    ]);

    if(phase==='showdown') break;

    if(betOn){
      if(betOn===lastBetOn){
        // Action already submitted, waiting for dealer to process
        await sleep(300);
        continue;
      }
      lastBetOn=betOn;
      const enc=betOn.replace(/ /g,'_');
      const myBet=(betStreetD||{})[enc]||0;
      const myChips=(chipsD||{})[enc]||0;
      const owe=Math.max(0,(currentBet||0)-myBet);

      let type,amount,label;
      if(allInHand&&firstAction&&myChips>0){
        // first actor goes all-in
        const raiseTotal=myBet+myChips;
        type='raise';amount=raiseTotal;
        label=`raise ALL-IN $${(raiseTotal/100).toFixed(2)}`;
        firstAction=false;
      } else {
        type=owe===0?'check':'call';
        amount=currentBet||0;
        label=`${type}${owe>0?` $${(owe/100).toFixed(2)}`:''}`;
        firstAction=false;
      }
      await fbPut(`/poker2/bet/action/${enc}`,{type,amount,ts:Date.now()});
      console.log(`    ${betOn.padEnd(10)} → ${label}`);
      await sleep(900); // give dealer browser time to process
    } else {
      // No one acting — advance to next street via dealer page
      await sleep(400); // brief settle
      const phase2=await fbGet('/poker2/phase');
      if(phase2==='showdown') break;

      if(phase2==='preflop'){
        console.log(`    [street] → Flop`);
        await dealerPage.evaluate(()=>hostDealFlop());
        lastBetOn=null;
        await sleep(1000);
      } else if(phase2==='flop'){
        console.log(`    [street] → Turn`);
        await dealerPage.evaluate(()=>hostDealTurn());
        lastBetOn=null;
        await sleep(1000);
      } else if(phase2==='turn'){
        console.log(`    [street] → River`);
        await dealerPage.evaluate(()=>hostDealRiver());
        lastBetOn=null;
        await sleep(1000);
      } else if(phase2==='river'){
        console.log(`    [street] → Showdown`);
        await dealerPage.evaluate(()=>hostShowdown());
        lastBetOn=null;
        await sleep(1500);
      } else {
        await sleep(400);
      }
    }
  }

  // Print chip counts after hand
  const chips=await fbGet('/poker2/chips');
  const winner=await fbGet('/poker2/winner');
  if(winner) console.log(`    Winner: ${winner}`);
  if(chips){
    const rows=NAMES.slice(1).map(n=>{
      const enc=n.replace(/ /g,'_');
      const v=chips[enc]??'?';
      return `${n}: $${typeof v==='number'?(v/100).toFixed(2):v}`;
    }).join('  |  ');
    const total=Object.values(chips).reduce((s,v)=>s+(typeof v==='number'?v:0),0);
    const expected=(NAMES.length-1)*200000/100; // 4 players × $20 in cents
    const drift=total-(NAMES.length-1)*2000;
    console.log(`    Chips → ${rows}`);
    console.log(`    Total: $${(total/100).toFixed(2)} ${drift!==0?`⚠ DRIFT ${drift>0?'+':''}${(drift/100).toFixed(2)}`:'✓ balanced'}`);
  }
}

/* ── Main ── */
async function run(){
  const browser=await chromium.launch({
    headless:false,channel:'chrome',
    args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows','--disable-infobars','--no-default-browser-check'],
  });

  await fbReset();

  /* Open 5 windows */
  const pages=[];
  console.log(`Opening ${NAMES.length} windows…`);
  for(let i=0;i<NAMES.length;i++){
    const ctx=await browser.newContext({viewport:null});
    const page=await ctx.newPage();
    const cdp=await ctx.newCDPSession(page);
    const{windowId}=await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds',{windowId,bounds:{left:i*WIN_W,top:0,width:WIN_W,height:WIN_H,windowState:'normal'}});
    await page.goto('http://localhost:8080/index.html');
    await page.evaluate(n=>localStorage.setItem('filoName',n),NAMES[i]);
    await page.goto('http://localhost:8080/poker.html');
    pages.push({page,name:NAMES[i]});
    console.log(`  Window ${i+1}: ${NAMES[i]}`);
  }

  await sleep(1500);

  /* Join roles */
  console.log('\nJoining game…');
  await pages[0].page.evaluate(()=>joinAsDealer());
  console.log(`  ${NAMES[0]} → Dealer`);
  await sleep(600);

  for(let i=1;i<pages.length;i++){
    await pages[i].page.evaluate(()=>joinAsPlayer());
    console.log(`  ${NAMES[i]} → Player`);
    await sleep(400);
  }

  /* Ready up players */
  await sleep(1500);
  console.log('\nReadying up players…');
  for(let i=1;i<pages.length;i++){
    await pages[i].page.evaluate(()=>toggleReady());
    console.log(`  ${NAMES[i]} ✅`);
    await sleep(400);
  }

  /* Arrange seats → start session */
  await sleep(1200);
  console.log('\nDealer → Arrange Seats…');
  await pages[0].page.evaluate(()=>startGame());
  await sleep(800);
  console.log('Dealer → Confirm seats…');
  await pages[0].page.evaluate(()=>confirmSeats());
  await sleep(1500);

  /* 8 rounds */
  const dealerPage=pages[0].page;
  for(let round=1;round<=TOTAL_ROUNDS;round++){
    console.log(`\n═══ HAND ${round}/${TOTAL_ROUNDS} ═══`);
    await dealerPage.evaluate(()=>hostStartHand());
    await sleep(2000);
    const allIn=round%3===0; // every 3rd hand is an all-in hand
    if(allIn)console.log('  [ALL-IN HAND — testing side pots]');
    await autoPlayHand(dealerPage,allIn);
    console.log(`  ✅ Hand ${round} complete`);
    await sleep(2500); // show showdown screen
  }

  /* Final chip report */
  console.log('\n═══ FINAL STANDINGS ═══');
  const finalChips=await fbGet('/poker2/chips');
  if(finalChips){
    NAMES.slice(1)
      .map(n=>({name:n,chips:finalChips[n.replace(/ /g,'_')]??0}))
      .sort((a,b)=>b.chips-a.chips)
      .forEach(({name,chips},i)=>{
        const medal=['🥇','🥈','🥉','  ','  '][i]||'  ';
        console.log(`  ${medal} ${name.padEnd(12)} $${(chips/100).toFixed(2)}`);
      });
  }

  console.log('\nAll 8 hands complete. Windows stay open — close when done.');
  await new Promise(()=>{}); // keep browser open
}

run().catch(console.error);
