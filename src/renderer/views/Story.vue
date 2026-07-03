<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { FlightDetail, FlightStatus } from '@shared/domain'
import { type StoryLane, buildStory } from '@shared/story'
import { MonoLabel } from '@renderer/components/journey'
import { useScopedEvents } from '@renderer/composables/use-scoped-events'
import { useFlightsStore } from '@renderer/stores/flights'
import { useBriefsStore } from '@renderer/stores/briefs'

// The story of a change (J9.1): the append-only log told as a narrative,
// separating what you decided from what the rooks did from what the system
// recorded. A pure projection (`buildStory`) over this flight's events —
// zoom-to-detail (J9.2) and the landing recap (J9.3) land on top of it later.
const props = defineProps<{ id: string }>()
const flightsStore = useFlightsStore()
const briefsStore = useBriefsStore()

const { events, loaded } = useScopedEvents(
  () => ({ flightId: props.id }),
  (event) => event.flightId === props.id
)

const detail = ref<FlightDetail | null>(null)
const briefTitle = ref('')

async function refresh(): Promise<void> {
  const d = await flightsStore.get(props.id)
  detail.value = d
  if (d) {
    const brief = await briefsStore.get(d.flight.briefId)
    briefTitle.value = brief?.brief.title ?? d.approach.name
  }
}

watch(() => props.id, refresh, { immediate: true })

const story = computed(() => buildStory(events.value))

const STATUS_LABEL: Record<FlightStatus, string> = {
  pending: 'pending',
  running: 'in flight',
  awaiting_checkpoint: 'paused for you',
  passed: 'landed',
  failed: 'failed',
  cancelled: 'cancelled'
}

// Lane colour, straight from the mockup: you → beacon, rooks → accent, system → faint.
const LANE_CLASS: Record<StoryLane, string> = {
  you: 'text-beacon',
  rooks: 'text-primary',
  system: 'text-ink-faint'
}

function when(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <header class="flex items-start justify-between gap-4">
      <MonoLabel class="text-primary">The story</MonoLabel>
      <div class="flex items-center gap-4 text-sm">
        <RouterLink :to="`/flight/${props.id}`" class="text-muted-foreground hover:underline">
          The flight →
        </RouterLink>
        <RouterLink to="/" class="text-muted-foreground hover:underline">← Desk</RouterLink>
      </div>
    </header>

    <div v-if="detail" class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight text-balance">{{ briefTitle }}</h1>
      <p class="text-sm text-muted-foreground">
        via {{ detail.approach.name }} · {{ STATUS_LABEL[detail.flight.status] }}
      </p>
    </div>

    <!-- The timeline: same append-only events, told as a journey. -->
    <section class="rounded-xl border border-border bg-card px-5 py-2">
      <p v-if="loaded && !story.length" class="py-8 text-center text-sm text-muted-foreground">
        Nothing to tell yet — this flight's story begins once it takes off.
      </p>
      <ol v-else class="flex flex-col">
        <li
          v-for="node in story"
          :key="node.id"
          class="grid grid-cols-[68px_1fr] gap-4 border-b border-border py-3.5 last:border-b-0"
        >
          <span class="mono-label pt-0.5 tabular-nums text-ink-faint">{{ when(node.ts) }}</span>
          <div class="min-w-0">
            <div class="mono-label mb-1" :class="LANE_CLASS[node.lane]">{{ node.actorLabel }}</div>
            <p class="text-sm text-ink">{{ node.title }}</p>
            <p v-if="node.detail" class="mt-0.5 break-words text-xs text-ink-dim">{{ node.detail }}</p>
          </div>
        </li>
      </ol>
    </section>

    <RouterLink
      :to="`/history?flightId=${props.id}`"
      class="self-start text-xs text-muted-foreground hover:underline"
    >
      Full activity log →
    </RouterLink>
  </div>
</template>
