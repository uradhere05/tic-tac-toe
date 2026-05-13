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

**Leaderboard:** Weekly board with win bars, silver/bronze rank highlights, animated count rollup, and a "you" badge on the current player's row. `fetchOnlineNames()` auto-purges stale/malformed Firebase entries on every poll. `clearMyRoomPresence()` is called on lobby entry to remove ghost "waiting" status left over from other game pages.

**Encoding:** Online presence keys use `encodeURIComponent(name)` — spaces stored as spaces in Firebase. Never use underscore encoding (`name.replace(/\s/g,'_')`) — this created duplicate keys in the past.

**`WINS_NEED = 2`** — best of 3 (first to 2 game wins). Online presence stale after 75s (`ONLINE_STALE`); room presence stale after 30s (`STALE_MS`).

---

### `mafia2.html` + `mafia2.js` — Mafia: Host-Run (Room 8)

Face-to-face version for in-person play. One device is the GM console; each player has their own device.

**Login guard:** Direct access without a saved `localStorage.filoName` redirects to `index.html`. The old inline name-picker (`s-join`) has been removed.

**Two views from one URL:**
- `mafia2.html?host` → Host GM console (full visibility, controls all phases)
- `mafia2.html` → Player screen (role-gated, auto-joined via `localStorage.filoName`)

**Roles:** Murderer (1), Doctor (1), Investigator (1), Civilians (rest). GM manually assigns roles from the assign screen.

**Flow:** Role select → Lobby (ready up) → GM assigns roles → Night → Day → Vote → repeat until win.

**Reconnect recovery:** `init()` calls `checkActiveGame()` which checks Firebase on load. If the player is already in a live game, they skip role-select and jump directly to the correct phase screen. Role, action, and vote state are all restored from Firebase.

**Firebase paths (all under `/mafia2/`):**
- `/mafia2/phase` — `"assigning" | "night" | "day" | "vote" | "ended"`
- `/mafia2/round` — number
- `/mafia2/host` — string (GM's name)
- `/mafia2/roles/<name>` — `"murderer" | "doctor" | "investigator" | "civilian"`
- `/mafia2/alive/<name>` — bool
- `/mafia2/night/kill` · `/mafia2/night/save` · `/mafia2/night/inspect` — string (target name)
- `/mafia2/night/suspect/<name>` — string (civilian's death prediction for that round)
- `/mafia2/lastSave` — string (who the doctor saved last round; doctor cannot repeat)
- `/mafia2/day/votes/<name>` — string (target name, or `"defer"`)
- `/mafia2/announcement` — string (host writes; all players display)
- `/mafia2/winner` — `"murderer" | "civilians"`
- `/mafia2/allRoles` — full role map written on game end for reveal
- `/mafia2/history/r<N>` — `{killed, saved, eliminated}` per-round recap data
- `/mafia2/lobby/<name>` — `{name, ts, ready, avatar}` lobby presence

**Night resolution:** kill target + save target → if save === kill, no one dies; otherwise kill target dies. Round history written to `/mafia2/history/rN`. Save target written to `/mafia2/lastSave`.

**Night UI (players):** Identical generic screen for all roles — role identity only shown on the private 5-second reveal card at round start. Civilians see "Who do you think will die tonight?".

**Doctor constraint:** Cannot save the same player two rounds in a row.

**Win conditions:**
- Murderer wins: alive civilians ≤ 1
- Civilians win: murderer voted out

**Post-game recap:** `buildRecapHtml()` fetches `/mafia2/history` and `/mafia2/allRoles` and renders a round-by-round timeline plus full role reveal. Shown to all players (host and players) at game end.

**Leaderboard integration:** `endGame()` calls `recordWin()` for each winner. Civilians win → all non-murderer players +1. Murderer wins → murderer +1. Uses same `/leaderboard/<YYYY-MM-DD>/<name>` path as other games.

**Key implementation notes:**
- Player selector uses `<div onclick>` not `<label><input>` — label+input caused double-toggle.
- Night action screen is role-neutral so observers cannot identify special roles.
- `beforeunload` deletes `/online/<name>` and `/mafia2/lobby/<name>` on exit.

---

### `pong.html` — Pickelbol (Rooms 5–6)

PeerJS-based 2-player Pong variant. Room via `?room=N` query param. First to `WINS_NEED = 5` wins.

**Login guard:** Redirects to `index.html` if no `localStorage.filoName`.

**Rematch:** Champion screen shows `🔄 Rematch`. Two-click handshake: first click sends `rematch-req` and shows "Waiting for opponent…" toast; game only resets when both players click (`rematch-ok` completes the handshake).

---

### `connect5.html` — Streytlima Connect 5 (Rooms 3–4)

PeerJS-based 2-player Connect 5. Room via `?room=N` query param.

**Login guard:** Redirects to `index.html` if no `localStorage.filoName`.

**Rematch:** Champion screen shows `🔄 Rematch`. Uses the `requestRestart()` two-click handshake.

---

### `tictactoe.html` — Solo/AI Tictactoe

Standalone: 2-player local or vs-AI (minimax). No Firebase or PeerJS. No login guard needed.
