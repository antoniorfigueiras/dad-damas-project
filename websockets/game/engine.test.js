import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  createState,
  emptyBoard,
  squareAt as sq,
  legalMoves,
  play,
  RIO,
  canOfferDraw,
  resign,
} from './engine.js';

function position(pieces, turn = 'w') {
  const board = emptyBoard();
  for (const [r, c, p] of pieces) {
    const s = sq(r, c);
    if (!s) throw new Error(`Casa (${r},${c}) não é escura`);
    board[s] = p;
  }
  return createState(board, turn);
}

test('numeracao do tabuleiro e rio', () => {
  assert.equal(sq(0, 7), 1);
  assert.equal(sq(7, 0), 32);
  assert.equal(RIO.length, 8);
  assert.ok(RIO.includes(1) && RIO.includes(32));
});

test('posicao inicial com 12 pecas cada e 7 jogadas das brancas', () => {
  const s = initialState();
  assert.equal(s.board.filter((p) => p === 'w').length, 12);
  assert.equal(s.board.filter((p) => p === 'b').length, 12);
  assert.equal(s.turn, 'w');
  assert.equal(legalMoves(s).length, 7);
});

test('captura obrigatoria', () => {
  const s = position([[2, 1, 'w'], [3, 2, 'b'], [0, 1, 'w']]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].captured, [sq(3, 2)]);
});

test('peoes nao capturam para tras', () => {
  const s = position([[4, 3, 'w'], [3, 2, 'b']]);
  assert.ok(legalMoves(s).every((m) => m.captured.length === 0));
});

test('captura multipla de peao', () => {
  const s = position([[0, 1, 'w'], [1, 2, 'b'], [3, 4, 'b']]);
  const [m] = legalMoves(s);
  assert.deepEqual(m.path, [sq(2, 3), sq(4, 5)]);
  assert.equal(m.captured.length, 2);
  assert.equal(m.notation, `${sq(0, 1)}x${sq(2, 3)}x${sq(4, 5)}`);
});

test('lei da quantidade', () => {
  const s = position([
    [0, 1, 'w'], [1, 2, 'b'], [3, 4, 'b'],
    [2, 7, 'w'], [3, 6, 'B'],
  ]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from, sq(0, 1));
});

test('lei da qualidade', () => {
  const s = position([
    [0, 1, 'w'], [1, 2, 'b'],
    [0, 5, 'w'], [1, 6, 'B'],
  ]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from, sq(0, 5));
  assert.equal(moves[0].kingsCaptured, 1);
});

test('dama captura a distancia e pode parar em qualquer casa livre', () => {
  const s = position([[0, 1, 'W'], [3, 4, 'b']]);
  const moves = legalMoves(s);
  assert.equal(moves.length, 3);
  assert.deepEqual(
    moves.map((m) => m.to).sort((a, b) => a - b),
    [sq(4, 5), sq(5, 6), sq(6, 7)].sort((a, b) => a - b),
  );
});

test('dama nao salta pecas contiguas', () => {
  const s = position([[0, 1, 'W'], [3, 4, 'b'], [4, 5, 'b']]);
  assert.ok(legalMoves(s).every((m) => m.captured.length === 0));
});

test('dama pode mudar de direcao em captura multipla', () => {
  const s = position([[0, 1, 'W'], [2, 3, 'b'], [5, 2, 'b']]);
  const moves = legalMoves(s);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.captured.length === 2));
});

test('chegar a linha de base termina a captura e promove', () => {
  const s = position([[5, 2, 'w'], [6, 3, 'b'], [6, 5, 'b'], [0, 7, 'b']]);
  const [m] = legalMoves(s);
  assert.equal(m.captured.length, 1);
  assert.equal(m.promotes, true);
  const r = play(s, m.from, m.path);
  assert.equal(r.state.board[sq(7, 4)], 'W');
});

test('movimento simples para a linha de base promove', () => {
  const s = position([[6, 1, 'w'], [0, 7, 'b']]);
  const r = play(s, sq(6, 1), [sq(7, 2)]);
  assert.ok(r.ok);
  assert.equal(r.state.board[sq(7, 2)], 'W');
  assert.equal(r.state.turn, 'b');
});

test('jogadas ilegais sao rejeitadas', () => {
  const s = initialState();
  assert.equal(play(s, sq(2, 1), [sq(4, 3)]).ok, false);
  assert.equal(play(s, sq(5, 0), [sq(4, 1)]).ok, false);
});

test('jogador sem jogadas legais perde', () => {
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

test('capturar a ultima peca vence o jogo', () => {
  const s = position([[2, 1, 'w'], [3, 2, 'b']]);
  const r = play(s, sq(2, 1), [sq(4, 3)]);
  assert.deepEqual(r.state.result, { winner: 'w', reason: 'no_pieces' });
});

test('repeticao tripla da empate', () => {
  let s = position([[0, 1, 'W'], [0, 3, 'W'], [7, 6, 'B'], [7, 4, 'B']]);
  const cycle = [
    [sq(0, 1), sq(1, 0)], [sq(7, 6), sq(6, 7)],
    [sq(1, 0), sq(0, 1)], [sq(6, 7), sq(7, 6)],
  ];
  for (let i = 0; i < 2; i++) {
    for (const [from, to] of cycle) {
      const r = play(s, from, [to]);
      assert.ok(r.ok);
      s = r.state;
    }
  }
  assert.deepEqual(s.result, { winner: null, reason: 'repetition' });
});

test('desistencia da vitoria ao adversario', () => {
  const s = resign(initialState(), 'w');
  assert.deepEqual(s.result, { winner: 'b', reason: 'resign' });
});

test('proposta de empate so no final com 8 ou menos pecas e damas', () => {
  assert.equal(canOfferDraw(initialState()), false);
  assert.equal(canOfferDraw(position([[0, 1, 'W'], [7, 6, 'B'], [4, 3, 'w']])), true);
});
