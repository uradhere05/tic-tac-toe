# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

After completing any meaningful unit of work, commit and push to GitHub so progress is never lost:

```
git add <files>
git commit -m "Short, descriptive message"
git push
```

Commit messages should describe what changed and why, not just what files were touched. Push after every commit — don't batch pushes.

## Running the games

No build step or server required — open any HTML file directly in a browser:

```
open index.html            # main lobby / arena
open mafia.html            # Filogang Mafia — Free-Play (Room 7)
open "mafia2.html?host"    # Mafia Host-Run — GM console (Room 8, host)
open mafia2.html           # Mafia Host-Run — player view
open pong.html             # Pickelbol (Rooms 5–6)
open connect5.html         # Streytlima Connect 5 (Rooms 3–4)
open tictactoe.html        # Solo/AI Tictactoe
```

## Architecture

A collection of standalone browser games sharing a common Firebase Realtime Database for presence, state, and leaderboards. No build step; no server required.

**Fixed player names (all games):** Kuya AD, Matt, Gianne, Austin, Charm, Kee, Kriselle, Monique, Tiff, Shantelle — hardcoded, no registration. Name stored in `localStorage.filoName`.

**Firebase DB:** `https://filo-gang-tictactoe-default-rtdb.firebaseio.com` (REST API, no SDK).

---

### `index.html` — FILO Gang Arena (lobby)

Main entry point. Shows all 8 rooms; clicking a room navigates to the appropriate game.

**External dependencies:** `peerjs@1.5.2` (WebRTC), Firebase REST API.

**Flow:** Name screen → Lobby (pick room) → Waiting screen → Game → Champion screen

**PeerJS room model:** Rooms 1–2 use fixed peer IDs (`filo-gang-room-N`). First player becomes host (X); second joins as guest (O). Falls back to `joinRoomN()` if ID is taken.

**Firebase paths:**
- `/online/<name>` — `{ts}` heartbeat presence (30s interval, deleted on `beforeunload`)
- `/rooms/room-N/host` and `/rooms/room-N/guest` — `{name, ts}` room occupancy
- `/leaderboard/<YYYY-MM-DD>/<name>` — number, weekly win counts (Monday-keyed)

**Leaderboard timezone fix:** Fetches entire `/leaderboard.json` and merges wins from keys within ±1 day of current week to handle UTC-offset drift.

**`WINS_NEED = 2`** — best of 3 (first to 2 game wins). Presence stale after 75s.

---

### `mafia.html` + `mafia.js` — Filogang Mafia (Room 7)

Multiplayer social deduction game for 5–10 players. Two files: `mafia.html` (HTML + CSS, ~280 lines) and `mafia.js` (game logic, ~560 lines).

**No external dependencies** — Firebase REST API + Web Audio API only.

**Roles:** Murderer (1), Detective (1 if 8+ players), Innocents (remainder). Randomly assigned by host.

**Flow:** Name screen → Lobby (ready up) → Role reveal (5s) → Game canvas → Meeting overlay → End screen

**Canvas map — Bloodmoor Manor:** 5 rooms as percentage-based rectangles on a full-viewport canvas (Foyer, Library, Ballroom, Kitchen, Basement + corridors). Movement: WASD + arrow keys + D-pad. Wall collision with sliding.

**Firebase paths (all under `/mafia/`):**
- `/mafia/lobby/<name>` — `{name, ready, ts}`
- `/mafia/host` — string
- `/mafia/state` — `"lobby" | "playing" | "meeting" | "ended"`
- `/mafia/roles/<name>` — `"murderer" | "innocent" | "detective"` (each player reads only their own)
- `/mafia/alive/<name>` — bool
- `/mafia/pos/<name>` — `{x, y, ts}` written every 300ms, polled every 500ms
- `/mafia/bodies/<id>` — `{victim, x, y, ts}`
- `/mafia/killCd/<name>` — timestamp when 25s kill cooldown expires
- `/mafia/meeting` — `{trigger, by, victim, startedAt, votes, chat, result}`
- `/mafia/winner` — `"murderer" | "innocents"`
- `/mafia/allRoles` — full role map written on game end for reveal

**Meeting flow:** 45s discussion → 30s voting → 6s result. Server-synced via `startedAt`. Alphabetically-first alive player writes vote result; all clients react identically.

**Win conditions:**
- Murderer wins: alive murderers ≥ alive innocents (checked after every kill)
- Innocents win: murderer voted out

**Key constants:** `KILL_R=70px`, `RPT_R=100px`, `KILL_CD=25s`, `DISC=45s`, `VOTE=30s`, `RSLT=6s`.

---

### `mafia2.html` + `mafia2.js` — Mafia: Host-Run (Room 8)

Face-to-face version for in-person play. One device is the GM console; each player has their own device. Two files: `mafia2.html` (HTML + CSS, ~216 lines) and `mafia2.js` (game logic, ~410 lines).

**Two views from one URL:**
- `mafia2.html?host` → Host GM console (full visibility, controls all phases)
- `mafia2.html` → Player screen (role-gated, auto-joined via `localStorage.filoName`)

**Roles:** Murderer (1), Doctor (1), Investigator (1), Civilians (rest). Host selects players, shuffles roles, sees all assignments.

**Flow:** Host setup (select players, shuffle) → Night (special roles submit actions; host sees results) → Day (host announces, opens vote) → Vote (players tap a card; host resolves) → repeat until win.

**Firebase paths (all under `/mafia2/`):**
- `/mafia2/phase` — `"night" | "day" | "vote" | "ended"`
- `/mafia2/round` — number
- `/mafia2/roles/<name>` — `"murderer" | "doctor" | "investigator" | "civilian"`
- `/mafia2/alive/<name>` — bool
- `/mafia2/night/kill` · `/mafia2/night/save` · `/mafia2/night/inspect` — string (target name)
- `/mafia2/day/votes/<name>` — string (target name)
- `/mafia2/announcement` — string (host writes; all players display)
- `/mafia2/winner` — `"murderer" | "civilians"`
- `/mafia2/allRoles` — full role map written on game end for reveal

**Night resolution (host-side):** kill target + save target → if save === kill, no one dies; otherwise kill target dies. Investigator result shown only to host. Host edits and reads announcement aloud.

**Win conditions:**
- Murderer wins: alive murderers ≥ alive civilians
- Civilians win: murderer voted out

**Key fix:** Player selector uses `<div onclick>` not `<label><input>` — label+input caused double-toggle (browser fires onclick twice per tap).

---

### `pong.html` — Pickelbol (Rooms 5–6)

PeerJS-based 2-player Pong variant. Room via `?room=N` query param.

### `connect5.html` — Streytlima Connect 5 (Rooms 3–4)

PeerJS-based 2-player Connect 5. Room via `?room=N` query param.

### `tictactoe.html` — Solo/AI Tictactoe

Standalone: 2-player local or vs-AI (minimax). No Firebase or PeerJS.
