import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgentRunConfig, CredentialStatus } from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

export const useAgentStore = defineStore('agent', () => {
  const credentials = ref<CredentialStatus | null>(null)
  const activeRunId = ref<string | null>(null)

  async function checkCredentials(): Promise<void> {
    credentials.value = await rookery().agent.credentials()
  }

  async function start(config: AgentRunConfig): Promise<string> {
    const { agentRunId } = await rookery().agent.start(config)
    activeRunId.value = agentRunId
    return agentRunId
  }

  async function cancel(): Promise<void> {
    if (activeRunId.value) await rookery().agent.cancel(activeRunId.value)
  }

  return { credentials, activeRunId, checkCredentials, start, cancel }
})
