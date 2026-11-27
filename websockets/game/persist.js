// Comunicação do servidor WebSocket com a API Laravel.
// O servidor WebSocket nunca escreve diretamente na BD: quando termina um jogo
// entre dois utilizadores registados, envia o registo para POST /api/ws/games.
//
// Variáveis de ambiente (ex.: em deployment/kubernetes-ws.yml):
//   API_URL       http://laravel-app   (serviço interno Laravel no cluster)
//   WS_API_TOKEN  segredo partilhado com o Laravel (Bearer token)

const API_URL = process.env.API_URL;
const TOKEN = process.env.WS_API_TOKEN;

const END_REASON_MAP = {
  no_pieces: 'CaptureAll',
  blocked: 'Blocked',
  resign: 'Resignation',
  timeout: 'Timeout',
  forfeit: 'Forfeit',
  agreement: 'DrawAgreement',
  repetition: 'ThreefoldRepetition',
  twenty_moves: 'TwentyMoveRule',
  forcada: 'Forcada12Moves',
  insufficient: 'InsufficientMaterial',
};

function rhythmOf(timeControl) {
  if (!timeControl) return 'Classic';
  const effectiveMs = timeControl.base + 30 * (timeControl.increment ?? 0);
  if (effectiveMs < 7.5 * 60 * 1000) return 'Blitz';
  if (effectiveMs < 15 * 60 * 1000) return 'Rapid';
  return 'Classic';
}

function countPieces(board, color) {
  let count = 0;
  for (let sq = 1; sq <= 32; sq++) {
    if (board[sq] && board[sq].toLowerCase() === color) count++;
  }
  return count;
}

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
    console.error(`[persist] POST ${path} falhou:`, err.message);
    return { ok: false, error: err.message };
  }
}

const registeredUserId = (p) => (p && !p.guest && !p.bot ? p.id : null);

export function gameEnded(game) {
  if (game.mode === 'bot') return Promise.resolve({ ok: true, skipped: true });

  const player1Id = registeredUserId(game.players.w);
  const player2Id = registeredUserId(game.players.b);

  // Só persiste jogos entre dois utilizadores autenticados
  if (!player1Id || !player2Id) {
    return Promise.resolve({ ok: true, skipped: true });
  }

  const { state } = game;
  const winner = state.result.winner;
  const loser = winner ? (winner === 'w' ? 'b' : 'w') : null;
  const totalTime =
    game.startedAt && game.endedAt
      ? Number(((game.endedAt - game.startedAt) / 1000).toFixed(2))
      : null;

  return post('/ws/games', {
    type: rhythmOf(game.timeControl),
    opening_type: 'Free',
    player1_user_id: player1Id,
    player2_user_id: player2Id,
    is_draw: winner === null,
    winner_user_id: winner ? registeredUserId(game.players[winner]) : null,
    loser_user_id: loser ? registeredUserId(game.players[loser]) : null,
    status: 'Ended',
    end_reason: END_REASON_MAP[state.result.reason] ?? state.result.reason,
    began_at: game.startedAt ? new Date(game.startedAt).toISOString() : null,
    ended_at: game.endedAt ? new Date(game.endedAt).toISOString() : null,
    total_time: totalTime,
    player1_captures: 12 - countPieces(state.board, 'b'),
    player2_captures: 12 - countPieces(state.board, 'w'),
    total_moves: state.history.length,
    moves_notation: state.history,
    custom: {
      ws_game_id: game.id,
      mode: game.mode,
      time_control: game.timeControl,
    },
  });
}
