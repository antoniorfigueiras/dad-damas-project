<script setup>
import { Badge } from '@/components/ui/badge'
import { formatClock } from '@/lib/gameClient'

defineProps({
  color: { type: String, required: true },
  player: { type: Object, default: null },
  clockMs: { type: Number, default: null },
  isActiveTurn: { type: Boolean, default: false },
  isMe: { type: Boolean, default: false },
})
</script>

<template>
  <div class="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
    <div class="flex items-center gap-2">
      <span
        class="size-4 rounded-full border"
        :class="color === 'w' ? 'bg-stone-50' : 'bg-stone-900'"
      />
      <span class="font-medium">{{ player?.name ?? 'À espera…' }}</span>
      <Badge v-if="isMe" variant="secondary">tu</Badge>
      <Badge v-if="player && !player.connected" variant="destructive">ausente</Badge>
    </div>
    <span
      v-if="clockMs !== null"
      class="rounded px-2 py-0.5 font-mono text-lg tabular-nums"
      :class="isActiveTurn ? 'bg-primary text-primary-foreground' : 'bg-muted'"
    >
      {{ formatClock(clockMs) }}
    </span>
  </div>
</template>
