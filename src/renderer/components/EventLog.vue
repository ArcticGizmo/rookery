<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { computeVirtualWindow } from '@shared/virtual-window'
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

// --- Virtualization (Phase 7.4) ---
// Only the rows in (and just around) the viewport are rendered, so a log of
// thousands of events keeps a small, constant number of DOM nodes.
const ROW_HEIGHT = 33
const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

const win = computed(() =>
  computeVirtualWindow({
    count: filtered.value.length,
    rowHeight: ROW_HEIGHT,
    scrollTop: scrollTop.value,
    viewportHeight: viewportHeight.value
  })
)
const windowed = computed(() => filtered.value.slice(win.value.startIndex, win.value.endIndex))

function onScroll(): void {
  if (scroller.value) scrollTop.value = scroller.value.scrollTop
}

function measure(): void {
  if (scroller.value) viewportHeight.value = scroller.value.clientHeight
}

/** Whether the view is scrolled to (near) the bottom — drives live tailing. */
function atBottom(): boolean {
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2
}

let stick = true

function scrollToBottom(): void {
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  scrollTop.value = el.scrollTop
}

// Follow the tail as new events stream in, but only while the user is already
// at the bottom — so scrolling up to read history isn't yanked back down.
watch(
  () => filtered.value.length,
  () => {
    if (!stick) return
    void nextTick(scrollToBottom)
  }
)

function handleScroll(): void {
  onScroll()
  stick = atBottom()
}

const resizeObserver =
  typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString()
}

onMounted(async () => {
  await store.init()
  await nextTick()
  measure()
  if (scroller.value && resizeObserver) resizeObserver.observe(scroller.value)
  scrollToBottom()
})

onBeforeUnmount(() => resizeObserver?.disconnect())
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
      <div v-else ref="scroller" class="max-h-[70vh] overflow-y-auto" @scroll="handleScroll">
        <!-- Full-height spacer keeps the scrollbar sized for every row; only the
             windowed slice is rendered, offset into place. -->
        <div :style="{ height: `${win.totalHeight}px`, position: 'relative' }">
          <ul
            class="absolute inset-x-0 top-0 divide-y divide-border"
            :style="{ transform: `translateY(${win.offsetY}px)` }"
          >
            <li
              v-for="event in windowed"
              :key="event.id"
              class="flex items-center gap-3 px-4 text-sm"
              :style="{ height: `${ROW_HEIGHT}px` }"
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
              <span class="truncate font-mono">{{ event.type }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>
