<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftIcon, CopyIcon, CrownIcon, EyeIcon, FlagIcon, HandshakeIcon, XIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSocketStore } from '@/stores/socket'
import { squareAt } from '@/lib/engine'
import { socket, emitAck, restoreGuest, formatClock, timeLabel, MODE_LABELS, REASONS } from '@/lib/gameClient'

const route = useRoute()
const router = useRouter()
const socketStore = useSocketStore()

const game = ref(null)          // last game:state from the server
const receivedAt = ref(0)       // when it arrived (to run the clocks locally)
const myColor = ref(null)       // 'w' | 'b' | null (spectator)
const error = ref('')
const notice = ref('')
const now = ref(Date.now())
const selected = ref(null)      // square of the piece being moved
const partialPath = ref([])     // squares already clicked in a multi-capture
const copied = ref(false)

const gameId = computed(() => route.params.id)
const isPlayer = computed(() => myColor.value !== null)
const opp = computed(() => (myColor.value === 'w' ? 'b' : 'w'))
const flipped = computed(() => myColor.value === 'b')
const myTurn = computed(
  () => game.value?.status === 'playing' && isPlayer.value && game.value.turn === myColor.value,
)

// ---------- connecting to the game ------------------------------------------------
async function enter() {
  error.value = ''
  await restoreGuest()
  // Opening the page = joining: works for the creator, after a refresh,
  // and for whoever opens an invite link. If we can't play, we watch.
  const joined = await emitAck('game:join', { gameId: gameId.value })
  if (joined.ok) {
    myColor.value = joined.color
  } else {
    myColor.value = null
    const watched = await emitAck('game:spectate', { gameId: gameId.value })
    if (!watched.ok) return (error.value = watched.error)
  }
  const res = await emitAck('game:get', { gameId: gameId.value })
  if (res.ok) onState(res.game)
}

function onState(state) {
  if (state.id !== gameId.value) return
  game.value = state
  receivedAt.value = Date.now()
  now.value = receivedAt.value
  selected.value = null
  partialPath.value = []
}

function onEnded({ gameId: id }) {
  if (id === gameId.value) notice.value = ''
}

function onAway({ gameId: id, color, graceMs }) {
  if (id !== gameId.value) return
  const who = color === myColor.value ? 'You were' : `${game.value?.players[color]?.name ?? 'Opponent'} is`
  notice.value = `${who} disconnected – they lose if not back in ${Math.round(graceMs / 1000)} s.`
}

function onBack({ gameId: id }) {
  if (id === gameId.value) notice.value = ''
}

function onCancelled({ gameId: id }) {
  if (id === gameId.value) router.push({ name: 'lobby' })
}

function onError({ gameId: id, error: msg }) {
  if (id === gameId.value) error.value = msg
}

let ticker = null
onMounted(() => {
  socket.on('game:state', onState)
  socket.on('game:ended', onEnded)
  socket.on('game:player-away', onAway)
  socket.on('game:player-back', onBack)
  socket.on('game:cancelled', onCancelled)
  socket.on('game:error', onError)
  socket.on('connect', enter)
  ticker = setInterval(() => (now.value = Date.now()), 250)
  enter()
})

onUnmounted(() => {
  socket.off('game:state', onState)
  socket.off('game:ended', onEnded)
  socket.off('game:player-away', onAway)
  socket.off('game:player-back', onBack)
  socket.off('game:cancelled', onCancelled)
  socket.off('game:error', onError)
  socket.off('connect', enter)
  clearInterval(ticker)
  if (!isPlayer.value) socket.emit('game:spectate-leave', { gameId: gameId.value })
})

// another game id in the url (e.g. "play again")
watch(gameId, () => {
  game.value = null
  enter()
})

// ---------- board ------------------------------------------------------------------
// rows from the top of the screen; White sees row 7 at the top, Black sees row 0
const rows = computed(() => {
  const out = []
  for (let i = 0; i < 8; i++) {
    const r = flipped.value ? i : 7 - i
    const cells = []
    for (let j = 0; j < 8; j++) {
      const c = flipped.value ? 7 - j : j
      cells.push({ r, c, sq: squareAt(r, c) })
    }
    out.push(cells)
  }
  return out
})

const myMoves = computed(() => (myTurn.value ? game.value.legalMoves : []))
const movablePieces = computed(() => new Set(myMoves.value.map((m) => m.from)))

// moves of the selected piece that still match the squares clicked so far
const candidates = computed(() => {
  if (!selected.value) return []
  return myMoves.value.filter(
    (m) => m.from === selected.value && partialPath.value.every((s, i) => m.path[i] === s),
  )
})
const nextTargets = computed(() => new Set(candidates.value.map((m) => m.path[partialPath.value.length])))

// pieces that will be captured by the route clicked so far
const pendingCaptures = computed(() => {
  if (!partialPath.value.length) return new Set()
  const n = partialPath.value.length
  const set = new Set()
  for (const m of candidates.value) m.captured.slice(0, n).forEach((s) => set.add(s))
  return set
})

const lastMoveSquares = computed(() => {
  const lm = game.value?.lastMove
  return lm ? new Set([lm.from, ...lm.path]) : new Set()
})

const capturableMandatory = computed(() => myMoves.value.some((m) => m.captured.length > 0))

async function clickSquare(sq) {
  if (!sq || !myTurn.value) return
  // pick (or switch to) one of my pieces
  if (movablePieces.value.has(sq) && partialPath.value.length === 0) {
    selected.value = selected.value === sq ? null : sq
    return
  }
  if (!selected.value || !nextTargets.value.has(sq)) {
    selected.value = null
    partialPath.value = []
    return
  }
  partialPath.value = [...partialPath.value, sq]
  const done = candidates.value.find((m) => m.path.length === partialPath.value.length)
  if (done) await sendMove(done)
}

async function sendMove(move) {
  error.value = ''
  const res = await emitAck('game:move', { gameId: gameId.value, from: move.from, path: move.path })
  if (!res.ok) {
    error.value = res.error
    selected.value = null
    partialPath.value = []
  }
}

function pieceClass(p) {
  const white = p === 'w' || p === 'W'
  return white
    ? 'bg-stone-50 border-stone-300 text-amber-600'
    : 'bg-stone-900 border-stone-700 text-amber-400'
}

function squareClass(cell) {
  if (!cell.sq) return 'bg-amber-100'
  const classes = ['bg-amber-800']
  if (lastMoveSquares.value.has(cell.sq)) classes.push('ring-4 ring-inset ring-yellow-300/50')
  if (selected.value === cell.sq) classes.push('ring-4 ring-inset ring-sky-400')
  if (myTurn.value && movablePieces.value.has(cell.sq) && !selected.value) classes.push('cursor-pointer')
  if (nextTargets.value.has(cell.sq)) classes.push('cursor-pointer')
  return classes.join(' ')
}

// ---------- clocks -------------------------------------------------------------------
function clockOf(color) {
  const g = game.value
  if (!g?.clocks) return null
  let ms = g.clocks[color]
  if (g.status === 'playing' && g.turn === color) ms -= Math.max(0, now.value - receivedAt.value)
  return Math.max(0, ms)
}

// ---------- status text --------------------------------------------------------------
const colorName = (c) => (c === 'w' ? 'White' : 'Black')

const statusText = computed(() => {
  const g = game.value
  if (!g) return ''
  if (g.status === 'waiting') return 'Waiting for an opponent…'
  if (g.status === 'starting') return 'Starting…'
  if (g.status === 'ended') {
    const r = g.result
    const why = REASONS[r.reason] ?? r.reason
    if (!r.winner) return `Draw – ${why}`
    if (isPlayer.value) return `${r.winner === myColor.value ? 'You won' : 'You lost'} – ${why}`
    return `${g.players[r.winner]?.name ?? colorName(r.winner)} wins – ${why}`
  }
  if (myTurn.value) return capturableMandatory.value ? 'Your turn – you must capture' : 'Your turn'
  return `${g.players[g.turn]?.name ?? colorName(g.turn)} to move`
})

// move list as pairs: 1. 10-14 23-19
const moveRows = computed(() => {
  const h = game.value?.history ?? []
  const out = []
  for (let i = 0; i < h.length; i += 2) out.push({ n: i / 2 + 1, w: h[i], b: h[i + 1] ?? '' })
  return out
})

// players in screen order: opponent on top, me at the bottom
const topColor = computed(() => (flipped.value ? 'w' : 'b'))
const bottomColor = computed(() => (flipped.value ? 'b' : 'w'))

// ---------- actions -----------------------------------------------------------------
async function act(event, data = {}) {
  error.value = ''
  const res = await emitAck(event, { gameId: gameId.value, ...data })
  if (!res.ok) error.value = res.error
  return res
}

async function resign() {
  if (confirm('Resign this game?')) await act('game:resign')
}

async function offerDraw() {
  const res = await act('game:draw-offer')
  if (res.ok && res.accepted === false) error.value = 'The bot declined the draw.'
}

const answerDraw = (accept) => act('game:draw-answer', { accept })
const cancel = () => act('game:cancel')

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
  } catch {
    // clipboard needs https; fall back to a prompt the user can copy from
    prompt('Copy this link:', window.location.href)
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="mb-4 flex flex-wrap items-center gap-3">
    <Button variant="ghost" size="sm" as-child>
      <RouterLink :to="{ name: 'lobby' }"><ArrowLeftIcon /> Lobby</RouterLink>
    </Button>
    <template v-if="game">
      <Badge :variant="game.mode === 'ranked' ? 'default' : 'secondary'">{{ MODE_LABELS[game.mode] }}</Badge>
      <Badge variant="outline">{{ timeLabel(game.timeControl) }}</Badge>
      <Badge v-if="game.mode === 'ranked'" variant="outline">{{ game.stake }} coins</Badge>
      <Badge v-if="!isPlayer" variant="outline"><EyeIcon class="size-3" /> Watching</Badge>
      <span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <EyeIcon class="size-3" /> {{ game.spectators }}
      </span>
    </template>
  </div>

  <p v-if="error" class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
    {{ error }}
  </p>
  <p v-if="notice" class="mb-4 rounded-md border border-amber-400/50 bg-amber-100 px-3 py-2 text-sm text-amber-900">
    {{ notice }}
  </p>

  <div v-if="!game && !error" class="py-20 text-center text-muted-foreground">Loading game…</div>

  <div v-if="game" class="grid items-start gap-6 lg:grid-cols-[minmax(0,34rem)_1fr]">
    <!-- board column -->
    <div class="space-y-3">
      <!-- top player -->
      <div class="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="size-4 rounded-full border" :class="topColor === 'w' ? 'bg-stone-50' : 'bg-stone-900'" />
          <span class="font-medium">{{ game.players[topColor]?.name ?? 'Waiting…' }}</span>
          <Badge v-if="game.players[topColor] && !game.players[topColor].connected" variant="destructive">away</Badge>
        </div>
        <span
          v-if="game.clocks"
          class="rounded px-2 py-0.5 font-mono text-lg tabular-nums"
          :class="game.status === 'playing' && game.turn === topColor ? 'bg-primary text-primary-foreground' : 'bg-muted'"
        >{{ formatClock(clockOf(topColor)) }}</span>
      </div>

      <!-- the board -->
      <div class="relative aspect-square w-full overflow-hidden rounded-lg border-4 border-amber-950 shadow-lg select-none">
        <div class="grid h-full w-full grid-cols-8 grid-rows-8">
          <template v-for="(row, i) in rows" :key="i">
            <div
              v-for="cell in row"
              :key="`${cell.r}-${cell.c}`"
              class="relative flex items-center justify-center transition-colors"
              :class="squareClass(cell)"
              @click="clickSquare(cell.sq)"
            >
              <span v-if="cell.sq" class="pointer-events-none absolute left-0.5 top-0 text-[9px] text-amber-200/60">
                {{ cell.sq }}
              </span>

              <!-- piece -->
              <div
                v-if="cell.sq && game.board[cell.sq]"
                class="flex size-[78%] items-center justify-center rounded-full border-2 shadow-[0_3px_0_rgba(0,0,0,0.35)] transition-transform"
                :class="[
                  pieceClass(game.board[cell.sq]),
                  selected === cell.sq ? 'scale-110' : '',
                  pendingCaptures.has(cell.sq) ? 'opacity-40' : '',
                  myTurn && movablePieces.has(cell.sq) && !selected ? 'ring-2 ring-sky-300' : '',
                ]"
              >
                <CrownIcon v-if="game.board[cell.sq] === 'W' || game.board[cell.sq] === 'B'" class="size-1/2" />
              </div>

              <!-- where the selected piece can go -->
              <div
                v-else-if="nextTargets.has(cell.sq)"
                class="size-1/3 rounded-full bg-sky-400/70"
              />
              <!-- squares already clicked in a multi-capture -->
              <div
                v-if="partialPath.includes(cell.sq)"
                class="pointer-events-none absolute size-1/4 rounded-full bg-sky-200"
              />
            </div>
          </template>
        </div>
      </div>

      <!-- bottom player -->
      <div class="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="size-4 rounded-full border" :class="bottomColor === 'w' ? 'bg-stone-50' : 'bg-stone-900'" />
          <span class="font-medium">{{ game.players[bottomColor]?.name ?? 'Waiting…' }}</span>
          <Badge v-if="isPlayer && bottomColor === myColor" variant="secondary">you</Badge>
          <Badge v-if="game.players[bottomColor] && !game.players[bottomColor].connected" variant="destructive">away</Badge>
        </div>
        <span
          v-if="game.clocks"
          class="rounded px-2 py-0.5 font-mono text-lg tabular-nums"
          :class="game.status === 'playing' && game.turn === bottomColor ? 'bg-primary text-primary-foreground' : 'bg-muted'"
        >{{ formatClock(clockOf(bottomColor)) }}</span>
      </div>
    </div>

    <!-- side column -->
    <div class="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle class="text-lg" :class="myTurn ? 'text-sky-700' : ''">{{ statusText }}</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <!-- waiting: invite link -->
          <div v-if="game.status === 'waiting' && isPlayer" class="space-y-2">
            <p class="text-sm text-muted-foreground">Send this link to a friend, or wait for someone from the lobby.</p>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" @click="copyLink">
                <CopyIcon /> {{ copied ? 'Copied!' : 'Copy invite link' }}
              </Button>
              <Button variant="ghost" size="sm" @click="cancel"><XIcon /> Cancel game</Button>
            </div>
          </div>

          <!-- draw offer from the opponent -->
          <div
            v-if="game.status === 'playing' && isPlayer && game.drawOffer === opp"
            class="flex flex-wrap items-center gap-2 rounded-md border bg-muted px-3 py-2"
          >
            <span class="text-sm">Your opponent offers a draw.</span>
            <Button size="sm" @click="answerDraw(true)">Accept</Button>
            <Button size="sm" variant="outline" @click="answerDraw(false)">Decline</Button>
          </div>
          <p v-if="game.status === 'playing' && isPlayer && game.drawOffer === myColor" class="text-sm text-muted-foreground">
            Draw offered – waiting for an answer.
          </p>

          <!-- playing: actions -->
          <div v-if="game.status === 'playing' && isPlayer" class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="!game.canOfferDraw || !!game.drawOffer"
              :title="game.canOfferDraw ? '' : 'Only with 8 pieces or fewer and a king on each side'"
              @click="offerDraw"
            >
              <HandshakeIcon /> Offer draw
            </Button>
            <Button variant="destructive" size="sm" @click="resign"><FlagIcon /> Resign</Button>
          </div>

          <!-- ended -->
          <div v-if="game.status === 'ended'" class="flex gap-2">
            <Button size="sm" as-child>
              <RouterLink :to="{ name: 'lobby' }">Back to lobby</RouterLink>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">Moves</CardTitle>
        </CardHeader>
        <CardContent>
          <p v-if="!moveRows.length" class="text-sm text-muted-foreground">No moves yet. White starts.</p>
          <ol v-else class="max-h-72 overflow-y-auto font-mono text-sm">
            <li v-for="row in moveRows" :key="row.n" class="grid grid-cols-[2.5rem_1fr_1fr] py-0.5 odd:bg-muted/50">
              <span class="pl-1 text-muted-foreground">{{ row.n }}.</span>
              <span>{{ row.w }}</span>
              <span>{{ row.b }}</span>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
