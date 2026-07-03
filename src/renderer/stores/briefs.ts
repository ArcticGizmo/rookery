import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CreateBriefInput,
  SpecDiff,
  SpecVersion,
  UpdateBriefInput,
  Brief,
  BriefDetail
} from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

export const useBriefsStore = defineStore('briefs', () => {
  const items = ref<Brief[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await rookery().briefs.list()
    } finally {
      loading.value = false
    }
  }

  function get(id: string): Promise<BriefDetail | null> {
    return rookery().briefs.get(id)
  }

  async function create(input: CreateBriefInput): Promise<BriefDetail> {
    const detail = await rookery().briefs.create(input)
    await load()
    return detail
  }

  async function update(id: string, input: UpdateBriefInput): Promise<BriefDetail> {
    const detail = await rookery().briefs.update(id, input)
    await load()
    return detail
  }

  async function remove(id: string): Promise<void> {
    await rookery().briefs.remove(id)
    await load()
  }

  // Spec versioning
  function saveSpec(briefId: string, content: string): Promise<SpecVersion> {
    return rookery().spec.save(briefId, content)
  }

  function specHistory(briefId: string): Promise<SpecVersion[]> {
    return rookery().spec.history(briefId)
  }

  function specDiff(briefId: string, from: number, to: number): Promise<SpecDiff> {
    return rookery().spec.diff(briefId, from, to)
  }

  return { items, loading, load, get, create, update, remove, saveSpec, specHistory, specDiff }
})
