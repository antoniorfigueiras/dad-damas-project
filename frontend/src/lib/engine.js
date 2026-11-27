// =============================================================================
// Damas Portuguesas - rules engine
// Based on the "Regras Oficiais do Jogo de Damas Portuguesas" (FPD, 2026).
//
// Pure module: no Socket.IO, no Vue, no I/O. The SAME file is used by
//   - the WebSocket server (authority: validates every move)
//   - the Vue frontend (highlights legal moves, runs the bot)
// The state is a plain JSON object, so it can be sent over the socket as is.
//
// Board numbering (Art. 2.2): playable squares 1..32, starting on White's side,
// bottom-right corner. White starts on 1-12, Black on 21-32.
// White promotes on 29-32, Black on 1-4.
//
// Pieces: 'w' white pawn, 'W' white king, 'b' black pawn, 'B' black king.
// =============================================================================

// ---------- Board geometry ---------------------------------------------------
// row 0 = White's back row, row 7 = Black's back row.
// col 0 = White's left, col 7 = White's right.

export const SQUARE = Array.from({ length: 8 }, () => Array(8).fill(0)); // SQUARE[r][c] -> 1..32 (0 = light square)
export const COORDS = [null]; // COORDS[n] -> [r, c]

for (let r = 0; r < 8; r++) {
  let i = 0;
  for (let c = 7; c >= 0; c--) {
    if ((r + c) % 2 === 1) {
      const n = r * 4 + ++i;
      SQUARE[r][c] = n;
      COORDS[n] = [r, c];
    }
  }
}

// "Rio": the long dark diagonal (Art. 2.3), used by the "Forçada" rule
export const RIO = COORDS.slice(1).map(([r, c], i) => (r + c === 7 ? i + 1 : 0)).filter(Boolean);

const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function squareAt(r, c) {
  if (r < 0 || r > 7 || c < 0 || c > 7) return 0;
  return SQUARE[r][c];
}

function step(sq, dr, dc) {
  const [r, c] = COORDS[sq];
  return squareAt(r + dr, c + dc);
}

// ---------- Piece helpers ----------------------------------------------------

export const colorOf = (p) => (p ? p.toLowerCase() : null);
export const isKing = (p) => p === 'W' || p === 'B';
export const opponent = (color) => (color === 'w' ? 'b' : 'w');
const forward = (color) => (color === 'w' ? 1 : -1);
const promotionRow = (color) => (color === 'w' ? 7 : 0);
const isPromotionSquare = (sq, color) => COORDS[sq][0] === promotionRow(color);

function countPieces(board) {
  const n = { w: 0, b: 0, W: 0, B: 0 };
  for (let s = 1; s <= 32; s++) if (board[s]) n[board[s]]++;
  return {
    w: { pawns: n.w, kings: n.W, total: n.w + n.W },
    b: { pawns: n.b, kings: n.B, total: n.b + n.B },
  };
}

// ---------- State -------------------------------------------------------------

export function emptyBoard() {
  return Array(33).fill(null); // index 0 unused
}

export function initialState() {
  const board = emptyBoard();
  for (let s = 1; s <= 12; s++) board[s] = 'w';
  for (let s = 21; s <= 32; s++) board[s] = 'b';
  return createState(board, 'w');
}

// Build a state from any position (useful for tests, puzzles, the bot...)
export function createState(board, turn = 'w') {
  const state = {
    board: [...board],
    turn,                 // 'w' | 'b' - White moves first (Art. 6.3c)
    moveNumber: 1,        // full moves (increments after Black plays)
    history: [],          // notation of every move played
    positions: {},        // position key -> times seen (threefold repetition)
    quietPlies: 0,        // 20-move rule counter (plies, i.e. half-moves)
    forcada: null,        // { strong: 'w'|'b', moves: n } while the "Forçada" applies
    status: 'playing',    // 'playing' | 'ended'
    result: null,         // { winner: 'w'|'b'|null, reason }
  };
  state.positions[positionKey(state)] = 1;
  return state;
}

export function positionKey(state) {
  return state.board.slice(1).map((p) => p || '.').join('') + state.turn;
}

// ---------- Move generation --------------------------------------------------
// A move: { from, to, path: [landing squares...], captured: [squares...],
//           kingsCaptured, promotes, notation }

function makeMove(board, from, path, captured) {
  const piece = board[from];
  const to = path[path.length - 1];
  return {
    from,
    to,
    path,
    captured,
    kingsCaptured: captured.filter((s) => isKing(board[s])).length,
    promotes: !isKing(piece) && isPromotionSquare(to, colorOf(piece)),
    notation: captured.length ? [from, ...path].join('x') : `${from}-${to}`,
  };
}

// Pawn captures: forward only, adjacent piece, land right behind it (Art. 3.4).
// Reaching the opponent's back row ends the move (Art. 3.1e).
function pawnCaptures(board, color, sq, captured, path, out, from) {
  if (path.length && isPromotionSquare(sq, color)) {
    out.push({ from, path, captured });
    return;
  }
  let extended = false;
  const f = forward(color);
  for (const dc of [1, -1]) {
    const mid = step(sq, f, dc);
    if (!mid) continue;
    const land = step(mid, f, dc);
    if (!land) continue;
    const target = board[mid];
    if (target && colorOf(target) !== color && !captured.includes(mid) && board[land] === null) {
      extended = true;
      pawnCaptures(board, color, land, [...captured, mid], [...path, land], out, from);
    }
  }
  if (!extended && captured.length) out.push({ from, path, captured });
}

// King captures: any distance, land on any empty square past the piece,
// may change direction, can't jump the same piece twice (Art. 3.5, 3.6).
// Captured pieces stay on the board until the move ends (Art. 3.8),
// so they still block the way.
function kingCaptures(board, color, sq, captured, path, out, from) {
  let extended = false;
  for (const [dr, dc] of DIRS) {
    let s = step(sq, dr, dc);
    while (s && board[s] === null) s = step(s, dr, dc);
    if (!s) continue;
    const target = board[s];
    if (colorOf(target) === color || captured.includes(s)) continue;
    let land = step(s, dr, dc);
    while (land && board[land] === null) {
      extended = true;
      kingCaptures(board, color, land, [...captured, s], [...path, land], out, from);
      land = step(land, dr, dc);
    }
  }
  if (!extended && captured.length) out.push({ from, path, captured });
}

function capturesFrom(board, from) {
  const piece = board[from];
  const color = colorOf(piece);
  const work = [...board];
  work[from] = null; // the moving piece leaves its square (it may pass through it again)
  const raw = [];
  if (isKing(piece)) kingCaptures(work, color, from, [], [], raw, from);
  else pawnCaptures(work, color, from, [], [], raw, from);
  return raw.map((m) => makeMove(board, m.from, m.path, m.captured));
}

function simpleMovesFrom(board, from) {
  const piece = board[from];
  const color = colorOf(piece);
  const moves = [];
  if (isKing(piece)) {
    for (const [dr, dc] of DIRS) {
      let s = step(from, dr, dc);
      while (s && board[s] === null) {
        moves.push(makeMove(board, from, [s], []));
        s = step(s, dr, dc);
      }
    }
  } else {
    for (const dc of [1, -1]) {
      const s = step(from, forward(color), dc);
      if (s && board[s] === null) moves.push(makeMove(board, from, [s], []));
    }
  }
  return moves;
}

// All legal moves for the player to move.
// Capture is mandatory (Art. 3.3), quantity rule then quality rule (Art. 3.7).
export function legalMoves(state) {
  if (state.status !== 'playing') return [];
  const { board, turn } = state;
  let captures = [];
  for (let s = 1; s <= 32; s++) {
    if (board[s] && colorOf(board[s]) === turn) captures.push(...capturesFrom(board, s));
  }

  if (captures.length) {
    const most = Math.max(...captures.map((m) => m.captured.length));
    captures = captures.filter((m) => m.captured.length === most);
    const bestQuality = Math.max(...captures.map((m) => m.kingsCaptured));
    captures = captures.filter((m) => m.kingsCaptured === bestQuality);
    // remove duplicates (same piece, same route)
    const seen = new Set();
    return captures.filter((m) => {
      const key = m.notation + '|' + m.captured.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const moves = [];
  for (let s = 1; s <= 32; s++) {
    if (board[s] && colorOf(board[s]) === turn) moves.push(...simpleMovesFrom(board, s));
  }
  return moves;
}

// Legal moves of one piece (for highlighting in the UI)
export function legalMovesFrom(state, from) {
  return legalMoves(state).filter((m) => m.from === from);
}

// Find the legal move matching what the client sent.
// `path` can be the full list of landing squares, or just [to] when that's unique.
export function findMove(state, from, path) {
  const target = Array.isArray(path) ? path : [path];
  const candidates = legalMoves(state).filter((m) => m.from === from);
  const exact = candidates.find(
    (m) => m.path.length === target.length && m.path.every((s, i) => s === target[i]),
  );
  if (exact) return exact;
  if (target.length === 1) {
    const byDest = candidates.filter((m) => m.to === target[0]);
    if (byDest.length === 1) return byDest[0];
  }
  return null;
}

// ---------- Applying moves ----------------------------------------------------

// Validates and plays a move. Returns { ok, state, move } or { ok: false, error }.
export function play(state, from, path) {
  if (state.status !== 'playing') return { ok: false, error: 'Game is over' };
  const move = findMove(state, from, path);
  if (!move) return { ok: false, error: 'Illegal move' };
  return { ok: true, move, state: applyMove(state, move) };
}

// Plays a move that is already known to be legal (from legalMoves). Returns a NEW state.
export function applyMove(state, move) {
  const board = [...state.board];
  const mover = state.turn;
  const piece = board[move.from];
  const wasPawnMove = !isKing(piece);

  board[move.from] = null;
  for (const s of move.captured) board[s] = null; // removed only at the end (Art. 3.8)
  board[move.to] = move.promotes ? piece.toUpperCase() : piece;

  const next = {
    ...state,
    board,
    turn: opponent(mover),
    moveNumber: mover === 'b' ? state.moveNumber + 1 : state.moveNumber,
    history: [...state.history, move.notation],
    positions: { ...state.positions },
    lastMove: { from: move.from, to: move.to, path: move.path, captured: move.captured },
  };

  // Any capture or pawn move makes old positions impossible to repeat
  if (move.captured.length || wasPawnMove) next.positions = {};
  const key = positionKey(next);
  next.positions[key] = (next.positions[key] || 0) + 1;

  updateCounters(next, mover, move, wasPawnMove);
  evaluate(next, mover);
  return next;
}

// "Forçada" and 20-move rule counters (Art. 3.9)
function updateCounters(state, mover, move, wasPawnMove) {
  const n = countPieces(state.board);

  // --- Forçada: 3 kings (only) vs 1 lone king; must win within 12 moves
  //     once one of the 3 kings holds the "Rio".
  let strong = null;
  for (const c of ['w', 'b']) {
    const o = opponent(c);
    if (n[c].kings === 3 && n[c].pawns === 0 && n[o].kings === 1 && n[o].pawns === 0) strong = c;
  }
  if (!strong) {
    state.forcada = null;
  } else if (!state.forcada || state.forcada.strong !== strong) {
    const onRio = RIO.some((s) => state.board[s] === strong.toUpperCase());
    // the move that occupies the Rio is not counted (Art. 3.9a(3))
    state.forcada = onRio ? { strong, moves: 0 } : null;
  } else if (mover === strong) {
    state.forcada = { strong, moves: state.forcada.moves + 1 };
  }

  // --- 20-move rule: max 4 pieces each side, at least 1 king on both sides.
  //     Not applied during the Forçada (Art. 3.9b(4)).
  const endgame = n.w.total <= 4 && n.b.total <= 4 && n.w.kings >= 1 && n.b.kings >= 1;
  if (!endgame || strong) state.quietPlies = 0;
  else if (move.captured.length || wasPawnMove) state.quietPlies = 0; // the endgame changed
  else state.quietPlies += 1;
}

// Checks whether the game ended after `mover` played.
function evaluate(state, mover) {
  const n = countPieces(state.board);
  const side = state.turn;

  if (n[side].total === 0) return end(state, mover, 'no_pieces');
  if (legalMoves(state).length === 0) return end(state, mover, 'blocked');

  if (state.positions[positionKey(state)] >= 3) return end(state, null, 'repetition');
  if (state.forcada && state.forcada.moves >= 12) return end(state, null, 'forcada');
  if (state.quietPlies >= 40) return end(state, null, 'twenty_moves'); // 20 moves for each colour
  if (n.w.total === 1 && n.b.total === 1 && n.w.kings === 1 && n.b.kings === 1) {
    return end(state, null, 'insufficient'); // lone king vs lone king: nobody can win
  }
}

function end(state, winner, reason) {
  state.status = 'ended';
  state.result = { winner, reason };
  return state;
}

// ---------- Ending the game from outside the board ---------------------------

export function resign(state, color) {
  if (state.status !== 'playing') return state;
  return end({ ...state }, opponent(color), 'resign');
}

export function timeout(state, color) {
  if (state.status !== 'playing') return state;
  return end({ ...state }, opponent(color), 'timeout');
}

export function forfeit(state, color) {
  if (state.status !== 'playing') return state;
  return end({ ...state }, opponent(color), 'forfeit');
}

export function agreeDraw(state) {
  if (state.status !== 'playing') return state;
  return end({ ...state }, null, 'agreement');
}

// Draw offers (Art. 9.6, "Rapid"/"Blitz"): only with 8 pieces or fewer in total
// and at least one king on each side. Relax this if your platform prefers.
export function canOfferDraw(state) {
  if (state.status !== 'playing') return false;
  const n = countPieces(state.board);
  return n.w.total + n.b.total <= 8 && n.w.kings >= 1 && n.b.kings >= 1;
}

// ---------- Misc helpers ------------------------------------------------------

export function pieceCount(state) {
  return countPieces(state.board);
}

// ASCII board for debugging: console.log(toAscii(state))
export function toAscii(state) {
  const lines = [];
  for (let r = 7; r >= 0; r--) {
    let line = `${r + 1} `;
    for (let c = 0; c < 8; c++) {
      const s = SQUARE[r][c];
      line += s ? ` ${state.board[s] || '.'} ` : '   ';
    }
    lines.push(line);
  }
  lines.push('   a  b  c  d  e  f  g  h');
  return lines.join('\n');
}
