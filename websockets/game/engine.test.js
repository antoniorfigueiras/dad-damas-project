// Run with:  node --test game/
// (uses Node's built-in test runner, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, createState, emptyBoard, squareAt as sq, legalMoves, play,
  RIO, canOfferDraw, resign,
} from './engine.js';

// place pieces by [row, col] (row 0 = White's back row) -> state
function position(pieces, turn = 'w') {
  const board = emptyBoard();
  for (const [r, c, p] of pieces) {
    const s = sq(r, c);
    if (!s) throw new Error(`(${r},${c}) is not a dark square`);
    board[s] = p;
  }
  return createState(board, turn);
}

test('board numbering follows Art. 2.2', () => {
  assert.equal(sq(0, 7), 1);   // White's bottom-right corner is square 1
  assert.equal(sq(7, 0), 32);
  assert.equal(RIO.length, 8);
  assert.ok(RIO.includes(1) && RIO.includes(32));
});

test('initial position: 12 pieces each, White has 7 moves', () => {
  const s = initialState();
  assert.equal(s.board.filter((p) => p === 'w').length, 12);
  assert.equal(s.board.filter((p) => p === 'b').length, 12);
  assert.equal(s.turn, 'w');
  assert.equal(legalMoves(s).length, 7);
});

test('capture is mandatory', () => {
  const s = position([[2, 1, 'w'], [3, 2, 'b'], [0, 1, 'w']]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].captured, [sq(3, 2)]);
});

test('pawns do not capture backwards', () => {
  const s = position([[4, 3, 'w'], [3, 2, 'b']]);
  assert.ok(legalMoves(s).every((m) => m.captured.length === 0));
});

test('pawn multi-capture continues in the same move', () => {
  const s = position([[0, 1, 'w'], [1, 2, 'b'], [3, 4, 'b']]);
  const [m] = legalMoves(s);
  assert.deepEqual(m.path, [sq(2, 3), sq(4, 5)]);
  assert.equal(m.captured.length, 2);
  assert.equal(m.notation, `${sq(0, 1)}x${sq(2, 3)}x${sq(4, 5)}`);
});

test('quantity rule: capturing 2 pawns beats capturing 1 king', () => {
  const s = position([
    [0, 1, 'w'], [1, 2, 'b'], [3, 4, 'b'],   // A: takes 2 pawns
    [2, 7, 'w'], [3, 6, 'B'],                // B: takes 1 king
  ]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from, sq(0, 1));
});

test('quality rule: with equal quantity, the king must be taken', () => {
  const s = position([
    [0, 1, 'w'], [1, 2, 'b'],   // takes a pawn
    [0, 5, 'w'], [1, 6, 'B'],   // takes a king
  ]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from, sq(0, 5));
  assert.equal(moves[0].kingsCaptured, 1);
});

test('king captures from a distance and can land on any free square beyond', () => {
  const s = position([[0, 1, 'W'], [3, 4, 'b']]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 3);
  assert.deepEqual(moves.map((m) => m.to).sort((a, b) => a - b),
    [sq(4, 5), sq(5, 6), sq(6, 7)].sort((a, b) => a - b));
});

test('king cannot jump two pieces next to each other (Art. 3.5b)', () => {
  const s = position([[0, 1, 'W'], [3, 4, 'b'], [4, 5, 'b']]);
  assert.ok(legalMoves(s).every((m) => m.captured.length === 0));
});

test('king multi-capture can change direction', () => {
  const s = position([[0, 1, 'W'], [2, 3, 'b'], [5, 2, 'b']]);
  const moves = legalMoves(s);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.captured.length === 2));
});

test('reaching the back row ends the capture and promotes (Art. 3.1e)', () => {
  const s = position([[5, 2, 'w'], [6, 3, 'b'], [6, 5, 'b'], [0, 7, 'b']]);
  const [m] = legalMoves(s);
  assert.equal(m.captured.length, 1);
  assert.equal(m.promotes, true);
  const r = play(s, m.from, m.path);
  assert.equal(r.state.board[sq(7, 4)], 'W');
});

test('simple move to the back row promotes', () => {
  const s = position([[6, 1, 'w'], [0, 7, 'b']]);
  const r = play(s, sq(6, 1), [sq(7, 2)]);
  assert.ok(r.ok);
  assert.equal(r.state.board[sq(7, 2)], 'W');
  assert.equal(r.state.turn, 'b');
});

test('illegal moves are rejected', () => {
  const s = initialState();
  assert.equal(play(s, sq(2, 1), [sq(4, 3)]).ok, false); // two squares
  assert.equal(play(s, sq(5, 0), [sq(4, 1)]).ok, false); // not your piece
});

test('a player who cannot move loses', () => {
  const s = position([
    [6, 1, 'w'],
    [7, 0, 'B'], [7, 2, 'B'], [5, 0, 'B'], [5, 2, 'B'],
    [0, 7, 'B'],
  ], 'b');
  const r = play(s, sq(0, 7), [sq(1, 6)]);
  assert.ok(r.ok);
  assert.equal(r.state.status, 'ended');
  assert.deepEqual(r.state.result, { winner: 'b', reason: 'blocked' });
});

test('capturing the last piece wins', () => {
  const s = position([[2, 1, 'w'], [3, 2, 'b']]);
  const r = play(s, sq(2, 1), [sq(4, 3)]);
  assert.deepEqual(r.state.result, { winner: 'w', reason: 'no_pieces' });
});

test('threefold repetition is a draw', () => {
  let s = position([[0, 1, 'W'], [0, 3, 'W'], [7, 6, 'B'], [7, 4, 'B']]);
  const cycle = [
    [sq(0, 1), sq(1, 0)], [sq(7, 6), sq(6, 7)],
    [sq(1, 0), sq(0, 1)], [sq(6, 7), sq(7, 6)],
  ];
  for (let i = 0; i < 2; i++) {
    for (const [from, to] of cycle) {
      const r = play(s, from, [to]);
      assert.ok(r.ok, `move ${from}-${to}`);
      s = r.state;
    }
  }
  assert.deepEqual(s.result, { winner: null, reason: 'repetition' });
});

test('resign gives the win to the opponent', () => {
  const s = resign(initialState(), 'w');
  assert.deepEqual(s.result, { winner: 'b', reason: 'resign' });
});

test('draw offers only in the endgame (Art. 9.6)', () => {
  assert.equal(canOfferDraw(initialState()), false);
  assert.equal(canOfferDraw(position([[0, 1, 'W'], [7, 6, 'B'], [4, 3, 'w']])), true);
});
