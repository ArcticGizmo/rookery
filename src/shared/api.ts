/**
 * Contract for the API surface the preload script exposes on `window.rookery`.
 * Kept in `shared` so both the preload (implementer) and the renderer (consumer)
 * depend on the same definition. Grows into the full typed IPC contract in Phase 1.
 */
export interface RookeryApi {
  /** Liveness check used by the Phase 0 skeleton. */
  ping: () => string
}
