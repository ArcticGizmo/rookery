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
    // `stub` keeps the app off sprig/docker; the launch screen is provider-agnostic.
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

test('the launch screen exposes the isolated-workspace + teardown controls (J6.2)', async () => {
  const window = await app.firstWindow()

  // Compose a brief and shape an approach so the launch screen has something to fly.
  await window.getByRole('link', { name: /New brief/ }).first().click()
  await window.getByPlaceholder(/Describe the problem/).fill('# Rate limit\nAdd a token bucket')
  await window.getByRole('button', { name: /Shape the approach/ }).click()
  await window.getByRole('button', { name: /Vue app/ }).click()
  await window.getByRole('button', { name: 'Save approach' }).click()
  await expect(window.getByText(/Saved\. Now place your checkpoints\./)).toBeVisible()

  // Jump to "send it into isolation" for this brief (the approach step's URL carries the id).
  const url = await window.url()
  const briefId = /#\/brief\/([^/]+)/.exec(url)?.[1]
  expect(briefId).toBeTruthy()
  await window.evaluate((id) => {
    window.location.hash = `#/brief/${id}/launch`
  }, briefId)

  // The isolated workspace is the default; its template + teardown controls render.
  await expect(window.getByText('How it flies')).toBeVisible()
  const template = window.getByPlaceholder(/api-web/)
  await expect(template).toBeVisible()
  await template.fill('api-web')
  await expect(template).toHaveValue('api-web')

  const teardown = window.getByRole('checkbox', { name: /Tear the workspace/ })
  await expect(teardown).toBeVisible()
  await expect(teardown).toBeChecked() // defaults to on
  await teardown.uncheck()
  await expect(teardown).not.toBeChecked()
})
