import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CheckpointActionInput, Run, RunDetail, StartRunInput } from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

export const useRunsStore = defineStore('runs', () => {
  const items = ref<Run[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await rookery().runs.list()
    } finally {
      loading.value = false
    }
  }

  function get(runId: string): Promise<RunDetail | null> {
    return rookery().runs.get(runId)
  }

  async function start(input: StartRunInput): Promise<Run> {
    const run = await rookery().runs.start(input)
    await load()
    return run
  }

  function checkpoint(input: CheckpointActionInput): Promise<void> {
    return rookery().runs.checkpoint(input)
  }

  async function cancel(runId: string): Promise<void> {
    await rookery().runs.cancel(runId)
    await load()
  }

  return { items, loading, load, get, start, checkpoint, cancel }
})
