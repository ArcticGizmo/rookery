import { describe, expect, it } from 'vitest'
import type { AgentPersona } from '../../src/shared/domain'
import { mapPersonaToOptions } from '../../src/main/agent/persona-mapping'

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
    expect(opts.disallowedTools).toEqual(['Bash'])
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
})
