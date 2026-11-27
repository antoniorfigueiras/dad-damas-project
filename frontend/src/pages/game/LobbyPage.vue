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
import {
  socket, emitAck, becomeGuest, restoreGuest, guestName,
  TIME_CONTROLS, timeLabel, MODE_LABELS,
} from '@/lib/gameClient'

const router = useRouter()
const socketStore = useSocketStore()

const games = ref([])
const error = ref('')
const busy = ref(false)

// who am I?
const loggedUser = computed(() => socketStore.currentUser)
const myName = computed(() => loggedUser.value?.name ?? guestName.value)
const guestInput = ref(guestName.value ?? '')

// new game form
const mode = ref('casual')
const color = ref('random')
const timeIndex = ref(1)
const isPublic = ref(true)
const stake = ref(10)
const botLevel = ref(2)

const waitingGames = computed(() => games.value.filter((g) => g.status === 'waiting'))
const liveGames = computed(() => games.value.filter((g) => g.status === 'playing' && g.isPublic))

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

function onLobby(list) {
  games.value = list
}

async function enterLobby() {
  await restoreGuest()
  await emitAck('game:lobby')
}

onMounted(() => {
  socket.on('game:lobby', onLobby)
  socket.on('connect', enterLobby)
  enterLobby()
})

onUnmounted(() => {
  socket.off('game:lobby', onLobby)
  socket.off('connect', enterLobby)
  socket.emit('game:lobby-leave')
})

async function playAsGuest() {
  error.value = ''
  const res = await becomeGuest(guestInput.value)
  if (!res.ok) error.value = res.error
}

async function createGame() {
  error.value = ''
  busy.value = true
  const res = await emitAck('game:create', {
    mode: mode.value,
    color: color.value,
    isPublic: isPublic.value,
    stake: Number(stake.value),
    botLevel: Number(botLevel.value),
    timeControl: TIME_CONTROLS[timeIndex.value].value,
  })
  busy.value = false
  if (!res.ok) return (error.value = res.error)
  router.push({ name: 'game', params: { id: res.gameId } })
}

function openGame(id) {
  router.push({ name: 'game', params: { id } })
}

const playerName = (p) => (p ? p.name : '…')
</script>

<template>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h2 class="text-2xl font-semibold">Play Checkers</h2>
      <p class="text-sm text-muted-foreground">Create a game, join one, or watch a live match.</p>
    </div>
    <Badge :variant="socketStore.isConnected ? 'default' : 'destructive'">
      {{ socketStore.isConnected ? 'Connected' : 'Disconnected' }}
    </Badge>
  </div>

  <p v-if="error" class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
    {{ error }}
  </p>

  <div class="grid items-start gap-6 md:grid-cols-[20rem_1fr]">
    <!-- left: identity + new game -->
    <div class="space-y-6">
      <Card v-if="!myName">
        <CardHeader>
          <CardTitle>Who are you?</CardTitle>
          <CardDescription>
            <RouterLink to="/laravel" class="underline">Log in</RouterLink> for ranked games, or play casually as a guest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form class="flex gap-2" @submit.prevent="playAsGuest">
            <Input v-model="guestInput" placeholder="Guest name" maxlength="20" />
            <Button type="submit">Go</Button>
          </form>
        </CardContent>
      </Card>

      <Card v-else>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <UserIcon class="size-4" /> {{ myName }}
            <Badge v-if="!loggedUser" variant="secondary">Guest</Badge>
          </CardTitle>
          <CardDescription>New game</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" @submit.prevent="createGame">
            <div class="space-y-2">
              <Label for="mode">Mode</Label>
              <select id="mode" v-model="mode" :class="selectClass">
                <option value="casual">Casual</option>
                <option value="ranked" :disabled="!loggedUser">Ranked {{ loggedUser ? '' : '(log in)' }}</option>
                <option value="bot">Practice vs Bot</option>
              </select>
            </div>

            <div class="space-y-2">
              <Label for="color">Play as</Label>
              <select id="color" v-model="color" :class="selectClass">
                <option value="random">Random</option>
                <option value="w">White (moves first)</option>
                <option value="b">Black</option>
              </select>
            </div>

            <div v-if="mode === 'bot'" class="space-y-2">
              <Label for="level">Bot level</Label>
              <select id="level" v-model="botLevel" :class="selectClass">
                <option :value="1">1 – Beginner</option>
                <option :value="2">2 – Easy</option>
                <option :value="3">3 – Medium</option>
                <option :value="4">4 – Hard</option>
              </select>
            </div>

            <template v-else>
              <div class="space-y-2">
                <Label for="time">Time (minutes + seconds per move)</Label>
                <select id="time" v-model="timeIndex" :class="selectClass">
                  <option v-for="(tc, i) in TIME_CONTROLS" :key="tc.label" :value="i">{{ tc.label }}</option>
                </select>
              </div>

              <div v-if="mode === 'ranked'" class="space-y-2">
                <Label for="stake">Entry fee (coins)</Label>
                <Input id="stake" v-model="stake" type="number" min="1" />
              </div>

              <label v-if="mode === 'casual'" class="flex items-center gap-2 text-sm">
                <input v-model="isPublic" type="checkbox" class="size-4" />
                Public (others can watch)
              </label>
            </template>

            <Button type="submit" class="w-full" :disabled="busy || !socketStore.isConnected">
              <PlusIcon /> Create game
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>

    <!-- right: open + live games -->
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2"><SwordsIcon class="size-4" /> Open games</CardTitle>
          <CardDescription>Waiting for an opponent.</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="!waitingGames.length" class="text-sm text-muted-foreground">
            No open games right now. Create one!
          </p>
          <ul v-else class="divide-y">
            <li v-for="g in waitingGames" :key="g.id" class="flex items-center gap-3 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ playerName(g.players.w ?? g.players.b) }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ timeLabel(g.timeControl) }}
                  · you play {{ g.players.w ? 'Black' : 'White' }}
                  <template v-if="g.mode === 'ranked'"> · {{ g.stake }} coins</template>
                </p>
              </div>
              <Badge :variant="g.mode === 'ranked' ? 'default' : 'secondary'">
                <TrophyIcon v-if="g.mode === 'ranked'" class="size-3" /> {{ MODE_LABELS[g.mode] }}
              </Badge>
              <Button size="sm" :disabled="!myName || (g.mode === 'ranked' && !loggedUser)" @click="openGame(g.id)">
                <PlayIcon /> Join
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2"><EyeIcon class="size-4" /> Live games</CardTitle>
          <CardDescription>Public games you can watch.</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="!liveGames.length" class="text-sm text-muted-foreground">Nobody is playing right now.</p>
          <ul v-else class="divide-y">
            <li v-for="g in liveGames" :key="g.id" class="flex items-center gap-3 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">
                  {{ playerName(g.players.w) }} <span class="text-muted-foreground">vs</span> {{ playerName(g.players.b) }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ timeLabel(g.timeControl) }} · {{ g.spectators }} watching
                </p>
              </div>
              <Badge :variant="g.mode === 'ranked' ? 'default' : 'secondary'">{{ MODE_LABELS[g.mode] }}</Badge>
              <Button size="sm" variant="outline" @click="openGame(g.id)"><EyeIcon /> Watch</Button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <p class="flex items-center gap-2 text-xs text-muted-foreground">
        <BotIcon class="size-3" /> Games against the bot are private and don't show up here.
      </p>
    </div>
  </div>
</template>
