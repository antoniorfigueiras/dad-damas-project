<script setup>
import { computed } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const props = defineProps({
  history: { type: Array, default: () => [] },
})

const moveRows = computed(() => {
  const out = []
  for (let i = 0; i < props.history.length; i += 2) {
    out.push({ n: i / 2 + 1, w: props.history[i], b: props.history[i + 1] ?? '' })
  }
  return out
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Lances</CardTitle>
    </CardHeader>
    <CardContent>
      <p v-if="!moveRows.length" class="text-sm text-muted-foreground">
        Ainda sem lances. As Brancas começam.
      </p>
      <ol v-else class="max-h-72 overflow-y-auto font-mono text-sm">
        <li
          v-for="row in moveRows"
          :key="row.n"
          class="grid grid-cols-[2.5rem_1fr_1fr] py-0.5 odd:bg-muted/50"
        >
          <span class="pl-1 text-muted-foreground">{{ row.n }}.</span>
          <span>{{ row.w }}</span>
          <span>{{ row.b }}</span>
        </li>
      </ol>
    </CardContent>
  </Card>
</template>
