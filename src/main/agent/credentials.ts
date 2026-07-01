import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CredentialStatus } from '@shared/domain'

/**
 * Detect whether Agent SDK credentials resolve (Phase 3.1) — without making a
 * request and without storing any token ourselves. Checks the env vars the SDK
 * (and the CLI subprocess it spawns) honor, then the Claude Code OAuth
 * credentials file. The authoritative source is the `apiKeySource` on a run's
 * init event; this is the pre-flight check that drives the "please log in"
 * banner.
 */
export function detectCredentials(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync
): CredentialStatus {
  if (env['ANTHROPIC_API_KEY']) return { available: true, source: 'ANTHROPIC_API_KEY' }
  if (env['ANTHROPIC_AUTH_TOKEN']) return { available: true, source: 'ANTHROPIC_AUTH_TOKEN' }
  if (env['CLAUDE_CODE_OAUTH_TOKEN']) return { available: true, source: 'CLAUDE_CODE_OAUTH_TOKEN' }

  const configDir = env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
  if (fileExists(join(configDir, '.credentials.json'))) {
    return { available: true, source: 'claude-code-oauth' }
  }
  return { available: false, source: null }
}
