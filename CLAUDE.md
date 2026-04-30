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

## Running the game

No build step or server required — open `index.html` directly in a browser:

```
open index.html
```

## Architecture

The project is two standalone single-file HTML games:

- **`index.html`** — FILO Gang Tictactoe: the main multiplayer game, exclusive to a fixed friend group.
- **`tictactoe.html`** — Solo/AI Tictactoe: a simpler version with 2-player local and vs-AI (minimax) modes.

### `index.html` — how it fits together

**External dependencies (CDN only):**
- `peerjs@1.5.2` — WebRTC peer-to-peer connections for real-time gameplay
- Firebase Realtime Database (REST API, no SDK) — presence, room state, leaderboard

**Flow:** Name screen → Lobby (pick room) → Waiting screen → Game → Champion screen

**PeerJS room model:** Rooms 1–5 use fixed peer IDs (`filo-gang-room-N`). The first player to claim the ID becomes the host (X); the second player joins as guest (O). If the fixed ID is already taken, `peer.on('error', 'unavailable-id')` fires and the client falls back to `joinRoomN()`.

**Firebase paths used:**
- `/online/<name>` — heartbeat presence (written every 30s, deleted on `beforeunload`)
- `/rooms/room-N/host` and `/rooms/room-N/guest` — who is in each room and whether a game is active
- `/leaderboard/<week-key>/<name>` — weekly win counts, keyed by Monday date (YYYY-MM-DD)

**Leaderboard timezone fix:** The loader fetches the entire `/leaderboard.json` tree and merges wins from any key within ±1 day of the current week's Monday–Sunday range. This handles data that was written under wrong UTC-offset keys.

**`WINS_NEED = 2`** — best of 3 series (first to 2 game wins).

**Presence stale threshold:** Online heartbeats expire after 75s (`ONLINE_STALE`); room presence expires after 8 minutes (`STALE_MS`).

**Fixed player names:** Kuya AD, Matt, Gianne, Austin, Charm, Kee, Kriselle, Monique, Tiff, Shantelle — hardcoded in the HTML, no registration.
