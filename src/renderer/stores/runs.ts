import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GateActionInput, Run, RunDetail, StartRunInput } from '@shared/domain'

export const useRunsStore = defineStore('runs', () => {
  const items = ref<Run[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await window.rookery.runs.list()
    } finally {
      loading.value = false
    }
  }

  function get(runId: string): Promise<RunDetail | null> {
    return window.rookery.runs.get(runId)
  }

  async function start(input: StartRunInput): Promise<Run> {
    const run = await window.rookery.runs.start(input)
    await load()
    return run
  }

  function gate(input: GateActionInput): Promise<void> {
    return window.rookery.runs.gate(input)
  }

  return { items, loading, load, get, start, gate }
})
