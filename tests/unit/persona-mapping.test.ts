import { describe, expect, it } from 'vitest'
import type { AgentPersona } from '../../src/shared/domain'
import { SECURITY_DENY_RULES, mapPersonaToOptions } from '../../src/main/agent/persona-mapping'

function persona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: 'p1',
    name: 'Reviewer',
    role: 'Reviewer',
    systemPrompt: 'Review the code.',
    ...overrides
  }
}

describe('mapPersonaToOptions', () => {
  it('maps the core persona fields', () => {
    const opts = mapPersonaToOptions(persona({ model: 'claude-opus-4-8', effort: 'high' }), {
      cwd: 'C:/git/api',
      permissionMode: 'plan'
    })
    expect(opts.systemPrompt).toBe('Review the code.')
    expect(opts.model).toBe('claude-opus-4-8')
    expect(opts.effort).toBe('high')
    expect(opts.cwd).toBe('C:/git/api')
    expect(opts.permissionMode).toBe('plan')
  })

  it('omits empty/unset fields (graceful degradation)', () => {
    const opts = mapPersonaToOptions(persona({ systemPrompt: '   ' }), { permissionMode: 'plan' })
    expect(opts.systemPrompt).toBeUndefined()
    expect(opts.model).toBeUndefined()
    expect(opts.effort).toBeUndefined()
    expect(opts.allowedTools).toBeUndefined()
    expect(opts.mcpServers).toBeUndefined()
    expect(opts.cwd).toBeUndefined()
  })

  it('passes through BYO tools and MCP servers', () => {
    const opts = mapPersonaToOptions(
      persona({
        allowedTools: ['Read', 'Grep'],
        disallowedTools: ['Bash'],
        mcpServers: { db: { command: 'node', args: ['s.js'] } }
      }),
      { permissionMode: 'plan' }
    )
    expect(opts.allowedTools).toEqual(['Read', 'Grep'])
    // The security backstop is unioned into the persona's disallowed tools.
    expect(opts.disallowedTools).toEqual(['Bash', 'WebFetch'])
    expect(opts.mcpServers).toEqual({ db: { command: 'node', args: ['s.js'] } })
  })

  it('sets the dangerous-skip flag only in bypass mode', () => {
    expect(
      mapPersonaToOptions(persona(), { permissionMode: 'bypassPermissions' })
        .allowDangerouslySkipPermissions
    ).toBe(true)
    expect(
      mapPersonaToOptions(persona(), { permissionMode: 'plan' }).allowDangerouslySkipPermissions
    ).toBeUndefined()
  })

  describe('security & audit hardening', () => {
    it('isolates from the user global settings and never inherits them', () => {
      const opts = mapPersonaToOptions(persona(), { permissionMode: 'plan' })
      expect(opts.settingSources).toEqual([])
    })

    it('applies the deny backstop to every agent', () => {
      const opts = mapPersonaToOptions(persona(), { permissionMode: 'acceptEdits' })
      expect(opts.settings?.permissions?.deny).toEqual(SECURITY_DENY_RULES)
      // Spot-check the highest-signal primitives are present.
      for (const rule of ['Bash(curl:*)', 'Bash(docker:*)', 'Bash(git push:*)', 'WebFetch']) {
        expect(opts.settings?.permissions?.deny).toContain(rule)
      }
    })

    it('always disallows network egress tools even with no persona config', () => {
      const opts = mapPersonaToOptions(persona(), { permissionMode: 'plan' })
      expect(opts.disallowedTools).toContain('WebFetch')
    })

    it('forwards subagent text so nested agents are auditable', () => {
      const opts = mapPersonaToOptions(persona(), { permissionMode: 'plan' })
      expect(opts.forwardSubagentText).toBe(true)
    })
  })
})
