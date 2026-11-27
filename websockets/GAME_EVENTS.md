# Eventos de Jogo (Servidor WebSocket)

Todos os eventos cliente → servidor aceitam callback com `{ ok: true, ... }` ou `{ ok: false, error }`:

```js
socket.emit('game:move', { gameId, from: 10, path: [14] }, (res) => {
  if (!res.ok) console.error(res.error)
})
```

## Identidade
| Evento | Payload | Notas |
|---|---|---|
| `login` | `{ id, name }` | evento existente; reconecta o jogador aos seus jogos em curso |
| `game:guest` | `{ guestId, name? }` | jogadores convidados (anónimos); `guestId` guardado em `localStorage` |

## Cliente → Servidor
| Evento | Payload |
|---|---|
| `game:lobby` | – (entra na sala do lobby e recebe `game:lobby`) |
| `game:lobby-leave` | – |
| `game:create` | `{ mode: 'casual'\|'ranked'\|'bot', color: 'w'\|'b'\|'random', isPublic, timeControl: { base, increment } \| null, botLevel: 1-4 }` → ack `{ gameId, color }` |
| `game:join` | `{ gameId }` → ack `{ gameId, color }` |
| `game:cancel` | `{ gameId }` (criador, antes de alguém entrar) |
| `game:spectate` / `game:spectate-leave` | `{ gameId }` (jogos públicos) |
| `game:get` | `{ gameId }` → ack `{ game }` |
| `game:move` | `{ gameId, from, path }` – `path` = casas de destino, ex.: `[14]` ou `[18, 9]` |
| `game:resign` | `{ gameId }` |
| `game:draw-offer` | `{ gameId }` (com ≤ 8 peças e pelo menos uma dama em cada lado) |
| `game:draw-answer` | `{ gameId, accept: true\|false }` |

## Servidor → Cliente
| Evento | Payload |
|---|---|
| `game:lobby` | lista de jogos abertos e em curso (públicos) |
| `game:state` | `{ id, mode, status, players: { w, b }, board, turn, history, lastMove, legalMoves, clocks: { w, b }, serverTime, drawOffer, canOfferDraw, result, spectators, ... }` |
| `game:ended` | `{ gameId, result: { winner: 'w'\|'b'\|null, reason } }` |
| `game:player-away` | `{ gameId, color, graceMs }` |
| `game:player-back` | `{ gameId, color }` |
| `game:cancelled` | `{ gameId }` |
| `game:error` | `{ gameId, error }` |

## Persistência na API Laravel (`game/persist.js`)
Configurar `API_URL` e `WS_API_TOKEN` no ambiente do servidor WebSocket (e `WS_API_TOKEN` no `.env` do Laravel).
Quando um jogo entre dois utilizadores registados termina, o servidor WS envia:
- `POST /api/ws/games` (autenticado com `Authorization: Bearer <WS_API_TOKEN>`), mapeado diretamente para a tabela `games`.
