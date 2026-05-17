# Poker Seat Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a host-only drag-to-reorder "Arrange Seats" screen between the lobby and game start so the host can set player seat order before dealing begins.

**Architecture:** Entirely client-side for the host. `startGame()` (already referenced in HTML but missing from JS) fetches the ready-player list, then shows a new `s-seating` screen with a draggable list. When the host confirms, `hostStartSession(orderedPlayers)` runs unchanged except it now receives a pre-ordered array instead of building one itself. Non-host players remain in the lobby with no Firebase change needed during arrangement.

**Tech Stack:** Vanilla JS, HTML5 drag-and-drop API (desktop) + touchstart/touchmove/touchend (mobile), existing Firebase REST, `poker.html` / `poker.js`.

---

### Task 1: Add missing wrapper functions to poker.js

The HTML already calls `startGame()`, `sendAnnouncement()`, and `endSession()` but none of them exist in `poker.js` — they were always broken. Fix this by adding them.

**Files:**
- Modify: `poker.js` (insert after `hostEndSession` function, around line 693)

- [ ] **Step 1: Insert the three wrapper functions after `hostEndSession`**

In `poker.js`, find the closing `}` of `hostEndSession` (the function ending around line 693) and insert immediately after it:

```js
/* ─── HTML button handlers ─── */
async function startGame(){
  const freshLobby=await fb('GET','/poker2/lobby')||{};
  const now=Date.now();
  const readyPlayers=Object.values(freshLobby)
    .filter(p=>p?.name&&p.name!==hostName&&p.ready&&now-p.ts<STALE_MS)
    .map(p=>p.name);
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
```

- [ ] **Step 2: Verify functions are visible from browser console**

Open `poker.html` in browser. In DevTools console type:
```
typeof startGame
```
Expected output: `"function"`

---

### Task 2: Refactor `hostStartSession()` to accept a pre-ordered array

Currently `hostStartSession()` re-fetches the lobby and builds the player list itself. Change it to accept an `orderedPlayers` array directly (the caller now owns lobby fetching).

**Files:**
- Modify: `poker.js:262-295` (the entire `hostStartSession` function body)

- [ ] **Step 1: Replace the entire `hostStartSession` function**

Find and replace from `async function hostStartSession(){` to its closing `}` with:

```js
async function hostStartSession(orderedPlayers){
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
    fb('PUT','/poker2/pot',0),
    fb('PUT','/poker2/dealerPos',0),
    fb('PUT','/poker2/avatars',Object.fromEntries(
      orderedPlayers.filter(n=>avatarsMap[n]).map(n=>[encN(n),avatarsMap[n]])
    )),
  ]);
  playersInHand=orderedPlayers;
  dealerPos=-1;
  stopIvs();
  show('s-dealer');
  renderDealerConsole('lobby');
}
```

- [ ] **Step 2: Verify no other call sites**

```bash
grep -n "hostStartSession" /Users/adml/FILO-GANG-ARENA/poker.js
```

Expected: only the function definition itself plus the call in `confirmSeats` (added in Task 5). No other calls.

---

### Task 3: Add seating screen CSS to poker.html

**Files:**
- Modify: `poker.html` (before `</style>`)

- [ ] **Step 1: Append CSS just before `</style>`**

Find `</style>` in `poker.html` and insert immediately before it:

```css
/* ── Seat Assignment ── */
.seat-list{width:100%;max-width:420px;margin-bottom:14px;user-select:none;}
.seat-row{
  display:flex;align-items:center;gap:10px;
  padding:14px 16px;border-radius:12px;margin-bottom:6px;
  background:rgba(255,255,255,0.05);
  border:1px solid rgba(255,255,255,0.12);
  min-height:58px;touch-action:none;
  transition:background 0.12s,transform 0.12s;
}
.seat-row.dragging{
  background:rgba(46,204,113,0.15);
  border-color:rgba(46,204,113,0.5);
  opacity:0.85;transform:scale(1.02);
}
.seat-row.drag-over{
  border-color:rgba(255,210,0,0.7);
  background:rgba(255,210,0,0.09);
}
.seat-handle{font-size:1.1rem;opacity:0.4;cursor:grab;touch-action:none;padding:2px 6px;}
.seat-num{
  width:24px;height:24px;border-radius:50%;flex-shrink:0;
  background:rgba(255,210,0,0.12);border:1px solid rgba(255,210,0,0.4);
  color:#FFD200;font-size:0.7rem;font-weight:700;
  display:flex;align-items:center;justify-content:center;
}
.seat-av{font-size:1.3rem;}
.seat-name{flex:1;font-size:0.88rem;font-weight:600;}
```

---

### Task 4: Add `s-seating` screen HTML to poker.html

**Files:**
- Modify: `poker.html` (after the closing `</div>` of `s-lobby`, before `s-dealer`)

- [ ] **Step 1: Insert screen after the `s-lobby` closing div**

Find `<!-- SCREEN 3: DEALER CONSOLE -->` comment and insert the following block immediately before it:

```html
<!-- ══════════════════════════════════════════
     SCREEN 2b: SEAT ASSIGNMENT (host only)
══════════════════════════════════════════ -->
<div class="screen" id="s-seating">
  <div class="p-title">🃏 FILO POKER</div>
  <div class="p-sub">Seat Assignment</div>
  <div class="host-badge" style="margin-bottom:12px">🎰 Dealer</div>

  <div class="section-lbl">Drag to set seat order</div>
  <div class="seat-list" id="seat-list"></div>

  <button class="btn btn-gold w100" onclick="confirmSeats()">▶ Start Game</button>
</div>
```

---

### Task 5: Add seat arrangement JS to poker.js

Add state variables, all drag/touch functions, and `confirmSeats`.

**Files:**
- Modify: `poker.js` (state vars near top; seat functions after the `endSession` wrapper block)

- [ ] **Step 1: Add state variables after `let _dealerDeck=[];` (line 25)**

Find `let _dealerDeck=[];` and insert on the next line:

```js
let seatOrder=[],_dragFrom=-1,_touchDragIdx=-1;
```

- [ ] **Step 2: Add all seat functions after `endSession()`**

Immediately after `function endSession(){hostEndSession();}`, insert:

```js
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
  if(_dragFrom===-1||i===_dragFrom)return;
  const moved=seatOrder.splice(_dragFrom,1)[0];
  seatOrder.splice(i,0,moved);
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
  if(dropIdx!==-1&&dropIdx!==_touchDragIdx){
    const moved=seatOrder.splice(_touchDragIdx,1)[0];
    seatOrder.splice(dropIdx,0,moved);
    renderSeatList();
  }
  _touchDragIdx=-1;
}

async function confirmSeats(){
  if(seatOrder.length<MIN_PLAYERS){toast('Need at least 2 players');return;}
  await hostStartSession(seatOrder);
}
```

---

### Task 6: Update lobby button text + commit

Update the lobby "Start Game" button label to reflect the new seating step, then commit everything.

**Files:**
- Modify: `poker.js` (inside `renderLobbyUI`, line ~245)

- [ ] **Step 1: Change button text in `renderLobbyUI`**

Find:
```js
if(canStart)startBtn.textContent=`▶ Start Game (${readyPlayers.length} players)`;
```

Replace with:
```js
if(canStart)startBtn.textContent=`▶ Arrange Seats (${readyPlayers.length} players)`;
```

- [ ] **Step 2: Smoke test**

Open two browser tabs on `poker.html` with different `localStorage.filoName` values. On Tab 1 become Dealer, on Tab 2 click "Join as Player" then "Ready Up". Tab 1 should show "▶ Arrange Seats (1 players)". Click it — Tab 1 should show the seating screen with Tab 2's player in a draggable row with a gold "1" badge. Drag the row and confirm the seat number updates. Click "▶ Start Game" — Tab 1 should show the Dealer Console.

- [ ] **Step 3: Commit**

```bash
git add poker.html poker.js
git commit -m "feat: host seat arrangement screen before game start"
git push
```
