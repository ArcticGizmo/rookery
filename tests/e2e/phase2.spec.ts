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

test('create a work item with a versioned spec, then a workflow — both audited', async () => {
  const window = await app.firstWindow()

  // --- Work item ---
  await window.getByRole('link', { name: 'Work items' }).click()
  await window.getByRole('button', { name: 'New work item' }).click()
  await expect(window.locator('h1')).toHaveText('New work item')

  await window.locator('#title').fill('E2E login feature')
  await window.locator('#spec').fill('# Login\nSupport SSO')
  await window.getByRole('button', { name: 'Save', exact: true }).click()

  // Redirects to the editor; the first spec version is recorded.
  await expect(window.locator('h1')).toHaveText('Edit work item')
  await expect(window.getByText('v1', { exact: true })).toBeVisible()

  // --- Workflow ---
  await window.getByRole('link', { name: 'Workflows' }).click()
  await window.getByRole('button', { name: 'New workflow' }).click()
  await expect(window.locator('h1')).toHaveText('New workflow')

  await window.locator('#wf-name').fill('E2E basic flow')
  await window.getByRole('button', { name: 'Add stage' }).click()
  await window.getByRole('button', { name: 'Save workflow' }).click()
  await expect(window.locator('h1')).toHaveText('Edit workflow')

  // --- Runs page wiring (start form renders with the created work item/workflow) ---
  await window.getByRole('link', { name: 'Runs' }).click()
  await expect(window.locator('h1')).toHaveText('Runs')
  await expect(window.getByRole('heading', { name: 'Start a run' })).toBeVisible()
  await expect(window.locator('#wi option', { hasText: 'E2E login feature' })).toHaveCount(1)
  await expect(window.locator('#wf option', { hasText: 'E2E basic flow' })).toHaveCount(1)

  // --- Audit trail ---
  await window.getByRole('link', { name: 'Events' }).click()
  await expect(window.getByText('brief.created').first()).toBeVisible()
  await expect(window.getByText('spec.version_created').first()).toBeVisible()
  await expect(window.getByText('workflow.created').first()).toBeVisible()
})
