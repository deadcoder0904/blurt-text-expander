import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test'

type ExtensionFixtures = {
  context: BrowserContext
  extensionId: string
  page: Page
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  return undefined
}

const headlessFromEnv = parseBooleanEnv(process.env.PW_HEADLESS)
const headedFromEnv = parseBooleanEnv(process.env.PW_HEADED)
const headless = headedFromEnv === true ? false : (headlessFromEnv ?? true)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pathToExtension = path.join(__dirname, '..', '..', 'dist', 'chrome')
if (!fs.existsSync(pathToExtension)) {
  throw new Error(
    `Missing built extension at ${pathToExtension}. Run: bun run build:chrome (or bun run test:e2e).`
  )
}

export const test = base.extend<ExtensionFixtures>({
  context: async (_fixtures, use) => {
    const preferredChannel = process.env.PW_CHANNEL || 'chromium'
    const context = await chromium.launchPersistentContext('', {
      channel: preferredChannel,
      headless,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')
    const extensionId = serviceWorker.url().split('/')[2]!
    await use(extensionId)
  },
  page: async ({ context }, use) => {
    const page = await context.newPage()
    await use(page)
    await page.close()
  },
})

export const expect = test.expect
