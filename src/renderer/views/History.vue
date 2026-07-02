<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { EventActor, ListEventsOptions, StoredEvent } from '@shared/events'
import { rookery } from '@renderer/lib/rookery'

const PAGE_SIZE = 100

const actor = ref<'' | EventActor>('')
const type = ref('')
const runId = ref('')
const search = ref('')
const since = ref('')
const until = ref('')

const results = ref<StoredEvent[]>([])
const loading = ref(false)
const hasMore = ref(false)
const expandedId = ref<number | null>(null)

/** Convert a `datetime-local` value to a UTC ISO string, or undefined if blank/invalid. */
function toIso(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function baseOptions(): ListEventsOptions {
  return {
    order: 'desc',
    limit: PAGE_SIZE,
    actor: actor.value || undefined,
    type: type.value.trim() || undefined,
    runId: runId.value.trim() || undefined,
    search: search.value.trim() || undefined,
    since: toIso(since.value),
    until: toIso(until.value)
  }
}

async function query(): Promise<void> {
  loading.value = true
  try {
    const rows = await rookery().events.list(baseOptions())
    results.value = rows
    hasMore.value = rows.length === PAGE_SIZE
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  const oldest = results.value[results.value.length - 1]
  if (!oldest) return
  loading.value = true
  try {
    const rows = await rookery().events.list({ ...baseOptions(), beforeId: oldest.id })
    results.value = [...results.value, ...rows]
    hasMore.value = rows.length === PAGE_SIZE
  } finally {
    loading.value = false
  }
}

function toggle(id: number): void {
  expandedId.value = expandedId.value === id ? null : id
}

function pretty(payload: unknown): string {
  return JSON.stringify(payload, null, 2)
}

/** Work item id for a spec event, so we can link to its diff viewer. */
function specWorkItemId(event: StoredEvent): string | null {
  if (event.type !== 'spec.version_created') return null
  const p = event.payload as { workItemId?: string }
  return p.workItemId ?? null
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString()
}

const ACTOR_CLASS: Record<string, string> = {
  system: 'bg-secondary text-secondary-foreground',
  human: 'bg-blue-500/15 text-blue-700',
  agent: 'bg-purple-500/15 text-purple-700'
}

// Re-query when filters change (debounced so typing doesn't spam the DB).
let timer: ReturnType<typeof setTimeout> | null = null
watch([actor, type, runId, search, since, until], () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void query(), 250)
})

onMounted(() => void query())
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">History</h1>
      <p class="text-sm text-muted-foreground">
        Search and filter the full audit log; expand any event for its full payload.
      </p>
    </header>

    <!-- Filters -->
    <section class="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium" for="f-actor">Actor</label>
        <select
          id="f-actor"
          v-model="actor"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Any</option>
          <option value="system">system</option>
          <option value="human">human</option>
          <option value="agent">agent</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium" for="f-type">Type prefix</label>
        <input
          id="f-type"
          v-model="type"
          type="text"
          placeholder="e.g. agent. or run.stage_"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium" for="f-run">Run id</label>
        <input
          id="f-run"
          v-model="runId"
          type="text"
          placeholder="Exact run id"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
      <div class="flex flex-col gap-1 sm:col-span-3">
        <label class="text-xs font-medium" for="f-search">Search</label>
        <input
          id="f-search"
          v-model="search"
          type="text"
          placeholder="Substring across type and payload…"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium" for="f-since">Since</label>
        <input
          id="f-since"
          v-model="since"
          type="datetime-local"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium" for="f-until">Until</label>
        <input
          id="f-until"
          v-model="until"
          type="datetime-local"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
    </section>

    <!-- Results -->
    <div class="rounded-md border border-border">
      <p v-if="loading && results.length === 0" class="p-4 text-sm text-muted-foreground">
        Loading…
      </p>
      <p v-else-if="results.length === 0" class="p-4 text-sm text-muted-foreground">
        No events match these filters.
      </p>
      <ul v-else class="divide-y divide-border">
        <li v-for="event in results" :key="event.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-accent"
            @click="toggle(event.id)"
          >
            <span class="w-14 shrink-0 tabular-nums text-muted-foreground">#{{ event.id }}</span>
            <span class="w-40 shrink-0 tabular-nums text-xs text-muted-foreground">
              {{ formatTime(event.ts) }}
            </span>
            <span
              class="w-16 shrink-0 rounded px-2 py-0.5 text-center text-xs"
              :class="ACTOR_CLASS[event.actor]"
            >
              {{ event.actor }}
            </span>
            <span class="flex-1 font-mono">{{ event.type }}</span>
            <RouterLink
              v-if="event.runId"
              :to="`/runs/${event.runId}`"
              class="shrink-0 text-xs text-muted-foreground hover:underline"
              @click.stop
            >
              run {{ event.runId.slice(0, 8) }}
            </RouterLink>
          </button>
          <div v-if="expandedId === event.id" class="border-t border-border bg-muted/30 px-4 py-3">
            <div v-if="specWorkItemId(event)" class="mb-2">
              <RouterLink
                :to="`/work-items/${specWorkItemId(event)}`"
                class="text-xs text-blue-700 hover:underline"
              >
                View spec version history &amp; diff →
              </RouterLink>
            </div>
            <div class="overflow-x-auto">
              <pre class="text-xs">{{ pretty(event.payload) }}</pre>
            </div>
          </div>
        </li>
      </ul>
      <div v-if="hasMore" class="border-t border-border p-3 text-center">
        <button
          type="button"
          class="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </div>
  </div>
</template>
