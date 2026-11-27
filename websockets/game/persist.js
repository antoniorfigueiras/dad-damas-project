// Talks to the Laravel API. The WebSocket server never writes to the database
// itself: when a game starts or ends it tells Laravel, and Laravel handles
// the database, coins (entry fees, prizes) and rank.
//
// Configure with environment variables (e.g. in kubernetes-ws.yml):
//   API_URL       http://laravel-app           (the Laravel service inside the cluster)
//   WS_API_TOKEN  a secret shared with Laravel, sent as a Bearer token
//
// While these are not set, nothing is sent (handy while Laravel isn't ready).
// The Laravel routes below don't exist yet: create them on the API side.

const API_URL = process.env.API_URL;
const TOKEN = process.env.WS_API_TOKEN;

async function post(path, body) {
  if (!API_URL || !TOKEN) return { ok: true, skipped: true };
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error(`[persist] POST ${path} failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

const playerInfo = (p) => (p && !p.guest && !p.bot ? p.id : null);

// Before a ranked game starts: Laravel should check both balances and charge
// the entry fee. If it answers with an error, the game doesn't start.
export function gameStarting(game) {
  if (game.mode !== 'ranked') return Promise.resolve({ ok: true, skipped: true });
  return post('/ws/games/start', {
    ws_game_id: game.id,
    mode: game.mode,
    stake: game.stake,
    white_user_id: playerInfo(game.players.w),
    black_user_id: playerInfo(game.players.b),
  });
}

// When a game between two people ends (bot games are not saved).
export function gameEnded(game) {
  if (game.mode === 'bot') return Promise.resolve({ ok: true, skipped: true });
  const { state } = game;
  const winner = state.result.winner;
  return post('/ws/games/end', {
    ws_game_id: game.id,
    mode: game.mode,
    stake: game.stake,
    white_user_id: playerInfo(game.players.w),
    black_user_id: playerInfo(game.players.b),
    winner_user_id: winner ? playerInfo(game.players[winner]) : null,
    is_draw: winner === null,
    reason: state.result.reason,
    moves: state.history,              // e.g. ["10-14", "23-19", "14x23", ...]
    began_at: new Date(game.startedAt).toISOString(),
    ended_at: new Date(game.endedAt).toISOString(),
  });
}
