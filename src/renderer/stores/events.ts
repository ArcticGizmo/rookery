import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StoredEvent } from '@shared/events'

export const useEventsStore = defineStore('events', () => {
  const events = ref<StoredEvent[]>([])
  const loaded = ref(false)
  let unsubscribe: (() => void) | null = null

  async function init(): Promise<void> {
    if (unsubscribe) return
    events.value = await window.rookery.events.list({ limit: 500 })
    loaded.value = true
    unsubscribe = window.rookery.events.onAppend((event) => {
      events.value = [...events.value, event]
    })
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  return { events, loaded, init, dispose }
})
