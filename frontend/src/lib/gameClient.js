import { socket } from '@/stores/socket'

export { socket }

export function emitAck(event, data = {}) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(event, data, (err, res) => {
      resolve(err ? { ok: false, error: 'O servidor de jogo não respondeu.' } : res)
    })
  })
}

export const TIME_CONTROLS = [
  { label: '3 + 2 (Blitz)', value: { base: 3 * 60000, increment: 2000 } },
  { label: '5 + 3 (Blitz)', value: { base: 5 * 60000, increment: 3000 } },
  { label: '10 + 5 (Rapid)', value: { base: 10 * 60000, increment: 5000 } },
  { label: 'Sem relógio (Clássico)', value: null },
]

export function timeLabel(tc) {
  if (!tc) return 'Sem relógio'
  return `${Math.round(tc.base / 60000)} + ${Math.round(tc.increment / 1000)}`
}

export function formatClock(ms) {
  if (ms == null) return '–'
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export const MODE_LABELS = {
  casual: 'Casual',
  ranked: 'Competitivo',
  bot: 'vs Bot',
}

export const REASONS = {
  no_pieces: 'todas as peças capturadas',
  blocked: 'sem jogadas legais',
  resign: 'desistência',
  timeout: 'tempo esgotado',
  forfeit: 'abandono da partida',
  agreement: 'empate por acordo mútuo',
  repetition: 'mesma posição repetida três vezes',
  twenty_moves: 'regra dos 20 lances',
  forcada: 'a «Forçada» não foi vencida em 12 lances',
  insufficient: 'apenas uma dama para cada lado',
}
