import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentPersona, PermissionMode } from '@shared/domain'

export interface MappingContext {
  cwd?: string | null
  permissionMode: PermissionMode
}

/**
 * Map an `AgentPersona` (+ run context) to Claude Agent SDK `query()` options
 * (Phase 3.3). Only fields the persona actually specifies are set, so unknown
 * or empty configs degrade gracefully to the SDK's own defaults.
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
  if (persona.disallowedTools && persona.disallowedTools.length > 0) {
    options.disallowedTools = persona.disallowedTools
  }
  if (persona.mcpServers && Object.keys(persona.mcpServers).length > 0) {
    // BYO MCP: passed through verbatim; the SDK validates server shapes.
    options.mcpServers = persona.mcpServers as Options['mcpServers']
  }

  if (ctx.cwd) options.cwd = ctx.cwd

  options.permissionMode = ctx.permissionMode
  if (ctx.permissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true
  }

  return options
}
