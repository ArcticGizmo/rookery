/**
 * Built-in approach templates. Selecting one in the builder seeds a fresh
 * approach the user can then edit — templates are copied in, never linked, so
 * editing a seeded approach never mutates the template. Kept dependency-light and
 * id-less; `instantiateTemplate` assigns fresh ids at copy time.
 *
 * These are deliberately practical, end-to-end flows (review → plan → setup →
 * implement → verify) that pass `validateApproach` as-is so a seeded approach is
 * immediately runnable.
 */

import type { CheckpointKind, DoneCriterionType, StageType, ApproachDefBody } from './domain'

interface TemplatePersona {
  name: string
  role: string
  systemPrompt: string
  model?: string
  allowedTools?: string[]
}
interface TemplateStage {
  name: string
  type: StageType
  personas?: TemplatePersona[]
  doneCriteria?: { type: DoneCriterionType; description?: string }[]
  checkpoints?: { kind: CheckpointKind; description?: string }[]
}

export interface ApproachTemplate {
  /** Stable template id used by the chooser. */
  id: string
  /** Short label for the chooser button. */
  label: string
  /** One-line description shown in the chooser. */
  description: string
  /** Default name/description seeded into the new approach. */
  approachName: string
  approachDescription: string
  stages: TemplateStage[]
}

/** The read → plan → setup → implement → verify skeleton shared by the templates. */
function standardStages(opts: {
  stack: string
  reviewPrompt: string
  planPrompt: string
  implementPrompt: string
  verifyPrompt: string
}): TemplateStage[] {
  return [
    {
      name: 'Review',
      type: 'review',
      personas: [
        {
          name: 'Tech Lead',
          role: 'Reviewer',
          systemPrompt: opts.reviewPrompt,
          allowedTools: ['Read', 'Grep', 'Glob']
        }
      ],
      // A `review` stage flights read-only, before setup/implement — no code exists
      // yet, so a `reviewer_approves` check (which asks "does this fully satisfy
      // the spec?") can only ever reject and would fail the run at stage one.
      // Defer the call to the human checkpoint instead, exactly as the Plan stage does.
      doneCriteria: [{ type: 'manual' }],
      checkpoints: [{ kind: 'human', description: 'Approve the review before planning' }]
    },
    {
      name: 'Plan',
      type: 'plan',
      personas: [
        {
          name: 'Architect',
          role: 'Planner',
          systemPrompt: opts.planPrompt,
          allowedTools: ['Read', 'Grep', 'Glob']
        }
      ],
      doneCriteria: [{ type: 'manual' }],
      checkpoints: [{ kind: 'human', description: 'Approve the implementation plan' }]
    },
    { name: 'Setup', type: 'setup' },
    {
      name: 'Implement',
      type: 'implementation',
      personas: [
        {
          name: 'Engineer',
          role: 'Implementer',
          systemPrompt: opts.implementPrompt,
          allowedTools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash']
        }
      ],
      doneCriteria: [{ type: 'reviewer_approves' }],
      checkpoints: [{ kind: 'human', description: 'Approve the implementation' }]
    },
    {
      name: 'Verify',
      type: 'verification',
      personas: [
        {
          name: 'QA',
          role: 'Tester',
          systemPrompt: opts.verifyPrompt,
          allowedTools: ['Read', 'Grep', 'Glob', 'Bash']
        }
      ],
      doneCriteria: [{ type: 'tests_pass' }],
      checkpoints: [{ kind: 'human', description: 'Confirm the feature is done' }]
    }
  ]
}

export const WORKFLOW_TEMPLATES: ApproachTemplate[] = [
  {
    id: 'vue',
    label: 'Vue app',
    description: 'Review → plan → implement → verify for a Vue 3 + TypeScript app (Vitest).',
    approachName: 'Vue feature',
    approachDescription: 'Standard flow for a Vue 3 + TypeScript app with a Vitest suite.',
    stages: standardStages({
      stack: 'vue',
      reviewPrompt:
        'You are a senior Vue 3 + TypeScript engineer. Review the spec and the affected code ' +
        '(components, composables, router, Pinia stores) for clarity, feasibility, and edge ' +
        'cases. Be specific and concise.',
      planPrompt:
        'Produce a short, concrete, phased implementation plan for the change in this Vue 3 ' +
        'app. Call out the components, composables, stores, and tests to touch.',
      implementPrompt:
        'Implement the approved plan in this Vue 3 + TypeScript codebase. Follow existing ' +
        'conventions, keep changes focused, and add or update Vitest tests as needed.',
      verifyPrompt:
        'Verify the feature and run the Vitest suite (e.g. `pnpm test`). Report any failures ' +
        'precisely.'
    })
  },
  {
    id: 'dotnet',
    label: '.NET service',
    description: 'Review → plan → implement → verify for a C# / .NET service (dotnet test).',
    approachName: '.NET feature',
    approachDescription: 'Standard flow for a C# / .NET service with an xUnit/NUnit test suite.',
    stages: standardStages({
      stack: 'dotnet',
      reviewPrompt:
        'You are a senior C# / .NET engineer. Review the spec and the affected code ' +
        '(controllers, services, DI registrations, EF models) for clarity, feasibility, and ' +
        'edge cases. Be specific and concise.',
      planPrompt:
        'Produce a short, concrete, phased implementation plan for the change in this .NET ' +
        'service. Call out the projects, classes, interfaces, and tests to touch.',
      implementPrompt:
        'Implement the approved plan in this C# / .NET codebase. Follow existing conventions, ' +
        'keep changes focused, and add or update unit tests. Build with `dotnet build`.',
      verifyPrompt:
        'Verify the feature and run the test suite with `dotnet test`. Report any failures ' +
        'precisely.'
    })
  }
]

/**
 * Copy a template into a fresh, editable approach body, assigning new ids to every
 * stage, persona, criterion, and checkpoint. `uid` is injectable for testing; it
 * defaults to `crypto.randomUUID` (present in the renderer and Node ≥ 19).
 */
export function instantiateTemplate(
  template: ApproachTemplate,
  uid: () => string = () => crypto.randomUUID()
): ApproachDefBody {
  return {
    name: template.approachName,
    description: template.approachDescription,
    stages: template.stages.map((stage) => ({
      id: uid(),
      name: stage.name,
      type: stage.type,
      personas: (stage.personas ?? []).map((p) => ({
        id: uid(),
        name: p.name,
        role: p.role,
        systemPrompt: p.systemPrompt,
        model: p.model ?? '',
        ...(p.allowedTools ? { allowedTools: p.allowedTools } : {})
      })),
      doneCriteria: (stage.doneCriteria ?? []).map((c) => ({
        id: uid(),
        type: c.type,
        description: c.description ?? ''
      })),
      checkpoints: (stage.checkpoints ?? []).map((g) => ({
        id: uid(),
        kind: g.kind,
        description: g.description ?? ''
      }))
    }))
  }
}
