import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import type { ApproachDef, ApproachDefBody } from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

/**
 * A plain, structured-clone-safe copy of an approach body. Callers pass reactive
 * builder state (Vue proxies), which `ipcRenderer.invoke` can't clone — strip the
 * reactivity here so every caller is safe, not just the ones that remember to.
 */
function plainBody(input: ApproachDefBody): ApproachDefBody {
  return structuredClone(toRaw(input))
}

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
    const def = await rookery().approaches.create(plainBody(input))
    await load()
    return def
  }

  async function update(id: string, input: ApproachDefBody): Promise<ApproachDef> {
    const def = await rookery().approaches.update(id, plainBody(input))
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
