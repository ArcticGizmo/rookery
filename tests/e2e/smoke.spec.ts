import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('app launches and renders the Rookery home view', async () => {
  const app = await electron.launch({
    args: [join(projectRoot, 'out', 'main', 'index.js')]
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('h1')).toHaveText('Rookery')
  } finally {
    await app.close()
  }
})
