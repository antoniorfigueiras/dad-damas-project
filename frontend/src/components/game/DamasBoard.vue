<script setup>
import { computed, ref, watch } from 'vue'
import { CrownIcon } from '@lucide/vue'
import { squareAt } from '@/lib/board'

const props = defineProps({
  board: { type: Array, required: true },
  legalMoves: { type: Array, default: () => [] },
  lastMove: { type: Object, default: null },
  flipped: { type: Boolean, default: false },
  interactive: { type: Boolean, default: false },
})

const emit = defineEmits(['move'])

const selected = ref(null)
const partialPath = ref([])

// Limpa seleção sempre que o tabuleiro mudar
watch(
  () => props.board,
  () => {
    selected.value = null
    partialPath.value = []
  },
)

const rows = computed(() => {
  const out = []
  for (let i = 0; i < 8; i++) {
    const r = props.flipped ? i : 7 - i
    const cells = []
    for (let j = 0; j < 8; j++) {
      const c = props.flipped ? 7 - j : j
      cells.push({ r, c, sq: squareAt(r, c) })
    }
    out.push(cells)
  }
  return out
})

const myMoves = computed(() => (props.interactive ? props.legalMoves : []))
const movablePieces = computed(() => new Set(myMoves.value.map((m) => m.from)))

const candidates = computed(() => {
  if (!selected.value) return []
  return myMoves.value.filter(
    (m) => m.from === selected.value && partialPath.value.every((s, i) => m.path[i] === s),
  )
})

const nextTargets = computed(
  () => new Set(candidates.value.map((m) => m.path[partialPath.value.length])),
)

const pendingCaptures = computed(() => {
  if (!partialPath.value.length) return new Set()
  const n = partialPath.value.length
  const set = new Set()
  for (const m of candidates.value) m.captured.slice(0, n).forEach((s) => set.add(s))
  return set
})

const lastMoveSquares = computed(() => {
  const lm = props.lastMove
  return lm ? new Set([lm.from, ...lm.path]) : new Set()
})

function clickSquare(sq) {
  if (!sq || !props.interactive) return
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
  if (done) {
    emit('move', { from: done.from, path: done.path })
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
  if (props.interactive && movablePieces.value.has(cell.sq) && !selected.value)
    classes.push('cursor-pointer')
  if (nextTargets.value.has(cell.sq)) classes.push('cursor-pointer')
  return classes.join(' ')
}
</script>

<template>
  <div
    class="relative aspect-square w-full overflow-hidden rounded-lg border-4 border-amber-950 shadow-lg select-none"
  >
    <div class="grid h-full w-full grid-cols-8 grid-rows-8">
      <template v-for="(row, i) in rows" :key="i">
        <div
          v-for="cell in row"
          :key="`${cell.r}-${cell.c}`"
          class="relative flex items-center justify-center transition-colors"
          :class="squareClass(cell)"
          @click="clickSquare(cell.sq)"
        >
          <span
            v-if="cell.sq"
            class="pointer-events-none absolute left-0.5 top-0 text-[9px] text-amber-200/60"
          >
            {{ cell.sq }}
          </span>

          <div
            v-if="cell.sq && board[cell.sq]"
            class="flex size-[78%] items-center justify-center rounded-full border-2 shadow-[0_3px_0_rgba(0,0,0,0.35)] transition-transform"
            :class="[
              pieceClass(board[cell.sq]),
              selected === cell.sq ? 'scale-110' : '',
              pendingCaptures.has(cell.sq) ? 'opacity-40' : '',
              interactive && movablePieces.has(cell.sq) && !selected ? 'ring-2 ring-sky-300' : '',
            ]"
          >
            <CrownIcon
              v-if="board[cell.sq] === 'W' || board[cell.sq] === 'B'"
              class="size-1/2"
            />
          </div>

          <div
            v-else-if="nextTargets.has(cell.sq)"
            class="size-1/3 rounded-full bg-sky-400/70"
          />

          <div
            v-if="partialPath.includes(cell.sq)"
            class="pointer-events-none absolute size-1/4 rounded-full bg-sky-200"
          />
        </div>
      </template>
    </div>
  </div>
</template>
