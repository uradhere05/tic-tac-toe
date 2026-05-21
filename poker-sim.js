const { chromium } = require('playwright');
const URL = 'https://filo-gang-arena.web.app/poker.html';
const DEALER_NAME = 'Kuya AD';
const PLAYERS = ['Matt','Gianne','Austin'];
const ROUNDS = 5;
const bugs = [];

async function makeCtx(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  await ctx.addInitScript(n => localStorage.setItem('filoName', n), name);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') bugs.push('['+name+'] '+m.text()); });
  page.on('pageerror', e => bugs.push('['+name+'] PAGE ERR: '+e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  return page;
}

async function clickBtn(page, text, timeout) {
  timeout = timeout || 12000;
  try {
    await page.waitForSelector('button:has-text("'+text+'")', { state: 'visible', timeout });
    await page.click('button:has-text("'+text+'")');
    return true;
  } catch(e) { bugs.push('TIMEOUT: '+text); return false; }
}

async function playStreet(playerPgs) {
  for (let i = 0; i < 10; i++) {
    let acted = false;
    for (let j = 0; j < playerPgs.length; j++) {
      const page = playerPgs[j].page;
      const name = playerPgs[j].name;
      const html = await page.locator('#p-action').innerHTML().catch(function(){ return ''; });
      if (!html.includes('onclick')) continue;
      const hasCheck = await page.locator('button:has-text("Check")').isVisible().catch(function(){ return false; });
      const hasCall  = await page.locator('button:has-text("Call")').isVisible().catch(function(){ return false; });
      const hasAllin = await page.locator('button:has-text("All-In")').isVisible().catch(function(){ return false; });
      if (hasCheck) {
        await page.click('button:has-text("Check")'); acted = true;
      } else if (hasCall) {
        await page.click('button:has-text("Call")'); acted = true;
      } else if (hasAllin) {
        await page.click('button:has-text("All-In")'); acted = true;
      } else {
        const hasFold = await page.locator('button:has-text("Fold")').isVisible().catch(function(){ return false; });
        if (hasFold) { await page.click('button:has-text("Fold")'); acted = true; }
      }
      await page.waitForTimeout(400);
    }
    if (!acted) break;
    await new Promise(function(r){ setTimeout(r, 500); });
  }
}

async function dealerCtrl(page, label, timeout) {
  timeout = timeout || 15000;
  try {
    await page.waitForSelector('#d-controls button', { state: 'visible', timeout });
    const btns = await page.locator('#d-controls button').all();
    for (let i = 0; i < btns.length; i++) {
      const t = await btns[i].textContent();
      if (t.indexOf(label) !== -1) { await btns[i].click(); return true; }
    }
    bugs.push('Dealer ctrl not found: '+label);
    return false;
  } catch(e) { bugs.push('Dealer ctrl timeout: '+label); return false; }
}

(async function() {
  console.log('Launching 4 windows...');
  const browser = await chromium.launch({ headless: false });

  const dealer = await makeCtx(browser, DEALER_NAME);
  const pgs = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    pgs.push({ page: await makeCtx(browser, PLAYERS[i]), name: PLAYERS[i] });
  }

  console.log('Kuya AD -> Be the Dealer');
  await dealer.click('button:has-text("BE THE DEALER")');
  await dealer.waitForTimeout(2000);

  console.log('Players joining...');
  for (let i = 0; i < pgs.length; i++) {
    await pgs[i].page.click('button:has-text("JOIN AS PLAYER")');
    await pgs[i].page.waitForTimeout(600);
  }
  await dealer.waitForTimeout(1500);

  console.log('Players readying up...');
  for (let i = 0; i < pgs.length; i++) {
    await clickBtn(pgs[i].page, 'READY UP', 5000);
    await pgs[i].page.waitForTimeout(400);
  }
  await dealer.waitForTimeout(2000);

  console.log('Arranging seats...');
  await clickBtn(dealer, 'ARRANGE SEATS', 8000);
  await dealer.waitForTimeout(1500);

  console.log('Starting game...');
  const startBtn = dealer.locator('#s-seating button:has-text("START GAME")');
  await startBtn.waitFor({ state: 'visible', timeout: 8000 });
  await startBtn.click();
  await dealer.waitForTimeout(2500);
  console.log('Game started!');

  for (let r = 1; r <= ROUNDS; r++) {
    console.log('--- Round '+r+' ---');

    await dealerCtrl(dealer, 'Deal New Hand', 10000);
    await dealer.waitForTimeout(2000);

    console.log('  preflop...');
    await playStreet(pgs);
    await dealer.waitForTimeout(800);

    await dealerCtrl(dealer, 'Deal Flop', 12000);
    await dealer.waitForTimeout(1500);
    console.log('  flop...');
    await playStreet(pgs);
    await dealer.waitForTimeout(800);

    await dealerCtrl(dealer, 'Deal Turn', 12000);
    await dealer.waitForTimeout(1500);
    console.log('  turn...');
    await playStreet(pgs);
    await dealer.waitForTimeout(800);

    await dealerCtrl(dealer, 'Deal River', 12000);
    await dealer.waitForTimeout(1500);
    console.log('  river...');
    await playStreet(pgs);
    await dealer.waitForTimeout(800);

    await dealerCtrl(dealer, 'Showdown', 12000);
    await dealer.waitForTimeout(2500);
    console.log('  done');

    await dealer.screenshot({ path: '/tmp/r'+r+'-dealer.png' });
    for (let i = 0; i < pgs.length; i++) {
      await pgs[i].page.screenshot({ path: '/tmp/r'+r+'-'+pgs[i].name+'.png' });
    }
  }

  console.log('Ending session...');
  await dealer.click('button:has-text("End Session")').catch(function(){});
  await dealer.waitForTimeout(1000);
  await dealer.click('#cm-ok-btn').catch(function(){});
  await dealer.waitForTimeout(3000);

  await dealer.screenshot({ path: '/tmp/final-dealer.png' });
  for (let i = 0; i < pgs.length; i++) {
    await pgs[i].page.screenshot({ path: '/tmp/final-'+pgs[i].name+'.png' });
  }

  console.log('\n=== BUG REPORT ===');
  if (bugs.length) { bugs.forEach(function(b){ console.log(' -', b); }); }
  else { console.log('  No bugs detected'); }

  await dealer.waitForTimeout(5000);
  await browser.close();
})().catch(function(e){ console.error('FATAL:', e.message); });
