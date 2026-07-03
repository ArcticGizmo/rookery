import type { InfraProvider } from './infra-provider'
import { SprigProvider } from './sprig-provider'
import { StubProvider } from './stub-provider'

export type { InfraProvider } from './infra-provider'
export { InfraToolingMissingError } from './infra-provider'
export { SprigProvider } from './sprig-provider'
export { StubProvider } from './stub-provider'

/**
 * Select the infra provider from config (Phase 5.1). `ROOKERY_INFRA_PROVIDER`:
 * - `sprig` (default) — shell out to the sprig CLI.
 * - `stub` — in-memory fake (no git/docker); for dev without sprig.
 * - `none` — infra disabled; flights that request a template fail the setup stage.
 */
export function createInfraProvider(
  kind = process.env['ROOKERY_INFRA_PROVIDER'] ?? 'sprig'
): InfraProvider | null {
  switch (kind) {
    case 'none':
      return null
    case 'stub':
      return new StubProvider()
    case 'sprig':
    default:
      return new SprigProvider()
  }
}

/**
 * Deterministic instance name for a run. Derived from the run id so the engine
 * and the status IPC agree on the name without persisting it separately. sprig
 * ids must be path-safe, so we strip dashes and take a short, stable prefix.
 */
export function instanceNameForRun(flightId: string): string {
  return `rookery-${flightId.replace(/-/g, '').slice(0, 12)}`
}
