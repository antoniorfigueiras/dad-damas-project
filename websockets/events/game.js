// =============================================================================
// Eventos de jogo: lobby, criar / entrar / assistir, lances, relógio, empate,
// desistência, desconexões e bot.
//
// O servidor é autoritativo: os clientes apenas enviam intenções, cada lance é
// validado pelo motor de regras FPD e o relógio corre aqui.
// =============================================================================
import { getUser } from '../state/connection.js';
import { createGame, getGame, allGames, gamesOfPlayer, scheduleCleanup, removeGame } from '../state/games.js';
import { initialState, play, applyMove, legalMoves, resign, timeout, forfeit, agreeDraw, canOfferDraw, opponent } from '../game/engine.js';
import { chooseMove } from '../game/bot.js';
import { gameEnded } from '../game/persist.js';

const LOBBY_ROOM = 'lobby';
const DISCONNECT_GRACE_MS = 60 * 1000;
const BOT_DELAY_MS = 600;
const DEFAULT_TIME = { base: 5 * 60 * 1000, increment: 3 * 1000 };
const MODES = ['casual', 'ranked', 'bot'];

const ENGINE_ERRORS_PT = {
  'Game is already over': 'O jogo já terminou.',
  'Illegal move': 'Jogada ilegal.',
};

export const gameRoom = (id) => `game:${id}`;

function identity(socket) {
  const user = getUser(socket.id);
  if (user) return { key: `u:${user.id}`, id: user.id, name: user.name, guest: false };
  const g = socket.data.guest;
  if (g) return { key: `g:${g.id}`, id: null, name: g.name, guest: true };
  return null;
}

const colorOf = (game, key) =>
  game.players.w?.key === key ? 'w' : game.players.b?.key === key ? 'b' : null;

function publicPlayer(p) {
  if (!p) return null;
  return { id: p.id, name: p.name, guest: !!p.guest, bot: !!p.bot, connected: p.bot || p.sockets.size > 0 };
}

function summary(game) {
  return {
    id: game.id,
    mode: game.mode,
    status: game.status,
    isPublic: game.isPublic,
    timeControl: game.timeControl,
    players: { w: publicPlayer(game.players.w), b: publicPlayer(game.players.b) },
    spectators: game.spectators.size,
    createdAt: game.createdAt,
  };
}

function view(game) {
  const s = game.state;
  return {
    ...summary(game),
    board: s.board,
    turn: s.turn,
    moveNumber: s.moveNumber,
    history: s.history,
    lastMove: s.lastMove ?? null,
    result: s.result,
    legalMoves: game.status === 'playing'
      ? legalMoves(s).map(({ from, to, path, captured, notation }) => ({ from, to, path, captured, notation }))
      : [],
    clocks: currentClocks(game),
    serverTime: Date.now(),
    drawOffer: game.drawOffer,
    canOfferDraw: game.status === 'playing' && canOfferDraw(s),
  };
}

let io = null;

function broadcastLobby() {
  const list = allGames()
    .filter((g) => g.status !== 'ended' && g.mode !== 'bot' && (g.isPublic || g.status === 'waiting'))
    .map(summary);
  io.to(LOBBY_ROOM).emit('game:lobby', list);
}

function broadcastState(game) {
  io.to(gameRoom(game.id)).emit('game:state', view(game));
}

function currentClocks(game) {
  if (!game.clocks) return null;
  const clocks = { ...game.clocks };
  if (game.status === 'playing') clocks[game.state.turn] -= Date.now() - game.turnStartedAt;
  return { w: Math.max(0, clocks.w), b: Math.max(0, clocks.b) };
}

function startTurnTimer(game) {
  clearTimeout(game.flagTimer);
  if (!game.clocks || game.status !== 'playing') return;
  const side = game.state.turn;
  game.flagTimer = setTimeout(() => {
    const left = currentClocks(game)[side];
    if (left <= 0) finish(game, timeout(game.state, side));
    else startTurnTimer(game);
  }, game.clocks[side] + 50);
}

function chargeClock(game, mover) {
  if (!game.clocks) return true;
  const used = Date.now() - game.turnStartedAt;
  game.clocks[mover] -= used;
  if (game.clocks[mover] <= 0) return false;
  game.clocks[mover] += game.timeControl.increment;
  return true;
}

function startGame(game) {
  game.status = 'playing';
  game.startedAt = Date.now();
  game.turnStartedAt = Date.now();
  startTurnTimer(game);
  broadcastState(game);
  broadcastLobby();
  maybeBotMove(game);
}

function finish(game, endedState) {
  if (game.status === 'ended') return;
  clearTimeout(game.flagTimer);
  for (const c of ['w', 'b']) clearTimeout(game.players[c]?.leaveTimer);
  if (game.clocks && game.status === 'playing') game.clocks = currentClocks(game);
  game.state = endedState;
  game.status = 'ended';
  game.endedAt = Date.now();
  game.drawOffer = null;
  broadcastState(game);
  io.to(gameRoom(game.id)).emit('game:ended', { gameId: game.id, result: endedState.result });
  broadcastLobby();
  scheduleCleanup(game.id);
  gameEnded(game).then((r) => {
    if (!r.ok) console.error(`[jogo ${game.id}] não foi possível guardar o resultado`, r.status ?? r.error);
  });
}

function afterMove(game, mover, newState) {
  if (!chargeClock(game, mover)) return finish(game, timeout(game.state, mover));
  game.state = newState;
  game.drawOffer = null; // efetuar um lance rejeita proposta de empate pendente (Art. 9.2b)
  if (newState.status === 'ended') return finish(game, newState);
  game.turnStartedAt = Date.now();
  startTurnTimer(game);
  broadcastState(game);
  maybeBotMove(game);
}

function maybeBotMove(game) {
  if (game.mode !== 'bot' || game.status !== 'playing') return;
  const side = game.state.turn;
  if (!game.players[side]?.bot) return;
  setTimeout(() => {
    if (game.status !== 'playing' || game.state.turn !== side) return;
    const move = chooseMove(game.state, game.botLevel);
    if (move) afterMove(game, side, applyMove(game.state, move));
  }, BOT_DELAY_MS);
}

function attachSocket(game, color, socket) {
  const player = game.players[color];
  player.sockets.add(socket.id);
  socket.join(gameRoom(game.id));
  if (player.leaveTimer) {
    clearTimeout(player.leaveTimer);
    player.leaveTimer = null;
    io.to(gameRoom(game.id)).emit('game:player-back', { gameId: game.id, color });
  }
}

function detachSocket(game, color, socketId) {
  const player = game.players[color];
  if (!player || player.bot) return;
  player.sockets.delete(socketId);
  if (player.sockets.size > 0) return;

  if (game.status === 'waiting') {
    removeGame(game.id);
    broadcastLobby();
    return;
  }
  if (game.status !== 'playing') return;

  io.to(gameRoom(game.id)).emit('game:player-away', { gameId: game.id, color, graceMs: DISCONNECT_GRACE_MS });
  player.leaveTimer = setTimeout(() => {
    if (game.status === 'playing' && player.sockets.size === 0) finish(game, forfeit(game.state, color));
  }, DISCONNECT_GRACE_MS);
  broadcastState(game);
}

function rejoinGames(socket) {
  const me = identity(socket);
  if (!me) return;
  for (const game of gamesOfPlayer(me.key)) {
    const color = colorOf(game, me.key);
    attachSocket(game, color, socket);
    socket.emit('game:state', view(game));
  }
}

const reply = (ack, data) => typeof ack === 'function' && ack(data);
const fail = (ack, error) => reply(ack, { ok: false, error });

function newPlayer(me) {
  return { key: me.key, id: me.id, name: me.name, guest: me.guest, sockets: new Set(), leaveTimer: null };
}

function parseTimeControl(tc) {
  if (tc === null) return null;
  const base = Number(tc?.base ?? DEFAULT_TIME.base);
  const increment = Number(tc?.increment ?? DEFAULT_TIME.increment);
  if (!Number.isFinite(base) || base < 30 * 1000 || base > 60 * 60 * 1000) return DEFAULT_TIME;
  if (!Number.isFinite(increment) || increment < 0 || increment > 60 * 1000) return DEFAULT_TIME;
  return { base, increment };
}

export const handleGameEvents = (ioServer, socket) => {
  io = ioServer;

  socket.on('game:guest', (guest, ack) => {
    const id = typeof guest?.guestId === 'string' ? guest.guestId.slice(0, 40) : null;
    if (!id) return fail(ack, 'O identificador de convidado é obrigatório.');
    const name = typeof guest.name === 'string' && guest.name.trim()
      ? guest.name.trim().slice(0, 20)
      : `Convidado-${id.slice(0, 4)}`;
    socket.data.guest = { id, name };
    rejoinGames(socket);
    reply(ack, { ok: true, name });
  });

  socket.on('login', () => rejoinGames(socket));

  socket.on('game:lobby', (_, ack) => {
    socket.join(LOBBY_ROOM);
    broadcastLobby();
    reply(ack, { ok: true });
  });

  socket.on('game:lobby-leave', () => socket.leave(LOBBY_ROOM));

  socket.on('game:create', (opts = {}, ack) => {
    const me = identity(socket);
    if (!me) return fail(ack, 'Inicia sessão ou escolhe um nome de convidado primeiro.');
    const mode = MODES.includes(opts.mode) ? opts.mode : 'casual';
    if (mode === 'ranked' && me.guest) return fail(ack, 'Jogos competitivos são apenas para utilizadores registados.');
    if (gamesOfPlayer(me.key).length > 0) return fail(ack, 'Já estás num jogo em curso.');

    const color = opts.color === 'w' || opts.color === 'b' ? opts.color : Math.random() < 0.5 ? 'w' : 'b';
    const timeControl = mode === 'bot' ? null : parseTimeControl(opts.timeControl);
    const players = { w: null, b: null };
    players[color] = newPlayer(me);

    const game = createGame({
      mode,
      isPublic: mode === 'ranked' ? true : opts.isPublic !== false,
      timeControl,
      clocks: timeControl ? { w: timeControl.base, b: timeControl.base } : null,
      players,
      spectators: new Set(),
      state: initialState(),
      status: 'waiting',
      drawOffer: null,
      botLevel: mode === 'bot' ? Math.min(4, Math.max(1, parseInt(opts.botLevel, 10) || 2)) : null,
    });
    attachSocket(game, color, socket);

    if (mode === 'bot') {
      game.players[opponent(color)] = { key: 'bot', id: null, name: `Bot (nível ${game.botLevel})`, bot: true, sockets: new Set() };
      startGame(game);
    } else {
      broadcastLobby();
      socket.emit('game:state', view(game));
    }
    reply(ack, { ok: true, gameId: game.id, color });
  });

  socket.on('game:join', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    if (!me) return fail(ack, 'Inicia sessão ou escolhe um nome de convidado primeiro.');
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Jogo não encontrado.');

    const already = colorOf(game, me.key);
    if (already) {
      attachSocket(game, already, socket);
      socket.emit('game:state', view(game));
      return reply(ack, { ok: true, gameId, color: already });
    }
    if (game.status !== 'waiting') return fail(ack, 'Este jogo já começou.');
    if (game.mode === 'ranked' && me.guest) return fail(ack, 'Jogos competitivos são apenas para utilizadores registados.');
    if (gamesOfPlayer(me.key).length > 0) return fail(ack, 'Já estás num jogo em curso.');

    const color = game.players.w ? 'b' : 'w';
    game.players[color] = newPlayer(me);
    attachSocket(game, color, socket);
    reply(ack, { ok: true, gameId, color });
    startGame(game);
  });

  socket.on('game:cancel', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    if (!game || !me || !colorOf(game, me.key)) return fail(ack, 'Jogo não encontrado.');
    if (game.status !== 'waiting') return fail(ack, 'O jogo já começou.');
    io.to(gameRoom(game.id)).emit('game:cancelled', { gameId });
    io.in(gameRoom(game.id)).socketsLeave(gameRoom(game.id));
    removeGame(game.id);
    broadcastLobby();
    reply(ack, { ok: true });
  });

  socket.on('game:spectate', ({ gameId } = {}, ack) => {
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Jogo não encontrado.');
    if (!game.isPublic) return fail(ack, 'Este jogo é privado.');
    game.spectators.add(socket.id);
    socket.join(gameRoom(game.id));
    socket.emit('game:state', view(game));
    broadcastLobby();
    reply(ack, { ok: true });
  });

  socket.on('game:spectate-leave', ({ gameId } = {}) => {
    const game = getGame(gameId);
    if (!game || !game.spectators.delete(socket.id)) return;
    socket.leave(gameRoom(game.id));
    broadcastLobby();
  });

  socket.on('game:get', ({ gameId } = {}, ack) => {
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Jogo não encontrado.');
    const me = identity(socket);
    if (!game.isPublic && !(me && colorOf(game, me.key))) return fail(ack, 'Este jogo é privado.');
    reply(ack, { ok: true, game: view(game) });
  });

  socket.on('game:move', ({ gameId, from, path } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Jogo não encontrado.');
    if (game.status !== 'playing') return fail(ack, 'O jogo não está a decorrer.');
    const color = me && colorOf(game, me.key);
    if (!color) return fail(ack, 'Não estás a jogar esta partida.');
    if (game.state.turn !== color) return fail(ack, 'Não é a tua vez de jogar.');

    const result = play(game.state, Number(from), Array.isArray(path) ? path.map(Number) : [Number(path)]);
    if (!result.ok) return fail(ack, ENGINE_ERRORS_PT[result.error] ?? result.error);

    reply(ack, { ok: true, notation: result.move.notation });
    afterMove(game, color, result.state);
  });

  socket.on('game:resign', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    const color = game && me && colorOf(game, me.key);
    if (!color) return fail(ack, 'Não estás a jogar esta partida.');
    if (game.status !== 'playing') return fail(ack, 'O jogo não está a decorrer.');
    finish(game, resign(game.state, color));
    reply(ack, { ok: true });
  });

  socket.on('game:draw-offer', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    const color = game && me && colorOf(game, me.key);
    if (!color) return fail(ack, 'Não estás a jogar esta partida.');
    if (game.status !== 'playing') return fail(ack, 'O jogo não está a decorrer.');
    if (!canOfferDraw(game.state)) return fail(ack, 'Só podes propor empate com 8 ou menos peças e uma dama de cada lado.');
    if (game.drawOffer) return fail(ack, 'Já existe uma proposta de empate pendente.');

    if (game.players[opponent(color)].bot) {
      const n = game.state.board.filter((p) => p && p.toLowerCase() === opponent(color)).length;
      const mine = game.state.board.filter((p) => p && p.toLowerCase() === color).length;
      if (n <= mine) {
        finish(game, agreeDraw(game.state));
        return reply(ack, { ok: true, accepted: true });
      }
      return reply(ack, { ok: true, accepted: false });
    }
    game.drawOffer = color;
    broadcastState(game);
    reply(ack, { ok: true });
  });

  socket.on('game:draw-answer', ({ gameId, accept } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    const color = game && me && colorOf(game, me.key);
    if (!color) return fail(ack, 'Não estás a jogar esta partida.');
    if (!game.drawOffer || game.drawOffer === color) return fail(ack, 'Não tens nenhuma proposta de empate para responder.');
    if (accept) finish(game, agreeDraw(game.state));
    else {
      game.drawOffer = null;
      broadcastState(game);
    }
    reply(ack, { ok: true });
  });

  const leaveEverything = () => {
    for (const game of allGames()) {
      if (game.spectators.delete(socket.id)) broadcastLobby();
      for (const c of ['w', 'b']) {
        if (game.players[c]?.sockets?.has(socket.id)) detachSocket(game, c, socket.id);
      }
    }
  };
  socket.on('logout', leaveEverything);
  socket.on('disconnect', leaveEverything);
};
