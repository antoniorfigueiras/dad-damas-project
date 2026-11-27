// =============================================================================
// Game events: lobby, create / join / spectate, moves, clock, draw, resign,
// disconnects and the bot.
//
// The server is the authority: clients only say what they WANT to do,
// every move is checked with the rules engine, and the clock runs here.
//
// Every client -> server event accepts an optional callback (Socket.IO "ack"):
//   socket.emit('game:move', { gameId, from, path }, (res) => { ... })
//   res = { ok: true, ... } or { ok: false, error: '...' }
// =============================================================================
import { getUser } from '../state/connection.js';
import { createGame, getGame, allGames, gamesOfPlayer, scheduleCleanup, removeGame } from '../state/games.js';
import { initialState, play, applyMove, legalMoves, resign, timeout, forfeit, agreeDraw, canOfferDraw, opponent } from '../game/engine.js';
import { chooseMove } from '../game/bot.js';
import { gameStarting, gameEnded } from '../game/persist.js';

const LOBBY_ROOM = 'lobby';
const DISCONNECT_GRACE_MS = 60 * 1000;   // a player who leaves has 60 s to come back
const BOT_DELAY_MS = 600;                // so the bot doesn't answer instantly
const DEFAULT_TIME = { base: 5 * 60 * 1000, increment: 3 * 1000 }; // 5 min + 3 s per move
const MODES = ['casual', 'ranked', 'bot'];

export const gameRoom = (id) => `game:${id}`;

// ---------- Who is this socket? -----------------------------------------------
// Logged-in users come from the existing 'login' event (state/connection.js).
// Anonymous users send 'game:guest' with an id they keep in localStorage,
// so they can get back into their game after a refresh.
function identity(socket) {
  const user = getUser(socket.id);
  if (user) return { key: `u:${user.id}`, id: user.id, name: user.name, guest: false };
  const g = socket.data.guest;
  if (g) return { key: `g:${g.id}`, id: null, name: g.name, guest: true };
  return null;
}

const colorOf = (game, key) =>
  game.players.w?.key === key ? 'w' : game.players.b?.key === key ? 'b' : null;

// ---------- What clients get to see -------------------------------------------
function publicPlayer(p) {
  if (!p) return null;
  return { id: p.id, name: p.name, guest: !!p.guest, bot: !!p.bot, connected: p.bot || p.sockets.size > 0 };
}

function summary(game) {
  return {
    id: game.id,
    mode: game.mode,
    status: game.status,
    stake: game.stake,
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
    clocks: currentClocks(game),   // ms left for each side right now
    serverTime: Date.now(),        // so the client can count down smoothly
    drawOffer: game.drawOffer,     // 'w' | 'b' | null - who offered
    canOfferDraw: game.status === 'playing' && canOfferDraw(s),
  };
}

// ---------- Broadcasting -------------------------------------------------------
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

// ---------- Clock --------------------------------------------------------------
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
    else startTurnTimer(game); // woke up a bit early
  }, game.clocks[side] + 50);
}

// After a move: charge the time used and add the increment
function chargeClock(game, mover) {
  if (!game.clocks) return true;
  const used = Date.now() - game.turnStartedAt;
  game.clocks[mover] -= used;
  if (game.clocks[mover] <= 0) return false;
  game.clocks[mover] += game.timeControl.increment;
  return true;
}

// ---------- Game life cycle ----------------------------------------------------
async function startGame(game) {
  const check = await gameStarting(game);
  if (!check.ok) {
    const msg = check.data?.message || 'The game could not start (entry fee?)';
    io.to(gameRoom(game.id)).emit('game:error', { gameId: game.id, error: msg });
    game.status = 'waiting';
    if (game.players.b && !game.players.b.bot) {
      // put the joiner back out, keep the game open
      for (const sid of game.players.b.sockets) io.sockets.sockets.get(sid)?.leave(gameRoom(game.id));
      game.players.b = null;
    }
    broadcastLobby();
    return;
  }
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
    if (!r.ok) console.error(`[game ${game.id}] could not save the result`, r.status ?? r.error);
  });
}

function afterMove(game, mover, newState) {
  if (!chargeClock(game, mover)) return finish(game, timeout(game.state, mover));
  game.state = newState;
  game.drawOffer = null; // making a move rejects a pending offer (Art. 9.2b)
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

// ---------- Players' sockets and disconnects ------------------------------------
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
  if (player.sockets.size > 0) return; // still has another tab open

  if (game.status === 'waiting') {
    // the creator left before anyone joined: close the game
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

// When someone identifies (login / guest) put them back in their games
function rejoinGames(socket) {
  const me = identity(socket);
  if (!me) return;
  for (const game of gamesOfPlayer(me.key)) {
    const color = colorOf(game, me.key);
    attachSocket(game, color, socket);
    socket.emit('game:state', view(game));
  }
}

// ---------- Helpers for handlers ------------------------------------------------
const reply = (ack, data) => typeof ack === 'function' && ack(data);
const fail = (ack, error) => reply(ack, { ok: false, error });

function newPlayer(me) {
  return { key: me.key, id: me.id, name: me.name, guest: me.guest, sockets: new Set(), leaveTimer: null };
}

function parseTimeControl(tc) {
  if (tc === null) return null; // no clock
  const base = Number(tc?.base ?? DEFAULT_TIME.base);
  const increment = Number(tc?.increment ?? DEFAULT_TIME.increment);
  if (!Number.isFinite(base) || base < 30 * 1000 || base > 60 * 60 * 1000) return DEFAULT_TIME;
  if (!Number.isFinite(increment) || increment < 0 || increment > 60 * 1000) return DEFAULT_TIME;
  return { base, increment };
}

// =============================================================================
export const handleGameEvents = (ioServer, socket) => {
  io = ioServer;

  // --- identity ---------------------------------------------------------------
  socket.on('game:guest', (guest, ack) => {
    const id = typeof guest?.guestId === 'string' ? guest.guestId.slice(0, 40) : null;
    if (!id) return fail(ack, 'guestId is required');
    const name = typeof guest.name === 'string' && guest.name.trim()
      ? guest.name.trim().slice(0, 20)
      : `Guest-${id.slice(0, 4)}`;
    socket.data.guest = { id, name };
    rejoinGames(socket);
    reply(ack, { ok: true, name });
  });

  // The existing 'login' handler (events/connection.js) runs first and stores the user
  socket.on('login', () => rejoinGames(socket));

  // --- lobby ------------------------------------------------------------------
  socket.on('game:lobby', (_, ack) => {
    socket.join(LOBBY_ROOM);
    broadcastLobby();
    reply(ack, { ok: true });
  });

  socket.on('game:lobby-leave', () => socket.leave(LOBBY_ROOM));

  // --- create -----------------------------------------------------------------
  // { mode: 'casual'|'ranked'|'bot', color: 'w'|'b'|'random', isPublic, stake,
  //   timeControl: { base, increment } | null, botLevel: 1-4 }
  socket.on('game:create', (opts = {}, ack) => {
    const me = identity(socket);
    if (!me) return fail(ack, 'Log in or choose a guest name first');
    const mode = MODES.includes(opts.mode) ? opts.mode : 'casual';
    if (mode === 'ranked' && me.guest) return fail(ack, 'Ranked games are for registered players');
    if (gamesOfPlayer(me.key).length > 0) return fail(ack, 'You are already in a game');

    let color = opts.color === 'w' || opts.color === 'b' ? opts.color : Math.random() < 0.5 ? 'w' : 'b';
    const timeControl = mode === 'bot' ? null : parseTimeControl(opts.timeControl);
    const players = { w: null, b: null };
    players[color] = newPlayer(me);

    const game = createGame({
      mode,
      // ranked games are always public (project rules); others choose
      isPublic: mode === 'ranked' ? true : opts.isPublic !== false,
      stake: mode === 'ranked' ? Math.max(1, parseInt(opts.stake, 10) || 10) : 0,
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
      game.players[opponent(color)] = { key: 'bot', id: null, name: `Bot (level ${game.botLevel})`, bot: true, sockets: new Set() };
      startGame(game);
    } else {
      broadcastLobby();
      socket.emit('game:state', view(game));
    }
    reply(ack, { ok: true, gameId: game.id, color });
  });

  // --- join -------------------------------------------------------------------
  socket.on('game:join', async ({ gameId } = {}, ack) => {
    const me = identity(socket);
    if (!me) return fail(ack, 'Log in or choose a guest name first');
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Game not found');

    const already = colorOf(game, me.key);
    if (already) { // same person, another tab or after a refresh
      attachSocket(game, already, socket);
      socket.emit('game:state', view(game));
      return reply(ack, { ok: true, gameId, color: already });
    }
    if (game.status !== 'waiting') return fail(ack, 'This game already started');
    if (game.mode === 'ranked' && me.guest) return fail(ack, 'Ranked games are for registered players');
    if (gamesOfPlayer(me.key).length > 0) return fail(ack, 'You are already in a game');

    const color = game.players.w ? 'b' : 'w';
    game.players[color] = newPlayer(me);
    game.status = 'starting'; // nobody else can join while Laravel checks the fee
    attachSocket(game, color, socket);
    reply(ack, { ok: true, gameId, color });
    await startGame(game);
  });

  // --- cancel a game nobody joined yet ------------------------------------------
  socket.on('game:cancel', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    if (!game || !me || !colorOf(game, me.key)) return fail(ack, 'Game not found');
    if (game.status !== 'waiting') return fail(ack, 'The game already started');
    io.to(gameRoom(game.id)).emit('game:cancelled', { gameId });
    io.in(gameRoom(game.id)).socketsLeave(gameRoom(game.id));
    removeGame(game.id);
    broadcastLobby();
    reply(ack, { ok: true });
  });

  // --- spectate (anyone, even without logging in) ------------------------------
  socket.on('game:spectate', ({ gameId } = {}, ack) => {
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Game not found');
    if (!game.isPublic) return fail(ack, 'This game is private');
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

  // Ask for the current state again (e.g. after the page reloads)
  socket.on('game:get', ({ gameId } = {}, ack) => {
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Game not found');
    const me = identity(socket);
    if (!game.isPublic && !(me && colorOf(game, me.key))) return fail(ack, 'This game is private');
    reply(ack, { ok: true, game: view(game) });
  });

  // --- moves --------------------------------------------------------------------
  // { gameId, from: 22, path: [18] }  or a multi-capture: { from: 27, path: [18, 9] }
  socket.on('game:move', ({ gameId, from, path } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    if (!game) return fail(ack, 'Game not found');
    if (game.status !== 'playing') return fail(ack, 'The game is not being played');
    const color = me && colorOf(game, me.key);
    if (!color) return fail(ack, 'You are not playing this game');
    if (game.state.turn !== color) return fail(ack, 'It is not your turn');

    const result = play(game.state, Number(from), Array.isArray(path) ? path.map(Number) : [Number(path)]);
    if (!result.ok) return fail(ack, result.error);

    reply(ack, { ok: true, notation: result.move.notation });
    afterMove(game, color, result.state);
  });

  // --- resign -------------------------------------------------------------------
  socket.on('game:resign', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    const color = game && me && colorOf(game, me.key);
    if (!color) return fail(ack, 'You are not playing this game');
    if (game.status !== 'playing') return fail(ack, 'The game is not being played');
    finish(game, resign(game.state, color));
    reply(ack, { ok: true });
  });

  // --- draws --------------------------------------------------------------------
  socket.on('game:draw-offer', ({ gameId } = {}, ack) => {
    const me = identity(socket);
    const game = getGame(gameId);
    const color = game && me && colorOf(game, me.key);
    if (!color) return fail(ack, 'You are not playing this game');
    if (game.status !== 'playing') return fail(ack, 'The game is not being played');
    if (!canOfferDraw(game.state)) return fail(ack, 'A draw can only be offered with 8 pieces or fewer and a king on each side');
    if (game.drawOffer) return fail(ack, 'There is already a draw offer');

    if (game.players[opponent(color)].bot) {
      // the bot accepts only when it isn't winning on material
      const n = game.state.board.filter((p) => p && p.toLowerCase() === opponent(color)).length;
      const mine = game.state.board.filter((p) => p && p.toLowerCase() === color).length;
      if (n <= mine) { finish(game, agreeDraw(game.state)); return reply(ack, { ok: true, accepted: true }); }
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
    if (!color) return fail(ack, 'You are not playing this game');
    if (!game.drawOffer || game.drawOffer === color) return fail(ack, 'There is no draw offer for you');
    if (accept) finish(game, agreeDraw(game.state));
    else {
      game.drawOffer = null;
      broadcastState(game);
    }
    reply(ack, { ok: true });
  });

  // --- leaving --------------------------------------------------------------------
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
