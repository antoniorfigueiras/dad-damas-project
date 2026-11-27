<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftIcon, CopyIcon, EyeIcon, FlagIcon, HandshakeIcon, XIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DamasBoard from '@/components/game/DamasBoard.vue'
import PlayerBar from '@/components/game/PlayerBar.vue'
import MoveHistory from '@/components/game/MoveHistory.vue'
import { useGameStore } from '@/stores/game'
import { timeLabel, MODE_LABELS, REASONS } from '@/lib/gameClient'

const route = useRoute()
const router = useRouter()
const gameStore = useGameStore()

const now = ref(Date.now())
const copied = ref(false)
let ticker = null

const gameId = computed(() => route.params.id)
const game = computed(() => gameStore.game)
const isPlayer = computed(() => gameStore.isPlayer)
const myColor = computed(() => gameStore.myColor)
const opp = computed(() => (myColor.value === 'w' ? 'b' : 'w'))
const flipped = computed(() => myColor.value === 'b')
const myTurn = computed(
  () => game.value?.status === 'playing' && isPlayer.value && game.value.turn === myColor.value,
)
const capturableMandatory = computed(
  () => myTurn.value && game.value.legalMoves.some((m) => m.captured.length > 0),
)

const topColor = computed(() => (flipped.value ? 'w' : 'b'))
const bottomColor = computed(() => (flipped.value ? 'b' : 'w'))

function clockOf(color) {
  const g = game.value
  if (!g?.clocks) return null
  let ms = g.clocks[color]
  if (g.status === 'playing' && g.turn === color) {
    ms -= Math.max(0, now.value - gameStore.receivedAt)
  }
  return Math.max(0, ms)
}

const colorName = (c) => (c === 'w' ? 'Brancas' : 'Pretas')

const statusText = computed(() => {
  const g = game.value
  if (!g) return ''
  if (g.status === 'waiting') return 'À espera de adversário…'
  if (g.status === 'ended') {
    const r = g.result
    const why = REASONS[r.reason] ?? r.reason
    if (!r.winner) return `Empate – ${why}`
    if (isPlayer.value) return `${r.winner === myColor.value ? 'Ganhaste' : 'Perdeste'} – ${why}`
    return `${g.players[r.winner]?.name ?? colorName(r.winner)} venceu – ${why}`
  }
  if (myTurn.value) return capturableMandatory.value ? 'A tua vez – captura obrigatória' : 'A tua vez'
  return `Vez de ${g.players[g.turn]?.name ?? colorName(g.turn)}`
})

onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 250)
  gameStore.enterGame(gameId.value)
})

onUnmounted(() => {
  clearInterval(ticker)
  gameStore.leaveGame()
})

watch(gameId, (id) => {
  if (id) gameStore.enterGame(id)
})

watch(
  () => gameStore.cancelledGameId,
  (id) => {
    if (id && id === gameId.value) router.push({ name: 'lobby' })
  },
)

async function handleMove({ from, path }) {
  await gameStore.sendMove(from, path)
}

async function handleResign() {
  if (confirm('Tens a certeza que queres desistir deste jogo?')) {
    await gameStore.resign()
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
  } catch {
    prompt('Copia esta ligação:', window.location.href)
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
      <Badge :variant="game.mode === 'ranked' ? 'default' : 'secondary'">
        {{ MODE_LABELS[game.mode] }}
      </Badge>
      <Badge variant="outline">{{ timeLabel(game.timeControl) }}</Badge>
      <Badge v-if="!isPlayer" variant="outline"><EyeIcon class="size-3" /> A assistir</Badge>
      <span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <EyeIcon class="size-3" /> {{ game.spectators }}
      </span>
    </template>
  </div>

  <p
    v-if="gameStore.error"
    class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
  >
    {{ gameStore.error }}
  </p>
  <p
    v-if="gameStore.notice"
    class="mb-4 rounded-md border border-amber-400/50 bg-amber-100 px-3 py-2 text-sm text-amber-900"
  >
    {{ gameStore.notice }}
  </p>

  <div v-if="!game && !gameStore.error" class="py-20 text-center text-muted-foreground">
    A carregar jogo…
  </div>

  <div v-if="game" class="grid items-start gap-6 lg:grid-cols-[minmax(0,34rem)_1fr]">
    <div class="space-y-3">
      <PlayerBar
        :color="topColor"
        :player="game.players[topColor]"
        :clock-ms="clockOf(topColor)"
        :is-active-turn="game.status === 'playing' && game.turn === topColor"
      />

      <DamasBoard
        :board="game.board"
        :legal-moves="game.legalMoves"
        :last-move="game.lastMove"
        :flipped="flipped"
        :interactive="myTurn"
        @move="handleMove"
      />

      <PlayerBar
        :color="bottomColor"
        :player="game.players[bottomColor]"
        :clock-ms="clockOf(bottomColor)"
        :is-active-turn="game.status === 'playing' && game.turn === bottomColor"
        :is-me="isPlayer && bottomColor === myColor"
      />
    </div>

    <div class="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle class="text-lg" :class="myTurn ? 'text-sky-700' : ''">
            {{ statusText }}
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <div v-if="game.status === 'waiting' && isPlayer" class="space-y-2">
            <p class="text-sm text-muted-foreground">
              Partilha esta ligação com um amigo ou aguarda alguém no lobby.
            </p>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" @click="copyLink">
                <CopyIcon /> {{ copied ? 'Copiado!' : 'Copiar ligação' }}
              </Button>
              <Button variant="ghost" size="sm" @click="gameStore.cancelGame()">
                <XIcon /> Cancelar jogo
              </Button>
            </div>
          </div>

          <div
            v-if="game.status === 'playing' && isPlayer && game.drawOffer === opp"
            class="flex flex-wrap items-center gap-2 rounded-md border bg-muted px-3 py-2"
          >
            <span class="text-sm">O adversário propôs empate.</span>
            <Button size="sm" @click="gameStore.answerDraw(true)">Aceitar</Button>
            <Button size="sm" variant="outline" @click="gameStore.answerDraw(false)">Recusar</Button>
          </div>

          <p
            v-if="game.status === 'playing' && isPlayer && game.drawOffer === myColor"
            class="text-sm text-muted-foreground"
          >
            Proposta de empate enviada – à espera de resposta.
          </p>

          <div v-if="game.status === 'playing' && isPlayer" class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="!game.canOfferDraw || !!game.drawOffer"
              :title="
                game.canOfferDraw
                  ? ''
                  : 'Apenas com 8 ou menos peças e pelo menos uma dama de cada lado'
              "
              @click="gameStore.offerDraw()"
            >
              <HandshakeIcon /> Propor empate
            </Button>
            <Button variant="destructive" size="sm" @click="handleResign">
              <FlagIcon /> Desistir
            </Button>
          </div>

          <div v-if="game.status === 'ended'" class="flex gap-2">
            <Button size="sm" as-child>
              <RouterLink :to="{ name: 'lobby' }">Voltar ao lobby</RouterLink>
            </Button>
          </div>
        </CardContent>
      </Card>

      <MoveHistory :history="game.history" />
    </div>
  </div>
</template>
