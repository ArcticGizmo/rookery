<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventsStore } from '@renderer/stores/events'

const store = useEventsStore()
const { events, loaded } = storeToRefs(store)
const filter = ref('')

const filtered = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (!query) return events.value
  return events.value.filter(
    (event) => event.type.toLowerCase().includes(query) || event.actor.toLowerCase().includes(query)
  )
})

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString()
}

onMounted(() => {
  void store.init()
})
</script>

<template>
  <section class="flex w-full max-w-3xl flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Event log</h2>
      <input
        v-model="filter"
        type="text"
        placeholder="Filter by type or actor…"
        class="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>

    <div class="rounded-md border border-border">
      <p v-if="loaded && filtered.length === 0" class="p-4 text-sm text-muted-foreground">
        No events yet.
      </p>
      <ul v-else class="divide-y divide-border">
        <li
          v-for="event in filtered"
          :key="event.id"
          class="flex items-center gap-3 px-4 py-2 text-sm"
        >
          <span class="w-12 shrink-0 tabular-nums text-muted-foreground">#{{ event.id }}</span>
          <span class="w-24 shrink-0 tabular-nums text-muted-foreground">
            {{ formatTime(event.ts) }}
          </span>
          <span
            class="w-16 shrink-0 rounded bg-secondary px-2 py-0.5 text-center text-xs text-secondary-foreground"
          >
            {{ event.actor }}
          </span>
          <span class="font-mono">{{ event.type }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
