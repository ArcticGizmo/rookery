import { describe, expect, it } from 'vitest'
import { detectCredentials } from '../../src/main/agent/credentials'

const noFile = () => false

describe('detectCredentials', () => {
  it('prefers ANTHROPIC_API_KEY', () => {
    expect(detectCredentials({ ANTHROPIC_API_KEY: 'sk-x' }, noFile)).toEqual({
      available: true,
      source: 'ANTHROPIC_API_KEY'
    })
  })

  it('recognizes the auth token and oauth token', () => {
    expect(detectCredentials({ ANTHROPIC_AUTH_TOKEN: 't' }, noFile).source).toBe(
      'ANTHROPIC_AUTH_TOKEN'
    )
    expect(detectCredentials({ CLAUDE_CODE_OAUTH_TOKEN: 't' }, noFile).source).toBe(
      'CLAUDE_CODE_OAUTH_TOKEN'
    )
  })

  it('detects the Claude Code credentials file when no env var is set', () => {
    const result = detectCredentials({ CLAUDE_CONFIG_DIR: '/cfg' }, (p) =>
      p.replace(/\\/g, '/').endsWith('/cfg/.credentials.json')
    )
    expect(result).toEqual({ available: true, source: 'claude-code-oauth' })
  })

  it('reports unavailable when nothing resolves', () => {
    expect(detectCredentials({}, noFile)).toEqual({ available: false, source: null })
  })
})
