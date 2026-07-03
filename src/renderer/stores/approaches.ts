import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ApproachDef, ApproachDefBody } from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

export const useApproachesStore = defineStore('approaches', () => {
  const items = ref<ApproachDef[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await rookery().approaches.list()
    } finally {
      loading.value = false
    }
  }

  function get(id: string): Promise<ApproachDef | null> {
    return rookery().approaches.get(id)
  }

  async function create(input: ApproachDefBody): Promise<ApproachDef> {
    const def = await rookery().approaches.create(input)
    await load()
    return def
  }

  async function update(id: string, input: ApproachDefBody): Promise<ApproachDef> {
    const def = await rookery().approaches.update(id, input)
    await load()
    return def
  }

  async function remove(id: string): Promise<void> {
    await rookery().approaches.remove(id)
    await load()
  }

  function draft(briefId: string) {
    return rookery().approaches.draft(briefId)
  }

  return { items, loading, load, get, create, update, remove, draft }
})
