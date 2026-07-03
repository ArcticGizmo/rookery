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
  // Isolate this run from the real user database.
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

test('the journey: compose a brief, then shape an approach — both audited', async () => {
  const window = await app.firstWindow()

  // --- Compose the brief (the versioned spec) ---
  await window.getByRole('link', { name: /New brief/ }).first().click()
  await expect(window.getByPlaceholder(/Describe the problem/)).toBeVisible()
  await window.getByPlaceholder(/A short name/).fill('E2E login feature')
  await window.getByPlaceholder(/Describe the problem/).fill('# Login\nSupport SSO')
  await window.getByRole('button', { name: /Shape the approach/ }).click()

  // Routes into the approach step for the new brief.
  await expect(window.getByRole('heading', { name: 'How should this be tackled?' })).toBeVisible()

  // --- Shape the approach from a template, then save it ---
  await window.getByRole('button', { name: /Vue app/ }).click()
  await expect(window.locator('#approach-name')).toBeVisible()
  await window.getByRole('button', { name: 'Save approach' }).click()
  await expect(window.getByText(/Saved\. Now place your checkpoints\./)).toBeVisible()

  // --- Audit trail: the brief, its first spec version, and the approach are all logged ---
  await window.getByRole('link', { name: 'History' }).click()
  await expect(window.locator('h1')).toHaveText('History')
  await expect(window.getByText('brief.created').first()).toBeVisible()
  await expect(window.getByText('spec.version_created').first()).toBeVisible()
  await expect(window.getByText('approach.created').first()).toBeVisible()
})
