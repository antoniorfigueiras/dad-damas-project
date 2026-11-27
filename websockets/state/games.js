// Games currently open or being played, kept in memory by the WebSocket server.
// Finished games are kept for a few minutes (so players can see the result),
// then removed. The permanent record lives in Laravel (see game/persist.js).
import { randomUUID } from 'node:crypto';

const games = new Map();
const KEEP_ENDED_MS = 5 * 60 * 1000;

export const createGame = (data) => {
  const id = randomUUID().slice(0, 8);
  const game = { id, createdAt: Date.now(), ...data };
  games.set(id, game);
  return game;
};

export const getGame = (id) => games.get(id);

export const removeGame = (id) => games.delete(id);

export const allGames = () => [...games.values()];

// Called when a game ends: forget it later
export const scheduleCleanup = (id) => {
  setTimeout(() => games.delete(id), KEEP_ENDED_MS).unref?.();
};

// Every game where this person (identity key) is one of the players
export const gamesOfPlayer = (key) =>
  allGames().filter((g) => g.status !== 'ended' && (g.players.w?.key === key || g.players.b?.key === key));
