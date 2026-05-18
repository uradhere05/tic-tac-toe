# Texas Hold'em Poker — Room 7 Design Spec
**Date:** 2026-05-18  
**Status:** Approved  

---

## 1. Overview

Add a fully playable Texas Hold'em Poker game to Room 7 of FILO Gang Arena. One player acts as the non-playing Dealer (host/GM); up to 10 players join on their own devices. All card dealing, chip tracking, and betting is digital. Architecture mirrors Mafia (Room 8) exactly.

---

## 2. Files

| File | Purpose |
|------|---------|
| `poker.html` | HTML + CSS (dark green felt theme, playing card styles) |
| `poker.js` | All game logic (deck, evaluator, betting state machine, UI) |

**index.html changes:**
- Remove `cursor: not-allowed; pointer-events: none` from `.room-card-poker`
- Add `onclick="window.location.href='poker.html'"` to the room card
- Replace "🔜 Coming Soon" badge with live room presence label `id="rp-7"`
- Add hover/active transitions matching other room cards
- Add Room 7 presence polling to `renderRooms()` (same pattern as rooms 1–6)

---

## 3. Screens

| ID | Shown to | Purpose |
|----|---------|---------|
| `s-role-select` | All on load | Choose "Join as Player" or "Be the Dealer" |
| `s-lobby` | All | Ready up; dealer sees ▶ Start when ≥2 players ready |
| `s-dealer` | Dealer only | Full table console — phase buttons, live chip/action view |
| `s-player` | Players only | Hole cards, community board, chip stack, action buttons |

Login guard: no `localStorage.filoName` → redirect to `index.html`.

---

## 4. Firebase Data Model

Namespace: `/poker2/` (same DB as all other games).  
Key encoding: `encN(name)` = `name.replace(/ /g,'_')`, `decN(key)` = `key.replace(/_/g,' ')`.

```
/poker2/
  phase            string   lobby | preflop | flop | turn | river | showdown | reset
  host             string   dealer's name
  round            number   hand number (increments each hand)
  players          array    ordered player list for current hand (names)
  dealerPos        number   index into players array (rotates each hand)

  hands/<encN>     array    [{r,s},{r,s}]  hole cards — written at deal time
  communityFull    array    all 5 board cards [{r,s}×5] — written at deal, enables host reconnect
  community        object   {0..4} → {r,s} | null   (null = not yet revealed)

  pot              number   total pot in cents
  chips/<encN>     number   player stack in cents (persists across hands)
  folded/<encN>    bool     folded this hand
  allIn/<encN>     bool     all-in this hand

  bet/on           string   name of player whose turn it is to act
  bet/queue        array    [names still to act this street, in order]
  bet/current      number   current bet level this street in cents
  bet/lastRaise    number   size of last raise (for min-raise enforcement)
  bet/street/<encN> number  amount committed this street by each player
  bet/action/<encN> object  {type, amount, ts} — player writes here to act

  announcement     string   host-written; all player screens display it
  winner           string   winner of last hand
  showdown/<encN>  array    hands revealed at showdown

  lobby/<encN>     object   {name, ts, ready, avatar}
  avatars/<encN>   string   emoji avatar
```

---

## 5. Chip System

| Parameter | Value |
|-----------|-------|
| Buy-in | $20.00 = 2000 cents |
| Big blind | 20¢ = 20 cents |
| Small blind | 10¢ = 10 cents |
| Minimum raise | Current bet + max(BB, last raise size) |
| All-in | Player commits all remaining chips (any amount) |
| Display format | Always `$X.XX` |
| Rebuy | Player at 0 chips sees "Re-buy $20" button; available between hands only; each rebuy = exactly $20; no limit on number of rebuys |

---

## 6. Hand Flow

```
Dealer: "Start Hand"
  1. Rotate dealerPos
  2. Determine SB = players[(dealerPos+1) % n], BB = players[(dealerPos+2) % n]
     Heads-up exception: SB = dealer, BB = other player
  3. Deduct SB (10¢) and BB (20¢) from their stacks → pot
  4. Shuffle fresh 52-card deck
  5. Deal 2 hole cards to each active (non-busted) player → /poker2/hands/<encN>
  6. Write all 5 community cards to /poker2/communityFull (hidden)
  7. Write community = {0:null, 1:null, 2:null, 3:null, 4:null}
  8. Set bet/current = 20, bet/street/SB = 10, bet/street/BB = 20
  9. Set bet/queue = [UTG, ..., SB, BB] (pre-flop: BB acts last)
  10. Set phase = "preflop"

Betting round (automatic — host just watches):
  - bet/on = first in queue
  - Player sees action buttons when bet/on === myName
  - Player writes bet/action/<encN> = {type, amount, ts}
  - Host polling (1500ms) detects action, processes:
      fold  → mark folded, remove from queue
      check → valid only if bet/street[me] === bet/current; advance queue
      call  → commit (bet/current - bet/street[me]) cents; if chips < that → all-in; advance queue
      raise → commit amount; update bet/current; update bet/lastRaise;
               reset queue = [all active non-folded except raiser, in order]
  - If only 1 active player remains → that player wins pot (no showdown)
  - When queue is empty → betting round over, host console shows phase button

Dealer: "Deal Flop"    → reveal community 0,1,2; reset streets; set queue = [first active left of dealer, clockwise, dealer last]
Dealer: "Deal Turn"    → reveal community 3; reset streets; same queue order
Dealer: "Deal River"   → reveal community 4; reset streets; same queue order

Dealer: "Showdown"
  - Write showdown/<encN> for all active players
  - Evaluate each: bestOf7(holeCards + community) → score
  - Highest score wins; ties → split pot (round down, remainder to first left of dealer)
  - Transfer pot to winner(s); write winner
  - Record win to /leaderboard/<weekKey>/<name>
  - Phase = "showdown" (players see result)

Dealer: "Next Hand" → clear hand state, go back to lobby or start next hand
Dealer: "End Session" → phase = reset, cleanup
```

---

## 7. Card Representation

```javascript
// r: rank index 0–12  (0=2, 1=3, ..., 8=T, 9=J, 10=Q, 11=K, 12=A)
// s: suit index 0–3   (0=♠, 1=♥, 2=♦, 3=♣)
// Red suits: 1 (♥) and 2 (♦)
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['♠','♥','♦','♣'];
```

Card display: white rounded rectangle, rank top-left, suit centered, colour red for ♥/♦.  
Face-down: dark blue gradient back pattern.

---

## 8. Hand Evaluator

All C(7,5) = 21 five-card combinations checked per player.

**Score encoding (24-bit integer, higher = better):**
```
score = (handRank << 20) | (r0 << 16) | (r1 << 12) | (r2 << 8) | (r3 << 4) | r4
```
Where `handRank` 0–8 and r0…r4 are the tiebreaker ranks in descending importance.

**Hand ranks:**
| Rank | Name |
|------|------|
| 8 | Straight Flush (incl. Royal) |
| 7 | Four of a Kind |
| 6 | Full House |
| 5 | Flush |
| 4 | Straight |
| 3 | Three of a Kind |
| 2 | Two Pair |
| 1 | One Pair |
| 0 | High Card |

Ace-low straight (A-2-3-4-5, "wheel") handled: straightHigh = 3 (rank of 5).

---

## 9. Dealer Console Layout

- **Top bar:** Round #, Phase badge, Pot display
- **Community row:** 5 card slots (hidden/revealed)
- **Player table:** Each active player — name, avatar, stack, street bet, action status chip, fold/all-in badge
- **Controls:** Phase button (Deal Flop / Turn / River / Showdown / Next Hand), End Session
- **Announcement textarea:** Host can write/edit announcement shown to all players

---

## 10. Player View Layout

- **Community board:** 5 card slots (hidden until revealed)
- **Announcement banner:** Dealer's message
- **Hole cards:** 2 large cards (only own cards, face-up; others face-down if shown at all)
- **Status row:** My stack | Pot | Current bet
- **Action panel (when bet/on === myName):**  
  Fold · Check/Call (auto-label) · Raise (with ¢ input, min/max enforced)
- **Waiting state (when not my turn):** "Waiting for [name]…"
- **Dead state (folded/busted):** ghost card view, watching only

---

## 11. Reconnect

On load, `checkActiveGame()`:
- Fetch `/poker2/phase` and `/poker2/host`
- If no active game → `enterRoleSelect()`
- If `phase === reset` → `enterRoleSelect()`
- If player is in the hand (has entry in `/poker2/hands/<encN>`) → restore `s-player`
- If player is dealer (`host === myName`) → restore `s-dealer` with `reconnectDealer(phase)`

`communityFull` ensures dealer can always reveal the next card after reconnect without losing deck state.

---

## 12. Side Pots (v1 scope)

Not implemented in v1. All-in players compete for the full pot. Edge-case: if an all-in player has contributed less than another, the excess of the larger contribution is returned to that player at showdown. This covers the common all-in scenario without full side-pot machinery.

---

## 13. Leaderboard

Win recorded to `/leaderboard/<YYYY-MM-DD>/<name>` (Monday-keyed week), same as all other games. One win per hand won. Dealer wins are never recorded (dealer doesn't play).

---

## 14. Simulation / Testing

New sim file: `poker-sim.js`  
Journey: `index.html` → name click → lobby → Room 7 → `poker.html` → role-select → lobby → 1 complete hand  
Key assertions: hole cards dealt, betting round processes fold/call/raise, showdown evaluates correctly, winner chips updated, leaderboard recorded.

---

## 15. Out of Scope (v1)

- Side pots (partial all-in against multiple players)
- Tournament mode (fixed buy-in, no rebuy, last player standing wins)
- Chat
- Hand history / recap screen (can add later like Mafia history)
- Player sitting out a hand voluntarily