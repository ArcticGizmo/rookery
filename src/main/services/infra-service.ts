import type { InfraInstance, InfraInstanceSpec } from '@shared/infra'
import type { InfraProvider } from './infra/infra-provider'
import type { AuditLog } from './audit-log'

/** Options for tearing a run's infra down. */
export interface TeardownOptions {
  /** Also `remove` the instance (worktrees + branches), not just stop infra. */
  remove: boolean
}

/**
 * Run-facing wrapper over an `InfraProvider` (Phase 5.3/5.4). Turns provisioning
 * and teardown into audited operations (`infra.provisioning`/`up`/`down`/`failed`)
 * and centralizes the "no provider configured" degradation so the engine stays
 * simple. Holds no docker/git logic itself — that lives behind the provider.
 */
export class InfraService {
  constructor(
    private readonly provider: InfraProvider | null,
    private readonly audit: AuditLog
  ) {}

  isConfigured(): boolean {
    return this.provider !== null
  }

  providerName(): string {
    return this.provider?.name ?? 'none'
  }

  available(): Promise<boolean> {
    return this.provider ? this.provider.available() : Promise.resolve(false)
  }

  info(name: string): Promise<InfraInstance | null> {
    return this.provider ? this.provider.info(name) : Promise.resolve(null)
  }

  /**
   * Provision worktrees + infra for a run, auditing each step. Throws (after
   * emitting `infra.failed`) when no provider is configured, its tooling is
   * missing, or the provider errors — the caller fails the setup stage.
   */
  async provision(runId: string, spec: InfraInstanceSpec): Promise<InfraInstance> {
    const provider = this.provider
    await this.emit(runId, {
      type: 'infra.provisioning',
      actor: 'system',
      payload: {
        runId,
        provider: this.providerName(),
        instanceName: spec.name,
        template: spec.template
      }
    })

    if (!provider) {
      const message = 'No infra provider is configured (ROOKERY_INFRA_PROVIDER=none)'
      await this.fail(runId, spec.name, message)
      throw new Error(message)
    }

    try {
      if (!(await provider.available())) {
        throw new Error(`Infra provider "${provider.name}" is not available on this machine`)
      }
      const instance = await provider.create(spec)
      await this.emit(runId, {
        type: 'infra.up',
        actor: 'system',
        payload: {
          runId,
          provider: provider.name,
          instanceName: instance.name,
          worktrees: instance.worktrees.map((w) => ({
            repo: w.repo,
            path: w.path,
            branch: w.branch
          })),
          ports: instance.ports,
          containerCount: instance.containerCount
        }
      })
      return instance
    } catch (error) {
      await this.fail(runId, spec.name, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /**
   * Tear a run's infra down. Best-effort and idempotent: a no-op when there is
   * no provider or the instance is already gone; failures are audited, not
   * thrown, so teardown never masks the run's own outcome.
   */
  async teardown(runId: string, name: string, options: TeardownOptions): Promise<void> {
    const provider = this.provider
    if (!provider) return
    try {
      const existed = (await provider.info(name)) !== null
      if (!existed) return
      await provider.down(name)
      if (options.remove) await provider.remove(name)
      await this.emit(runId, {
        type: 'infra.down',
        actor: 'system',
        payload: { runId, provider: provider.name, instanceName: name, removed: options.remove }
      })
    } catch (error) {
      await this.fail(runId, name, error instanceof Error ? error.message : String(error))
    }
  }

  private fail(runId: string, instanceName: string, message: string): Promise<void> {
    return this.emit(runId, {
      type: 'infra.failed',
      actor: 'system',
      payload: { runId, provider: this.providerName(), instanceName, message }
    })
  }

  private async emit(runId: string, event: Parameters<AuditLog['append']>[0]): Promise<void> {
    try {
      await this.audit.append({ ...event, runId })
    } catch (error) {
      console.error('Failed to append infra event:', error)
    }
  }
}
