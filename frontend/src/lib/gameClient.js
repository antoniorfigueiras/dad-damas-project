// Small helpers shared by the Lobby and Game pages.
// Uses the same Socket.IO connection as the rest of the app (stores/socket.js),
// so the server already knows who is logged in.
import { ref } from 'vue'
import { socket } from '@/stores/socket'

export { socket }

// emit + wait for the server's answer ({ ok, ... } or { ok: false, error })
export function emitAck(event, data = {}) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(event, data, (err, res) => {
      resolve(err ? { ok: false, error: 'The game server did not answer' } : res)
    })
  })
}

// ---------- Guests (anonymous players) ----------------------------------------
// The guest id is kept in localStorage so a refresh gets you back into your game.
const KEY = 'damas-guest'

function randomId() {
  // crypto.randomUUID only exists on https / localhost; the cluster runs on plain http
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function savedGuest() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}

export const guestName = ref(savedGuest()?.name ?? null)

export async function becomeGuest(name) {
  const guest = savedGuest() || { guestId: randomId() }
  guest.name = name?.trim() || guest.name
  const res = await emitAck('game:guest', guest)
  if (res.ok) {
    guest.name = res.name
    localStorage.setItem(KEY, JSON.stringify(guest))
    guestName.value = res.name
  }
  return res
}

export function restoreGuest() {
  const guest = savedGuest()
  return guest ? emitAck('game:guest', guest) : Promise.resolve({ ok: false })
}

// The server forgets guests when the connection drops: tell it again
socket.on('connect', () => {
  if (savedGuest()) restoreGuest()
})

// ---------- Display helpers ----------------------------------------------------
export const TIME_CONTROLS = [
  { label: '3 + 2', value: { base: 3 * 60000, increment: 2000 } },
  { label: '5 + 3', value: { base: 5 * 60000, increment: 3000 } },
  { label: '10 + 5', value: { base: 10 * 60000, increment: 5000 } },
  { label: 'No clock', value: null },
]

export function timeLabel(tc) {
  if (!tc) return 'No clock'
  return `${Math.round(tc.base / 60000)} + ${Math.round(tc.increment / 1000)}`
}

export function formatClock(ms) {
  if (ms == null) return '–'
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export const MODE_LABELS = { casual: 'Casual', ranked: 'Ranked', bot: 'vs Bot' }

export const REASONS = {
  no_pieces: 'all pieces captured',
  blocked: 'no moves left',
  resign: 'resignation',
  timeout: 'time ran out',
  forfeit: 'player left the game',
  agreement: 'agreed draw',
  repetition: 'same position three times',
  twenty_moves: '20-move rule',
  forcada: 'the Forçada was not won in 12 moves',
  insufficient: 'one king each',
}
