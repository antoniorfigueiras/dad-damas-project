// Bot opponent: negamax with alpha-beta pruning on top of the rules engine.
// level 1 = random legal move, 2 = looks 2 plies ahead, 3 = 4 plies, 4 = 6 plies
import { legalMoves, applyMove, COORDS } from './engine.js';

const DEPTH = { 1: 0, 2: 2, 3: 4, 4: 6 };
const WIN = 100000;

// Score from the point of view of `color`
function evaluate(state, color) {
  let score = 0;
  for (let s = 1; s <= 32; s++) {
    const p = state.board[s];
    if (!p) continue;
    const [r, c] = COORDS[s];
    let v;
    if (p === 'W' || p === 'B') v = 300;
    else v = 100 + 4 * (p === 'w' ? r : 7 - r);           // pawns are worth more as they advance
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 6;       // small bonus for the centre
    score += p.toLowerCase() === color ? v : -v;
  }
  return score;
}

function negamax(state, depth, alpha, beta, color, ply) {
  if (state.status === 'ended') {
    const w = state.result.winner;
    if (w === null) return 0;
    return w === color ? WIN - ply : -WIN + ply; // prefer faster wins, slower losses
  }
  if (depth === 0) return evaluate(state, color);

  let best = -Infinity;
  for (const move of legalMoves(state)) {
    const next = applyMove(state, move);
    const score = -negamax(next, depth - 1, -beta, -alpha, next.turn, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(state, level = 2) {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  const depth = DEPTH[level] ?? 2;
  if (depth === 0 || moves.length === 1) return moves[Math.floor(Math.random() * moves.length)];

  // captures first helps alpha-beta cut more
  moves.sort((a, b) => b.captured.length - a.captured.length);

  let best = [];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  for (const move of moves) {
    const next = applyMove(state, move);
    const score = -negamax(next, depth - 1, -Infinity, -alpha, next.turn, 1);
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move); // random among equally good moves, so games vary
    }
    if (score > alpha) alpha = score;
  }
  return best[Math.floor(Math.random() * best.length)];
}
