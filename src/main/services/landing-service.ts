import { type LandRunInput, landRunInputSchema } from '@shared/domain'
import type { LandingResult, LandingTarget, LandingTargets } from '@shared/landing'
import type { AuditLog } from './audit-log'
import { instanceNameForRun } from './infra'
import type { InfraService } from './infra-service'
import type { RunStore } from './run-store'
import type { WorkItemService } from './work-item-service'
import type { LandingProvider, LandingSpec } from './landing'

/**
 * Run-facing wrapper over a `LandingProvider` (Phase 6.4). Resolves which repos
 * of a successful run can be landed (from its live worktrees), turns a human's
 * per-repo PR/merge decision into an audited operation
 * (`run.landing_started`/`run.landed`/`run.landing_failed`), and centralizes the
 * "not landable yet" and "no provider configured" degradations. Holds no git
 * logic itself — that lives behind the provider.
 */
export class LandingService {
  constructor(
    private readonly provider: LandingProvider | null,
    private readonly audit: AuditLog,
    private readonly infra: InfraService,
    private readonly workItems: WorkItemService,
    private readonly runs: RunStore
  ) {}

  isConfigured(): boolean {
    return this.provider !== null
  }

  providerName(): string {
    return this.provider?.name ?? 'none'
  }

  /**
   * Which repos of a run can be landed. A run is landable only once it has
   * completed successfully and still has live, provisioned worktrees (the work
   * was done inside them); otherwise `canLand` is false with a reason.
   */
  async targets(runId: string): Promise<LandingTargets> {
    const provider = this.providerName()
    const unavailable = (reason: string): LandingTargets => ({
      runId,
      provider,
      providerAvailable: false,
      canLand: false,
      reason,
      targets: []
    })

    const run = await this.runs.get(runId)
    if (!run) return unavailable('Run not found.')
    if (run.status !== 'passed') {
      return unavailable('Landing is available once the run has completed successfully.')
    }

    const rc = await this.runs.getContext(runId)
    if (!rc?.infraTemplate) {
      return unavailable(
        'This run provisioned no infrastructure, so there are no worktrees to land.'
      )
    }
    if (!this.infra.isConfigured()) return unavailable('No infrastructure provider is configured.')

    const instanceName = instanceNameForRun(runId)
    const instance = await this.infra.info(instanceName).catch(() => null)
    if (!instance) {
      return unavailable('The run’s infrastructure has been torn down; there is nothing to land.')
    }

    const detail = await this.workItems.get(rc.workItemId)
    const repoByName = new Map((detail?.repos ?? []).map((r) => [r.name, r]))
    const landedRepos = await this.landedRepos(runId)

    const targets: LandingTarget[] = instance.worktrees.map((w) => {
      const repo = repoByName.get(w.repo)
      return {
        repo: w.repo,
        worktreePath: w.path,
        localPath: repo?.localPath ?? '',
        branch: w.branch ?? instanceName,
        base: w.base ?? 'main',
        remoteUrl: repo?.remoteUrl ?? null,
        landed: landedRepos.has(w.repo)
      }
    })

    return {
      runId,
      provider,
      providerAvailable: this.provider ? await this.provider.available() : false,
      canLand: true,
      reason: null,
      targets
    }
  }

  /** Land one repo of a run via the chosen method, auditing the outcome. */
  async land(raw: LandRunInput): Promise<LandingResult> {
    const input = landRunInputSchema.parse(raw)
    const provider = this.provider
    if (!provider) throw new Error('No landing provider is configured.')

    const resolved = await this.targets(input.runId)
    if (!resolved.canLand) throw new Error(resolved.reason ?? 'This run cannot be landed.')
    const target = resolved.targets.find((t) => t.repo === input.repo)
    if (!target) throw new Error(`Repo "${input.repo}" is not part of this run’s infrastructure.`)

    if (!(await provider.available())) {
      throw new Error(`Landing provider "${provider.name}" is not available on this machine.`)
    }

    const detail = await this.workItems.get((await this.runs.getContext(input.runId))!.workItemId)
    const spec: LandingSpec = {
      runId: input.runId,
      repo: target.repo,
      method: input.method,
      worktreePath: target.worktreePath,
      localPath: target.localPath,
      branch: target.branch,
      base: target.base,
      remoteUrl: target.remoteUrl,
      title: input.title || detail?.workItem.title || `Land ${target.branch}`,
      body: input.body || `Landing ${target.branch} from Rookery run ${input.runId}.`
    }

    await this.emit({
      type: 'run.landing_started',
      actor: 'human',
      runId: input.runId,
      payload: { runId: input.runId, repo: target.repo, method: input.method, by: input.by }
    })

    try {
      const result =
        input.method === 'pr' ? await provider.openPr(spec) : await provider.merge(spec)
      await this.emit({
        type: 'run.landed',
        actor: 'human',
        runId: input.runId,
        payload: {
          runId: input.runId,
          repo: result.repo,
          method: result.method,
          prUrl: result.prUrl,
          mergedInto: result.mergedInto,
          detail: result.detail,
          by: input.by
        }
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.emit({
        type: 'run.landing_failed',
        actor: 'system',
        runId: input.runId,
        payload: { runId: input.runId, repo: target.repo, method: input.method, message }
      })
      throw error
    }
  }

  /** Repos already landed in this run (from the log), so the UI can mark them. */
  private async landedRepos(runId: string): Promise<Set<string>> {
    const events = await this.audit.list({ runId, type: 'run.landed', limit: 1000 })
    return new Set(events.map((e) => String((e.payload as { repo?: string }).repo ?? '')))
  }

  private async emit(event: Parameters<AuditLog['append']>[0]): Promise<void> {
    try {
      await this.audit.append(event)
    } catch (error) {
      console.error('Failed to append landing event:', error)
    }
  }
}
