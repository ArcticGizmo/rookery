import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let app: ElectronApplication
let dbPath: string

test.beforeAll(async () => {
  dbPath = join(tmpdir(), `rookery-e2e-${randomUUID()}.db`)
  app = await electron.launch({
    args: [join(projectRoot, 'out', 'main', 'index.js')],
    env: { ...process.env, ROOKERY_DB_PATH: dbPath }
  })
})

test.afterAll(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`
    try {
      if (existsSync(file)) rmSync(file, { force: true })
    } catch {
      // best-effort
    }
  }
})

test('activity dashboard and history browser (Phase 6.1/6.2)', async () => {
  const window = await app.firstWindow()

  // --- Activity dashboard: no active work on a fresh install ---
  await window.getByRole('link', { name: 'Activity' }).click()
  await expect(window.locator('h1')).toHaveText('Activity')
  await expect(window.getByText('No active flights.')).toBeVisible()

  // --- History browser: the boot event is searchable ---
  await window.getByRole('link', { name: 'History' }).click()
  await expect(window.locator('h1')).toHaveText('History')
  await expect(window.getByText('app.booted').first()).toBeVisible()

  // Type-prefix filter narrows the log.
  await window.locator('#f-type').fill('app.')
  await expect(window.getByText('app.booted').first()).toBeVisible()

  // A prefix that matches nothing yields the empty state.
  await window.locator('#f-type').fill('nonexistent.type')
  await expect(window.getByText('No events match these filters.')).toBeVisible()

  // Clearing it brings results back; expanding shows the payload.
  await window.locator('#f-type').fill('')
  await window.getByText('app.booted').first().click()
  await expect(window.getByText('"platform"').first()).toBeVisible()
})
