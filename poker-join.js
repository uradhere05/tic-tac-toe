'use strict';
const { chromium } = require('playwright');
const { execSync } = require('child_process');

function getScreenSize(){
  try{
    const out=execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const[,,w,h]=out.split(',').map(Number);return{w,h};
  }catch{return{w:1440,h:900};}
}
const{w:SCR_W,h:SCR_H}=getScreenSize();
const COLS=3, WIN_W=Math.floor(SCR_W/COLS), WIN_H=SCR_H;

const NAMES=['Kuya AD','Matt','Gianne'];
const FB_URL='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';

async function fbReset(){
  // Wipe the whole lobby + host so joinAsPlayer/joinAsDealer start fresh
  await Promise.all([
    fetch(`${FB_URL}/poker2/host.json`,{method:'DELETE'}),
    fetch(`${FB_URL}/poker2/lobby.json`,{method:'DELETE'}),
  ]);
  console.log('Firebase state cleared.');
}

async function run(){
  const browser = await chromium.launch({
    headless: false, channel: 'chrome',
    args: ['--disable-background-timer-throttling','--disable-renderer-backgrounding',
           '--disable-backgrounding-occluded-windows','--disable-infobars','--no-default-browser-check'],
  });

  await fbReset();

  const pages = [];
  console.log(`Opening ${NAMES.length} windows…`);
  for(let i=0;i<NAMES.length;i++){
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const {windowId} = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds',{windowId,bounds:{left:i*WIN_W,top:0,width:WIN_W,height:WIN_H,windowState:'normal'}});
    await page.goto('http://localhost:8080/index.html');
    await page.evaluate(n => localStorage.setItem('filoName', n), NAMES[i]);
    await page.goto('http://localhost:8080/poker.html');
    pages.push({ page, name: NAMES[i] });
    console.log(`  Window ${i+1}: ${NAMES[i]}`);
  }

  // Wait for role-select screens to load
  await new Promise(r => setTimeout(r, 1500));

  // Window 0 becomes Dealer, rest join as players
  console.log('\nJoining game…');
  await pages[0].page.evaluate(() => joinAsDealer());
  console.log(`  ${NAMES[0]} → Dealer`);
  await new Promise(r => setTimeout(r, 600));

  for(let i=1;i<pages.length;i++){
    await pages[i].page.evaluate(() => joinAsPlayer());
    console.log(`  ${NAMES[i]} → Player`);
    await new Promise(r => setTimeout(r, 400));
  }

  // Wait for lobby screens, then ready up all players
  await new Promise(r => setTimeout(r, 1500));
  console.log('\nReadying up players…');
  for(let i=1;i<pages.length;i++){
    await pages[i].page.evaluate(() => toggleReady());
    console.log(`  ${NAMES[i]} ✅ ready`);
    await new Promise(r => setTimeout(r, 400));
  }

  // Dealer clicks "Arrange Seats" → then confirms seat order
  await new Promise(r => setTimeout(r, 1200));
  console.log('\nDealer clicking "Arrange Seats"…');
  await pages[0].page.evaluate(() => startGame());
  await new Promise(r => setTimeout(r, 800));
  console.log('  Dealer confirming seat order…');
  await pages[0].page.evaluate(() => confirmSeats());
  await new Promise(r => setTimeout(r, 1200));
  console.log('  Dealer dealing first hand…');
  await pages[0].page.evaluate(() => hostStartHand());
  console.log('  ✅ Hand dealt!');

  // TEST 1: Stand up Matt mid-hand after 3s
  await new Promise(r => setTimeout(r, 3000));
  console.log('\n[TEST 1] Dealer standing up Matt mid-hand…');
  const mattEnc = await pages[0].page.evaluate(() => encN('Matt'));
  await pages[0].page.evaluate(enc => dealerStandPlayer(enc), mattEnc);
  console.log('  ✅ Stand-up triggered.');

  // TEST 2: Matt readies up from lobby after 4s
  await new Promise(r => setTimeout(r, 4000));
  console.log('\n[TEST 2] Matt readying up from lobby…');
  await pages[1].page.evaluate(() => toggleReady());
  console.log('  ✅ Matt ready.');

  // TEST 3: Dealer deals next hand — Matt should be included
  await new Promise(r => setTimeout(r, 2000));
  console.log('\n[TEST 3] Dealer dealing next hand…');
  await pages[0].page.evaluate(() => hostStartHand());
  console.log('  ✅ Next hand dealt. Matt should be back in.');

  console.log('\nAll windows open. Play away!');
  await new Promise(()=>{});  // keep open
}

run().catch(console.error);
