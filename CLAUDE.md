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

### `mafia2.html` + `mafia2.js` — Mafia: Host-Run (Room 8)

Face-to-face version for in-person play. One device is the GM console; each player has their own device. Two files: `mafia2.html` (HTML + CSS, ~293 lines) and `mafia2.js` (game logic, ~753 lines).

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
- `/mafia2/night/suspect/<name>` — string (civilian's death prediction for that round)
- `/mafia2/lastSave` — string (who the doctor saved last round; doctor cannot repeat)
- `/mafia2/day/votes/<name>` — string (target name, or `"defer"`)
- `/mafia2/announcement` — string (host writes; all players display)
- `/mafia2/winner` — `"murderer" | "civilians"`
- `/mafia2/allRoles` — full role map written on game end for reveal

**Night resolution (host-side):** kill target + save target → if save === kill, no one dies; otherwise kill target dies. Investigator result shown only to host. Host edits and reads announcement aloud. After resolution, save target is written to `/mafia2/lastSave`.

**Night UI (players):** All players — including special roles — see an identical generic `🌙 Night Action / Tap a player` screen. Role identity is only shown on the private 5-second reveal card at round start. Civilians see `Who do you think will die tonight?` and their prediction is visible to the host.

**Doctor constraint:** Cannot save the same player two rounds in a row. The previously saved player appears grayed out with "saved last round" on the doctor's action grid.

**Win conditions:**
- Murderer wins: alive murderers ≥ alive civilians (civs ≤ 1)
- Civilians win: murderer voted out

**Key fixes:**
- Player selector uses `<div onclick>` not `<label><input>` — label+input caused double-toggle (browser fires onclick twice per tap).
- Night action screen is role-neutral so no player can be identified as a special role by observers.

---

### `pong.html` — Pickelbol (Rooms 5–6)

PeerJS-based 2-player Pong variant. Room via `?room=N` query param.

### `connect5.html` — Streytlima Connect 5 (Rooms 3–4)

PeerJS-based 2-player Connect 5. Room via `?room=N` query param.

### `tictactoe.html` — Solo/AI Tictactoe

Standalone: 2-player local or vs-AI (minimax). No Firebase or PeerJS.
