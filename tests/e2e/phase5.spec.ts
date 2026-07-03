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
    // `stub` keeps the app off sprig/docker; the run start form is provider-agnostic.
    env: { ...process.env, ROOKERY_DB_PATH: dbPath, ROOKERY_INFRA_PROVIDER: 'stub' }
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

test('run start form exposes infra template + teardown controls (Phase 5.5)', async () => {
  const window = await app.firstWindow()

  await window.getByRole('link', { name: 'Flights' }).click()
  await expect(window.locator('h1')).toHaveText('Flights')
  await expect(window.getByRole('heading', { name: 'Start a run' })).toBeVisible()

  // Infra wiring is surfaced on the start form.
  const template = window.locator('#infra')
  await expect(template).toBeVisible()
  await template.fill('api-web')
  await expect(template).toHaveValue('api-web')

  const teardown = window.locator('#teardown')
  await expect(teardown).toBeVisible()
  await expect(teardown).toBeChecked() // defaults to on
  await teardown.uncheck()
  await expect(teardown).not.toBeChecked()
})
