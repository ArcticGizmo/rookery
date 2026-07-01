import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkflowDef, WorkflowDefBody } from '@shared/domain'

export const useWorkflowsStore = defineStore('workflows', () => {
  const items = ref<WorkflowDef[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await window.rookery.workflows.list()
    } finally {
      loading.value = false
    }
  }

  function get(id: string): Promise<WorkflowDef | null> {
    return window.rookery.workflows.get(id)
  }

  async function create(input: WorkflowDefBody): Promise<WorkflowDef> {
    const def = await window.rookery.workflows.create(input)
    await load()
    return def
  }

  async function update(id: string, input: WorkflowDefBody): Promise<WorkflowDef> {
    const def = await window.rookery.workflows.update(id, input)
    await load()
    return def
  }

  async function remove(id: string): Promise<void> {
    await window.rookery.workflows.remove(id)
    await load()
  }

  return { items, loading, load, get, create, update, remove }
})
