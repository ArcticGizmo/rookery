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

  function init(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      events.value = await window.rookery.events.list({ limit: 500 })
      loaded.value = true
      unsubscribe = window.rookery.events.onAppend((event) => {
        events.value = [...events.value, event]
      })
    })()
    return initPromise
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    initPromise = null
  }

  return { events, loaded, init, dispose }
})
