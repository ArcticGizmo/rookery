import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentPersona, PermissionMode } from '@shared/domain'

export interface MappingContext {
  cwd?: string | null
  permissionMode: PermissionMode
}

/**
 * Hard permission backstop for orchestrated agents (Phase 5 security pass).
 * `deny` rules always win over `allow`, so these primitives stay blocked even
 * when a persona's allow-list or permission mode would otherwise permit them —
 * the exfiltration / privilege-escalation / host-escape vectors from the security
 * analysis. Making this configurable per persona is deferred (see plan §6, Q8).
 */
export const SECURITY_DENY_RULES = [
  'Bash(curl:*)',
  'Bash(wget:*)',
  'Bash(ssh:*)',
  'Bash(scp:*)',
  'Bash(sftp:*)',
  'Bash(sudo:*)',
  'Bash(nc:*)',
  'Bash(ncat:*)',
  'Bash(telnet:*)',
  'Bash(docker:*)',
  'Bash(git push:*)',
  'WebFetch'
]

/** Tools removed outright for every orchestrated agent (network egress vector). */
const SECURITY_DISALLOWED_TOOLS = ['WebFetch']

/**
 * Map an `AgentPersona` (+ run context) to Claude Agent SDK `query()` options
 * (Phase 3.3). Only fields the persona actually specifies are set, so unknown
 * or empty configs degrade gracefully to the SDK's own defaults — except for the
 * security & audit hardening at the bottom, which is applied to every run.
 */
export function mapPersonaToOptions(persona: AgentPersona, ctx: MappingContext): Options {
  const options: Options = {}

  const systemPrompt = persona.systemPrompt?.trim()
  if (systemPrompt) options.systemPrompt = systemPrompt

  if (persona.model) options.model = persona.model
  if (persona.effort) options.effort = persona.effort

  if (persona.allowedTools && persona.allowedTools.length > 0) {
    options.allowedTools = persona.allowedTools
  }
  // Union the persona's disallowed tools with the security backstop (deduped).
  options.disallowedTools = [
    ...new Set([...(persona.disallowedTools ?? []), ...SECURITY_DISALLOWED_TOOLS])
  ]
  if (persona.mcpServers && Object.keys(persona.mcpServers).length > 0) {
    // BYO MCP: passed through verbatim; the SDK validates server shapes.
    options.mcpServers = persona.mcpServers as Options['mcpServers']
  }

  if (ctx.cwd) options.cwd = ctx.cwd

  options.permissionMode = ctx.permissionMode
  if (ctx.permissionMode === 'bypassPermissions') {
    // Only set when explicitly requested; not a default (see flight-engine).
    options.allowDangerouslySkipPermissions = true
  }

  // --- Security & audit hardening (applied to every orchestrated agent) ---
  // 1. Don't inherit the user's global ~/.claude settings — their personal
  //    permission grants / MCP servers must not silently widen our agents.
  options.settingSources = []
  // 2. Hard deny backstop (deny > allow), reliable across settings tiers.
  options.settings = { permissions: { deny: SECURITY_DENY_RULES } }
  // 3. Forward subagent text/thinking so nested and backgrounded agents are fully
  //    captured in the audit log, not just their tool calls (default is false).
  options.forwardSubagentText = true

  return options
}
