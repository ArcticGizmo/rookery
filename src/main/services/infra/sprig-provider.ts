import { execFile } from 'node:child_process'
import type { InfraInstance, InfraInstanceSpec, InfraInstanceState } from '@shared/infra'
import { type InfraProvider, InfraToolingMissingError } from './infra-provider'

/** Result of one sprig CLI invocation. */
export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/** Flights the sprig CLI. Injected so the provider is unit-testable without sprig. */
export type SprigCli = (args: string[]) => Promise<CliResult>

const INSTALL_HINT = 'sprig CLI not found on PATH. Install it: npm i -g @ArcticGizmo/sprig'

/** Default runner: spawns the real `sprig` binary. */
const defaultCli: SprigCli = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      'sprig',
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        if (err && err.code === 'ENOENT') {
          reject(new InfraToolingMissingError(INSTALL_HINT))
          return
        }
        // execFile reports a non-zero exit as an error whose `code` is the numeric
        // exit status; a clean exit gives a null error.
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    )
  })

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function mapState(infra: unknown): InfraInstanceState {
  return infra === 'up' || infra === 'down' ? infra : 'unknown'
}

/** sprig stores ports as a `{ index: port }` dict; older/other shapes may vary. */
function extractPorts(ports: unknown): number[] {
  const values = Array.isArray(ports)
    ? ports
    : ports && typeof ports === 'object'
      ? Object.values(ports as Record<string, unknown>)
      : []
  return values.filter((v): v is number => typeof v === 'number')
}

/**
 * Maps `sprig instance info --json` (camelCase) to our `InfraInstance`. Tolerant
 * of missing/extra fields so a sprig version bump doesn't hard-fail the mapping.
 */
function mapInstance(json: Record<string, unknown>, fallbackName: string): InfraInstance {
  const repos = Array.isArray(json.repos) ? (json.repos as Record<string, unknown>[]) : []
  return {
    name: str(json.id) || fallbackName,
    template: str(json.template) || null,
    slot: typeof json.slot === 'number' ? json.slot : null,
    state: mapState(json.infra),
    worktrees: repos.map((r) => ({
      repo: str(r.name),
      path: str(r.worktreePath),
      branch: str(r.branch) || null,
      base: str(r.base) || null,
      sourceMissing: Boolean(r.sourceMissing),
      worktreeMissing: Boolean(r.worktreeMissing)
    })),
    containerCount: typeof json.containers === 'number' ? json.containers : 0,
    ports: extractPorts(json.ports)
  }
}

/**
 * `InfraProvider` backed by the `sprig` CLI (Phase 5.2). Every mutating call is
 * run non-interactively (`--yes`) so the CLI never blocks on a prompt. Only the
 * read commands (`instance info`) emit JSON; mutating commands are checked by
 * exit code and their human output is surfaced on failure.
 */
export class SprigProvider implements InfraProvider {
  readonly name = 'sprig'

  constructor(private readonly cli: SprigCli = defaultCli) {}

  async available(): Promise<boolean> {
    try {
      // Any exit code means the binary resolved; only a spawn failure means "no".
      await this.cli(['template', 'list', '--json'])
      return true
    } catch {
      return false
    }
  }

  async create(spec: InfraInstanceSpec): Promise<InfraInstance> {
    const args = ['instance', 'create', spec.name, '--template', spec.template]
    if (spec.base) args.push('--base', spec.base)
    if (spec.branch) args.push('--branch', spec.branch)
    args.push('--yes')

    const res = await this.cli(args)
    if (res.code !== 0) {
      throw new Error(
        `sprig create failed (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`
      )
    }
    // `create` brings infra up at the end; read back the live instance.
    const instance = await this.info(spec.name)
    if (!instance) {
      throw new Error(`sprig create reported success but instance "${spec.name}" was not found`)
    }
    return instance
  }

  async up(name: string): Promise<InfraInstance> {
    const res = await this.cli(['instance', 'up', name])
    if (res.code !== 0) {
      throw new Error(`sprig up failed (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
    }
    const instance = await this.info(name)
    if (!instance) throw new Error(`sprig instance "${name}" not found after up`)
    return instance
  }

  async down(name: string): Promise<void> {
    const res = await this.cli(['instance', 'down', name])
    if (res.code !== 0) {
      throw new Error(`sprig down failed (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
    }
  }

  async info(name: string): Promise<InfraInstance | null> {
    const res = await this.cli(['instance', 'info', name, '--json'])
    // A non-zero exit or unparseable output means the instance can't be read
    // (typically: it doesn't exist) — surface that as absence, not a crash.
    if (res.code !== 0) return null
    let json: unknown
    try {
      json = JSON.parse(res.stdout)
    } catch {
      return null
    }
    if (!json || typeof json !== 'object') return null
    return mapInstance(json as Record<string, unknown>, name)
  }

  async status(name: string): Promise<InfraInstanceState> {
    const instance = await this.info(name)
    return instance ? instance.state : 'absent'
  }

  async remove(name: string): Promise<void> {
    const res = await this.cli(['instance', 'remove', name, '--yes'])
    if (res.code !== 0) {
      throw new Error(
        `sprig remove failed (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`
      )
    }
  }
}
