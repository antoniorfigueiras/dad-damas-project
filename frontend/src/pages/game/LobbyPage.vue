<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BotIcon, EyeIcon, PlayIcon, PlusIcon, SwordsIcon, TrophyIcon, UserIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSocketStore } from '@/stores/socket'
import { useGameStore } from '@/stores/game'
import { TIME_CONTROLS, timeLabel, MODE_LABELS } from '@/lib/gameClient'

const router = useRouter()
const socketStore = useSocketStore()
const gameStore = useGameStore()

const busy = ref(false)
const loggedUser = computed(() => socketStore.currentUser)
const myName = computed(() => loggedUser.value?.name ?? gameStore.guestName)
const guestInput = ref(gameStore.guestName ?? '')

const mode = ref('casual')
const color = ref('random')
const timeIndex = ref(1)
const isPublic = ref(true)
const botLevel = ref(2)

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

onMounted(() => {
  gameStore.joinLobby()
})

onUnmounted(() => {
  gameStore.leaveLobby()
})

async function playAsGuest() {
  await gameStore.becomeGuest(guestInput.value)
}

async function createGame() {
  busy.value = true
  const res = await gameStore.createGame({
    mode: mode.value,
    color: color.value,
    isPublic: isPublic.value,
    botLevel: Number(botLevel.value),
    timeControl: TIME_CONTROLS[timeIndex.value].value,
  })
  busy.value = false
  if (res.ok) router.push({ name: 'game', params: { id: res.gameId } })
}

function openGame(id) {
  router.push({ name: 'game', params: { id } })
}

const playerName = (p) => (p ? p.name : '…')
</script>

<template>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h2 class="text-2xl font-semibold">Jogar Damas Portuguesas</h2>
      <p class="text-sm text-muted-foreground">
        Cria um jogo, entra numa partida aberta ou assiste a um jogo ao vivo.
      </p>
    </div>
    <Badge :variant="socketStore.isConnected ? 'default' : 'destructive'">
      {{ socketStore.isConnected ? 'Ligado' : 'Desligado' }}
    </Badge>
  </div>

  <p
    v-if="gameStore.error"
    class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
  >
    {{ gameStore.error }}
  </p>

  <div class="grid items-start gap-6 md:grid-cols-[20rem_1fr]">
    <div class="space-y-6">
      <Card v-if="!myName">
        <CardHeader>
          <CardTitle>Quem és?</CardTitle>
          <CardDescription>
            <RouterLink to="/laravel" class="underline">Inicia sessão</RouterLink> para jogos
            competitivos, ou joga em modo casual como convidado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form class="flex gap-2" @submit.prevent="playAsGuest">
            <Input v-model="guestInput" placeholder="Nome de convidado" maxlength="20" />
            <Button type="submit">Entrar</Button>
          </form>
        </CardContent>
      </Card>

      <Card v-else>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <UserIcon class="size-4" /> {{ myName }}
            <Badge v-if="!loggedUser" variant="secondary">Convidado</Badge>
          </CardTitle>
          <CardDescription>Novo jogo</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" @submit.prevent="createGame">
            <div class="space-y-2">
              <Label for="mode">Modo</Label>
              <select id="mode" v-model="mode" :class="selectClass">
                <option value="casual">Casual</option>
                <option value="ranked" :disabled="!loggedUser">
                  Competitivo {{ loggedUser ? '' : '(iniciar sessão)' }}
                </option>
                <option value="bot">Treinar contra Bot</option>
              </select>
            </div>

            <div class="space-y-2">
              <Label for="color">Jogar com</Label>
              <select id="color" v-model="color" :class="selectClass">
                <option value="random">Aleatório</option>
                <option value="w">Brancas (jogam primeiro)</option>
                <option value="b">Pretas</option>
              </select>
            </div>

            <div v-if="mode === 'bot'" class="space-y-2">
              <Label for="level">Nível do Bot</Label>
              <select id="level" v-model="botLevel" :class="selectClass">
                <option :value="1">1 – Principiante</option>
                <option :value="2">2 – Fácil</option>
                <option :value="3">3 – Médio</option>
                <option :value="4">4 – Difícil</option>
              </select>
            </div>

            <template v-else>
              <div class="space-y-2">
                <Label for="time">Tempo (minutos + segundos por lance)</Label>
                <select id="time" v-model="timeIndex" :class="selectClass">
                  <option v-for="(tc, i) in TIME_CONTROLS" :key="tc.label" :value="i">
                    {{ tc.label }}
                  </option>
                </select>
              </div>

              <label v-if="mode === 'casual'" class="flex items-center gap-2 text-sm">
                <input v-model="isPublic" type="checkbox" class="size-4" />
                Público (outros podem assistir)
              </label>
            </template>

            <Button type="submit" class="w-full" :disabled="busy || !socketStore.isConnected">
              <PlusIcon /> Criar jogo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>

    <div class="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <SwordsIcon class="size-4" /> Jogos abertos
          </CardTitle>
          <CardDescription>À espera de adversário.</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="!gameStore.waitingGames.length" class="text-sm text-muted-foreground">
            Não há jogos abertos de momento. Cria um!
          </p>
          <ul v-else class="divide-y">
            <li
              v-for="g in gameStore.waitingGames"
              :key="g.id"
              class="flex items-center gap-3 py-3"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ playerName(g.players.w ?? g.players.b) }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ timeLabel(g.timeControl) }}
                  · jogas de {{ g.players.w ? 'Pretas' : 'Brancas' }}
                </p>
              </div>
              <Badge :variant="g.mode === 'ranked' ? 'default' : 'secondary'">
                <TrophyIcon v-if="g.mode === 'ranked'" class="size-3" /> {{ MODE_LABELS[g.mode] }}
              </Badge>
              <Button
                size="sm"
                :disabled="!myName || (g.mode === 'ranked' && !loggedUser)"
                @click="openGame(g.id)"
              >
                <PlayIcon /> Entrar
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <EyeIcon class="size-4" /> Jogos ao vivo
          </CardTitle>
          <CardDescription>Jogos públicos a que podes assistir.</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="!gameStore.liveGames.length" class="text-sm text-muted-foreground">
            Ninguém está a jogar neste momento.
          </p>
          <ul v-else class="divide-y">
            <li v-for="g in gameStore.liveGames" :key="g.id" class="flex items-center gap-3 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">
                  {{ playerName(g.players.w) }}
                  <span class="text-muted-foreground">vs</span>
                  {{ playerName(g.players.b) }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ timeLabel(g.timeControl) }} · {{ g.spectators }} a assistir
                </p>
              </div>
              <Badge :variant="g.mode === 'ranked' ? 'default' : 'secondary'">
                {{ MODE_LABELS[g.mode] }}
              </Badge>
              <Button size="sm" variant="outline" @click="openGame(g.id)">
                <EyeIcon /> Assistir
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <p class="flex items-center gap-2 text-xs text-muted-foreground">
        <BotIcon class="size-3" /> Jogos contra o bot são privados e não aparecem aqui.
      </p>
    </div>
  </div>
</template>
