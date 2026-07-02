import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { ListEventsOptions, StoredEvent } from '@shared/events'

/** Page size for backfilling a scope's history. */
const PAGE_SIZE = 500

export interface ScopedEvents {
  /** The scope's events, chronological (ascending id). */
  events: Ref<StoredEvent[]>
  /** True once the initial backfill has completed. */
  loaded: Ref<boolean>
  /** Re-run the backfill (e.g. when the scope changes). */
  reload: () => Promise<void>
}

/**
 * Load and live-tail a scoped slice of the audit log directly from the backend
 * (Phase 7 follow-up). Unlike the shared events store — whose in-memory buffer is
 * seeded with only a slice of the log and grows from live appends — this pages
 * through *all* of a scope's events on demand, so a view can show a run's full
 * history even after a restart, when those events were never streamed into the
 * shared store.
 *
 * `options()` supplies the backend filter (e.g. `{ runId }`); `matches()` decides
 * which live appends belong to this scope. Both are called lazily so a changing
 * scope (a route param) stays correct across {@link reload}.
 *
 * Ordering/dedup: the backfill and the live stream can overlap, so events are
 * keyed by id. Appends that arrive during the backfill are buffered and merged;
 * once loaded, live appends (always the newest ids) are appended directly.
 */
export function useScopedEvents(
  options: () => ListEventsOptions,
  matches: (event: StoredEvent) => boolean
): ScopedEvents {
  const events = ref<StoredEvent[]>([])
  const loaded = ref(false)

  let seen = new Set<number>()
  let buffered: StoredEvent[] = []
  let loading = false
  let unsubscribe: (() => void) | null = null

  async function reload(): Promise<void> {
    loaded.value = false
    loading = true
    seen = new Set<number>()
    buffered = []

    // Page through the whole scope oldest-first via an id cursor.
    const collected: StoredEvent[] = []
    let afterId = 0
    for (;;) {
      const page = await window.rookery.events.list({
        ...options(),
        order: 'asc',
        afterId,
        limit: PAGE_SIZE
      })
      collected.push(...page)
      if (page.length < PAGE_SIZE) break
      afterId = page[page.length - 1]!.id
    }

    // Merge in any live events captured while paging, then go live.
    for (const event of collected) seen.add(event.id)
    for (const event of buffered) {
      if (!seen.has(event.id)) {
        seen.add(event.id)
        collected.push(event)
      }
    }
    collected.sort((a, b) => a.id - b.id)
    buffered = []
    loading = false
    events.value = collected
    loaded.value = true
  }

  onMounted(() => {
    unsubscribe = window.rookery.events.onAppend((event) => {
      if (!matches(event)) return
      if (loading) {
        buffered.push(event)
        return
      }
      if (seen.has(event.id)) return
      seen.add(event.id)
      // Live events always carry the highest ids, so appending keeps order.
      events.value = [...events.value, event]
    })
    void reload()
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return { events, loaded, reload }
}
