import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { emitAck, socket } from '@/lib/gameClient'

const GUEST_STORAGE_KEY = 'damas-guest'

function randomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function readSavedGuest() {
  try {
    return JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY)) || null
  } catch {
    return null
  }
}

export const useGameStore = defineStore('game', () => {
  // Identidade de convidado
  const guestName = ref(readSavedGuest()?.name ?? null)

  // Lobby
  const lobbyGames = ref([])
  const inLobby = ref(false)

  // Jogo ativo
  const activeGameId = ref(null)
  const game = ref(null)
  const myColor = ref(null)
  const receivedAt = ref(0)
  const error = ref('')
  const notice = ref('')
  const cancelledGameId = ref(null)

  const waitingGames = computed(() => lobbyGames.value.filter((g) => g.status === 'waiting'))
  const liveGames = computed(() =>
    lobbyGames.value.filter((g) => g.status === 'playing' && g.isPublic),
  )
  const isPlayer = computed(() => myColor.value !== null)

  // ---------- Convidados ----------
  async function becomeGuest(name) {
    error.value = ''
    const guest = readSavedGuest() || { guestId: randomId() }
    guest.name = name?.trim() || guest.name
    const res = await emitAck('game:guest', guest)
    if (res.ok) {
      guest.name = res.name
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest))
      guestName.value = res.name
    } else {
      error.value = res.error
    }
    return res
  }

  function restoreGuest() {
    const guest = readSavedGuest()
    return guest ? emitAck('game:guest', guest) : Promise.resolve({ ok: false })
  }

  // ---------- Lobby ----------
  async function joinLobby() {
    inLobby.value = true
    await restoreGuest()
    await emitAck('game:lobby')
  }

  function leaveLobby() {
    inLobby.value = false
    socket.emit('game:lobby-leave')
  }

  async function createGame(options) {
    error.value = ''
    const res = await emitAck('game:create', options)
    if (!res.ok) error.value = res.error
    return res
  }

  // ---------- Jogo ativo ----------
  async function enterGame(gameId) {
    activeGameId.value = gameId
    cancelledGameId.value = null
    error.value = ''
    notice.value = ''
    await restoreGuest()

    const joined = await emitAck('game:join', { gameId })
    if (joined.ok) {
      myColor.value = joined.color
    } else {
      myColor.value = null
      const watched = await emitAck('game:spectate', { gameId })
      if (!watched.ok) {
        error.value = watched.error
        return watched
      }
    }

    const res = await emitAck('game:get', { gameId })
    if (res.ok) {
      applyState(res.game)
    } else {
      error.value = res.error
    }
    return res
  }

  function leaveGame() {
    if (activeGameId.value && !isPlayer.value) {
      socket.emit('game:spectate-leave', { gameId: activeGameId.value })
    }
    activeGameId.value = null
    game.value = null
    myColor.value = null
    notice.value = ''
    error.value = ''
  }

  function applyState(state) {
    if (state.id !== activeGameId.value) return
    game.value = state
    receivedAt.value = Date.now()
  }

  async function sendMove(from, path) {
    error.value = ''
    const res = await emitAck('game:move', { gameId: activeGameId.value, from, path })
    if (!res.ok) error.value = res.error
    return res
  }

  async function resign() {
    error.value = ''
    const res = await emitAck('game:resign', { gameId: activeGameId.value })
    if (!res.ok) error.value = res.error
    return res
  }

  async function offerDraw() {
    error.value = ''
    const res = await emitAck('game:draw-offer', { gameId: activeGameId.value })
    if (!res.ok) error.value = res.error
    else if (res.accepted === false) error.value = 'O bot recusou a proposta de empate.'
    return res
  }

  async function answerDraw(accept) {
    error.value = ''
    const res = await emitAck('game:draw-answer', { gameId: activeGameId.value, accept })
    if (!res.ok) error.value = res.error
    return res
  }

  async function cancelGame() {
    error.value = ''
    const res = await emitAck('game:cancel', { gameId: activeGameId.value })
    if (!res.ok) error.value = res.error
    return res
  }

  // ---------- Listeners Socket.IO (registados uma única vez na store) ----------
  socket.on('connect', () => {
    if (inLobby.value) joinLobby()
    else if (activeGameId.value) enterGame(activeGameId.value)
    else if (readSavedGuest()) restoreGuest()
  })

  socket.on('game:lobby', (list) => {
    lobbyGames.value = list
  })

  socket.on('game:state', (state) => {
    applyState(state)
  })

  socket.on('game:ended', ({ gameId }) => {
    if (gameId === activeGameId.value) notice.value = ''
  })

  socket.on('game:player-away', ({ gameId, color, graceMs }) => {
    if (gameId !== activeGameId.value) return
    const who =
      color === myColor.value
        ? 'Foste'
        : `${game.value?.players[color]?.name ?? 'O adversário'} foi`
    notice.value = `${who} desconectado — perde por abandono se não regressar em ${Math.round(graceMs / 1000)} s.`
  })

  socket.on('game:player-back', ({ gameId }) => {
    if (gameId === activeGameId.value) notice.value = ''
  })

  socket.on('game:cancelled', ({ gameId }) => {
    if (gameId === activeGameId.value) {
      cancelledGameId.value = gameId
    }
  })

  socket.on('game:error', ({ gameId, error: msg }) => {
    if (gameId === activeGameId.value) error.value = msg
  })

  return {
    guestName,
    lobbyGames,
    waitingGames,
    liveGames,
    game,
    myColor,
    isPlayer,
    receivedAt,
    error,
    notice,
    cancelledGameId,
    becomeGuest,
    restoreGuest,
    joinLobby,
    leaveLobby,
    createGame,
    enterGame,
    leaveGame,
    sendMove,
    resign,
    offerDraw,
    answerDraw,
    cancelGame,
  }
})
