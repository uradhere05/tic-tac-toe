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
const COLS=5, WIN_W=Math.floor(SCR_W/COLS), WIN_H=SCR_H;

const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm'];

async function run(){
  const browser = await chromium.launch({
    headless: false, channel: 'chrome',
    args: ['--disable-background-timer-throttling','--disable-renderer-backgrounding',
           '--disable-backgrounding-occluded-windows','--disable-infobars','--no-default-browser-check'],
  });

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

  console.log('\nAll players in lobby and ready. Dealer can now click "Arrange Seats".');
  await new Promise(()=>{});  // keep open
}

run().catch(console.error);
