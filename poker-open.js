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

  console.log(`Opening 5 windows (${WIN_W}×${WIN_H} each)…`);
  for(let i=0;i<5;i++){
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const {windowId} = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds',{windowId,bounds:{left:i*WIN_W,top:0,width:WIN_W,height:WIN_H,windowState:'normal'}});
    // Pre-set name in localStorage then go to poker.html
    await page.goto('http://localhost:8080/index.html');
    await page.evaluate(n => localStorage.setItem('filoName', n), NAMES[i]);
    await page.goto('http://localhost:8080/poker.html');
    console.log(`  Window ${i+1}: ${NAMES[i]}`);
  }
  console.log('\nAll 5 windows open. Play manually — press Ctrl+C to close.');
  await new Promise(()=>{});  // keep open
}

run().catch(console.error);
