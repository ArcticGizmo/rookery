import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CreateWorkItemInput,
  SpecDiff,
  SpecVersion,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemDetail
} from '@shared/domain'

export const useWorkItemsStore = defineStore('workItems', () => {
  const items = ref<WorkItem[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await window.rookery.workItems.list()
    } finally {
      loading.value = false
    }
  }

  function get(id: string): Promise<WorkItemDetail | null> {
    return window.rookery.workItems.get(id)
  }

  async function create(input: CreateWorkItemInput): Promise<WorkItemDetail> {
    const detail = await window.rookery.workItems.create(input)
    await load()
    return detail
  }

  async function update(id: string, input: UpdateWorkItemInput): Promise<WorkItemDetail> {
    const detail = await window.rookery.workItems.update(id, input)
    await load()
    return detail
  }

  async function remove(id: string): Promise<void> {
    await window.rookery.workItems.remove(id)
    await load()
  }

  // Spec versioning
  function saveSpec(workItemId: string, content: string): Promise<SpecVersion> {
    return window.rookery.spec.save(workItemId, content)
  }

  function specHistory(workItemId: string): Promise<SpecVersion[]> {
    return window.rookery.spec.history(workItemId)
  }

  function specDiff(workItemId: string, from: number, to: number): Promise<SpecDiff> {
    return window.rookery.spec.diff(workItemId, from, to)
  }

  return { items, loading, load, get, create, update, remove, saveSpec, specHistory, specDiff }
})
