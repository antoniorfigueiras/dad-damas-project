# Game events (WebSocket server)

All client → server events accept a callback with `{ ok: true, ... }` or `{ ok: false, error }`:

```js
socket.emit('game:move', { gameId, from: 22, path: [18] }, (res) => {
  if (!res.ok) toast.error(res.error)
})
```

## Identity
| Event | Payload | Notes |
|---|---|---|
| `login` | `{ id, name }` | existing event; also puts the player back into any game in progress |
| `game:guest` | `{ guestId, name? }` | anonymous users; keep `guestId` in localStorage so a refresh gets you back into your game |

## Client → server
| Event | Payload |
|---|---|
| `game:lobby` | – (joins the lobby, receives `game:lobby`) |
| `game:lobby-leave` | – |
| `game:create` | `{ mode: 'casual'\|'ranked'\|'bot', color: 'w'\|'b'\|'random', isPublic, stake, timeControl: { base, increment } \| null, botLevel: 1-4 }` → ack `{ gameId, color }` |
| `game:join` | `{ gameId }` → ack `{ gameId, color }` |
| `game:cancel` | `{ gameId }` (creator, before someone joins) |
| `game:spectate` / `game:spectate-leave` | `{ gameId }` (anyone, public games only) |
| `game:get` | `{ gameId }` → ack `{ game }` (same object as `game:state`) |
| `game:move` | `{ gameId, from, path }` – `path` = landing squares, e.g. `[18]` or `[18, 9]` |
| `game:resign` | `{ gameId }` |
| `game:draw-offer` | `{ gameId }` (only with ≤ 8 pieces and a king on each side) |
| `game:draw-answer` | `{ gameId, accept: true\|false }` |

## Server → client
| Event | Payload |
|---|---|
| `game:lobby` | list of open/public games (summary) |
| `game:state` | `{ id, mode, status, players: { w, b }, board, turn, history, lastMove, legalMoves, clocks: { w, b }, serverTime, drawOffer, canOfferDraw, result, spectators, ... }` |
| `game:ended` | `{ gameId, result: { winner: 'w'\|'b'\|null, reason } }` |
| `game:player-away` | `{ gameId, color, graceMs }` – opponent disconnected, forfeits after `graceMs` |
| `game:player-back` | `{ gameId, color }` |
| `game:cancelled` | `{ gameId }` |
| `game:error` | `{ gameId, error }` |

`status`: `waiting` → `starting` → `playing` → `ended`.
`reason`: `no_pieces`, `blocked`, `resign`, `timeout`, `forfeit`, `agreement`, `repetition`, `twenty_moves`, `forcada`, `insufficient`.

## Board
`board[1..32]`: `null`, `'w'`, `'W'` (white king), `'b'`, `'B'`. Square 1 = White's bottom-right.
Use `squareAt(r, c)` / `COORDS[n]` from `src/lib/engine.js` to draw it.
To highlight moves, filter `legalMoves` by `from`; for a multi-capture, send the whole `path`.

## Clock
`clocks` = ms left at `serverTime`. On the client: `left = clocks[turn] - (Date.now() - serverTime)` for the side to move.

## Laravel (game/persist.js)
Set `API_URL` and `WS_API_TOKEN` in the WS deployment to enable it. It posts to:
- `POST /api/ws/games/start` before a ranked game (charge the entry fee; an error stops the game)
- `POST /api/ws/games/end` when a game between two people ends (save the game, pay prizes, update rank)
