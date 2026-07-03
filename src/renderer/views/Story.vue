<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { FlightDetail, FlightStatus } from '@shared/domain'
import type { StoredEvent } from '@shared/events'
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

// --- Zoom to detail (J9.2): progressive disclosure of each beat ------------

// Which nodes are zoomed open (keyed by the source event id). New Sets so Vue
// reliably re-renders on toggle.
const zoomed = ref<Set<number>>(new Set())
function toggleZoom(id: number): void {
  const next = new Set(zoomed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  zoomed.value = next
}

/** A one-line, human reading of a nested granular event. */
function granularLine(event: StoredEvent): string {
  const p = (event.payload ?? {}) as Record<string, unknown>
  const s = (v: unknown): string => String(v ?? '')
  const clip = (v: unknown, n = 200): string => {
    const str = s(v)
    return str.length > n ? `${str.slice(0, n)}…` : str
  }
  switch (event.type) {
    case 'agent.message':
      return `${p.subagentType ? `[${s(p.subagentType)}] ` : ''}${clip(p.text)}`
    case 'agent.tool_use':
      return `🔧 ${s(p.toolName)}`
    case 'agent.tool_result':
      return `↳ ${p.isError ? 'tool error' : 'tool result'}: ${clip(p.content)}`
    case 'agent.task':
      return `🧵 task ${s(p.phase)}${p.summary ? `: ${clip(p.summary)}` : ''}`
    case 'agent.permission_denied':
      return `⛔ denied ${s(p.toolName)}: ${clip(p.reason)}`
    case 'agent.finished':
      return `■ agent finished${p.isError ? ' (error)' : ''}`
    case 'agent.usage':
      return `tokens · ${s(p.inputTokens)} in / ${s(p.outputTokens)} out`
    case 'agent.context_pressure':
      return `context ${Math.round(Number(p.percent))}% · ${s(p.level)}`
    case 'flight.criterion_evaluated':
      return `${p.passed ? '✓' : '✗'} ${s(p.criterionType)}${p.detail ? `: ${clip(p.detail)}` : ''}`
    default:
      return event.type
  }
}

// The raw event payload, pretty-printed — the same drill-down History offers.
function pretty(payload: unknown): string {
  return JSON.stringify(payload, null, 2)
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

            <!-- Zoom to detail (J9.2): the granular messages + raw event payload. -->
            <button
              type="button"
              class="mt-1.5 text-xs text-primary hover:underline"
              @click="toggleZoom(node.id)"
            >
              {{
                zoomed.has(node.id)
                  ? '▾ hide detail'
                  : node.children.length
                    ? `▸ zoom in (${node.children.length})`
                    : '▸ raw event'
              }}
            </button>

            <div v-if="zoomed.has(node.id)" class="mt-2 flex flex-col gap-2">
              <!-- The granular activity that unfolded under this beat. -->
              <ul
                v-if="node.children.length"
                class="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-2"
              >
                <li
                  v-for="child in node.children"
                  :key="child.id"
                  class="whitespace-pre-wrap px-3 py-1.5 text-xs text-muted-foreground"
                >
                  {{ granularLine(child) }}
                </li>
              </ul>
              <!-- The raw event payload — the same truth History drills into. -->
              <div class="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3">
                <span class="mono-label text-ink-faint">raw event #{{ node.id }}</span>
                <pre class="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{{ pretty(node.payload) }}</pre>
              </div>
            </div>
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
