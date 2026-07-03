import { posix } from 'node:path'
import type { InfraInstance, InfraInstanceSpec, InfraInstanceState } from '@shared/infra'
import type { InfraProvider } from './infra-provider'

/**
 * An in-memory `InfraProvider` (Phase 5) that fabricates worktrees + infra state
 * without touching git or docker. Backs unit tests and infra-free local dev
 * (`ROOKERY_INFRA_PROVIDER=stub`), so the setup-stage wiring and run view can be
 * exercised end-to-end without sprig or docker installed.
 */
export class StubProvider implements InfraProvider {
  readonly name = 'stub'
  private readonly instances = new Map<string, InfraInstance>()
  private slotCounter = 0

  /** `baseDir` roots the fabricated worktree paths; `defaultRepos` is used when a
   * spec carries no repo hint. */
  constructor(
    private readonly baseDir = '/tmp/rookery-stub',
    private readonly defaultRepos = ['repo']
  ) {}

  available(): Promise<boolean> {
    return Promise.resolve(true)
  }

  create(spec: InfraInstanceSpec): Promise<InfraInstance> {
    const repos = spec.repos && spec.repos.length > 0 ? spec.repos : this.defaultRepos
    const branch = spec.branch ?? spec.name
    const instance: InfraInstance = {
      name: spec.name,
      template: spec.template,
      slot: this.slotCounter++,
      state: 'up',
      worktrees: repos.map((repo) => ({
        repo,
        path: posix.join(this.baseDir, spec.name, repo),
        branch,
        base: spec.base ?? 'HEAD',
        sourceMissing: false,
        worktreeMissing: false
      })),
      containerCount: repos.length,
      ports: repos.map((_, i) => 5000 + (instanceSlotBase(this.slotCounter - 1) + i))
    }
    this.instances.set(spec.name, instance)
    return Promise.resolve(instance)
  }

  up(name: string): Promise<InfraInstance> {
    const instance = this.require(name)
    instance.state = 'up'
    return Promise.resolve(instance)
  }

  down(name: string): Promise<void> {
    const instance = this.instances.get(name)
    if (instance) {
      instance.state = 'down'
      instance.containerCount = 0
    }
    return Promise.resolve()
  }

  info(name: string): Promise<InfraInstance | null> {
    return Promise.resolve(this.instances.get(name) ?? null)
  }

  status(name: string): Promise<InfraInstanceState> {
    return Promise.resolve(this.instances.get(name)?.state ?? 'absent')
  }

  remove(name: string): Promise<void> {
    this.instances.delete(name)
    return Promise.resolve()
  }

  private require(name: string): InfraInstance {
    const instance = this.instances.get(name)
    if (!instance) throw new Error(`stub instance "${name}" not found`)
    return instance
  }
}

/** Simple per-slot port offset so fabricated instances don't overlap ports. */
function instanceSlotBase(slot: number): number {
  return slot * 100
}
