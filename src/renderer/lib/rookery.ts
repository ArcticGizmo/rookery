import type { RookeryApi } from '@shared/api'

/**
 * The preload bridge (`window.rookery`), or a clear error if it's missing.
 *
 * `window.rookery` is injected by the preload script and only exists inside the
 * real Electron window. It's `undefined` when the page is opened in a plain
 * browser tab (e.g. the Vite dev URL that electron-vite prints) or a stale
 * window with no preload — in which case every IPC call would otherwise fail
 * with a cryptic `Cannot read properties of undefined (reading 'workItems')`.
 *
 * Routing every renderer→main call through here turns that into an actionable
 * message instead.
 */
export function rookery(): RookeryApi {
  const api = (window as Window & { rookery?: RookeryApi }).rookery
  if (!api) {
    throw new Error(
      'Rookery API unavailable — open the app in the Electron window, not a browser tab.'
    )
  }
  return api
}
