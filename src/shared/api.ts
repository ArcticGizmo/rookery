import type { ListEventsOptions, StoredEvent } from './events'

/**
 * The API surface the preload script exposes on `window.rookery`. Both the
 * preload (implementer) and the renderer (consumer) depend on this definition.
 */
export interface RookeryApi {
  /** Liveness check routed through IPC to the main process. */
  ping: () => Promise<string>
  events: {
    /** Fetch persisted events (optionally incremental via `afterId`). */
    list: (options?: ListEventsOptions) => Promise<StoredEvent[]>
    /** Subscribe to events as they are appended. Returns an unsubscribe fn. */
    onAppend: (listener: (event: StoredEvent) => void) => () => void
  }
}
