import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StoredEvent } from '@shared/events'

export const useEventsStore = defineStore('events', () => {
  const events = ref<StoredEvent[]>([])
  const loaded = ref(false)
  let unsubscribe: (() => void) | null = null
  // A shared promise so concurrent callers (the app shell + a route view both
  // mounting on startup) initialize exactly once — otherwise each would subscribe
  // and every event would be appended twice.
  let initPromise: Promise<void> | null = null

  // Live-stream events are coalesced per animation frame (Phase 7.4). A long run
  // emits events in bursts; committing each one individually would reallocate the
  // whole array and re-run every event-derived projection (activity, notifications)
  // once per event — O(n²) over a run. Buffering and flushing once per frame keeps
  // reactivity churn bounded no matter how fast events arrive.
  let pending: StoredEvent[] = []
  let flushHandle: number | null = null

  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback): number => setTimeout(() => cb(0), 16) as unknown as number
  const cancel =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (handle: number): void => clearTimeout(handle)

  function flush(): void {
    flushHandle = null
    if (pending.length === 0) return
    // One reallocation for the whole batch instead of one per event.
    events.value = events.value.concat(pending)
    pending = []
  }

  function scheduleFlush(): void {
    if (flushHandle !== null) return
    flushHandle = schedule(flush)
  }

  function init(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      events.value = await window.rookery.events.list({ limit: 500 })
      loaded.value = true
      unsubscribe = window.rookery.events.onAppend((event) => {
        pending.push(event)
        scheduleFlush()
      })
    })()
    return initPromise
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    initPromise = null
    if (flushHandle !== null) {
      cancel(flushHandle)
      flushHandle = null
    }
    pending = []
  }

  return { events, loaded, init, dispose }
})
