import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgentRunConfig, CredentialStatus } from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

export const useAgentStore = defineStore('agent', () => {
  const credentials = ref<CredentialStatus | null>(null)
  const activeFlightId = ref<string | null>(null)

  async function checkCredentials(): Promise<void> {
    credentials.value = await rookery().agent.credentials()
  }

  async function start(config: AgentRunConfig): Promise<string> {
    const { agentRunId } = await rookery().agent.start(config)
    activeFlightId.value = agentRunId
    return agentRunId
  }

  async function cancel(): Promise<void> {
    if (activeFlightId.value) await rookery().agent.cancel(activeFlightId.value)
  }

  return { credentials, activeFlightId, checkCredentials, start, cancel }
})
