<script setup lang="ts">
import { useRepoRows } from '@renderer/composables/use-repo-rows'
import { Button } from '@renderer/components/ui/button'

// Attach-repos editor. Owns the repo rows + git-probe logic (via useRepoRows) and
// exposes payload()/setFrom() to the parent form (brief composer + editor).
const { repos, add, remove, onPathInput, probe, browse, setFrom, payload } = useRepoRows()

defineExpose({ payload, setFrom, repos })
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-medium">Repositories it touches</h2>
      <Button variant="outline" size="sm" @click="add">Add repo</Button>
    </div>
    <p v-if="repos.length === 0" class="text-sm text-muted-foreground">
      No repos attached yet. Agents work inside an isolated copy of these.
    </p>
    <div v-for="(repo, index) in repos" :key="index" class="flex flex-col gap-1">
      <div class="grid grid-cols-[1fr_1.5fr_1.5fr_auto] items-center gap-2">
        <input
          v-model="repo.name"
          type="text"
          placeholder="name (api)"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div class="flex items-center gap-1">
          <input
            v-model="repo.localPath"
            type="text"
            :list="`dirs-${index}`"
            placeholder="local path (C:/git/api)"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @input="onPathInput(repo)"
            @blur="probe(repo)"
          />
          <datalist :id="`dirs-${index}`">
            <option v-for="s in repo.suggestions" :key="s" :value="s" />
          </datalist>
          <Button variant="outline" size="sm" @click="browse(repo)">Browse…</Button>
        </div>
        <input
          v-model="repo.remoteUrl"
          type="text"
          placeholder="remote URL (optional)"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button variant="ghost" size="sm" @click="remove(index)">Remove</Button>
      </div>
      <!-- Non-blocking git hints for the path. -->
      <p v-if="repo.probe && repo.localPath && !repo.probe.exists" class="text-xs text-beacon">
        Path not found on disk.
      </p>
      <p v-else-if="repo.probe && !repo.probe.isGitRepo" class="text-xs text-beacon">
        No <span class="font-mono">.git</span> folder here — you can still attach it, but it
        doesn't look like a git repo.
      </p>
      <p v-else-if="repo.probe && repo.probe.isGitRepo" class="text-xs text-muted-foreground">
        ✓ git repo<template v-if="repo.probe.defaultBranch"> · {{ repo.probe.defaultBranch }}</template
        ><template v-if="repo.probe.remoteUrl"> · {{ repo.probe.remoteUrl }}</template>
      </p>
    </div>
  </section>
</template>
