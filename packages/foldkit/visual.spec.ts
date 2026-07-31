import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import type { ProjectResponse, SessionResponse } from '@sorato/api'

const serverUrl = 'http://127.0.0.1:3100'

const prepareServer = async (request: APIRequestContext) => {
  const projects = (await (
    await request.get(`${serverUrl}/projects`)
  ).json()) as ReadonlyArray<ProjectResponse>
  if (
    !projects.some((project) => project.path === '/home/user/workspace/repo')
  ) {
    await request.post(`${serverUrl}/projects`, {
      data: { path: '/home/user/workspace/repo', name: 'Sorato' },
    })
  }
  await request.put(`${serverUrl}/auth/anthropic`, {
    data: { key: 'browser-comparison-placeholder' },
  })
  await request.put(`${serverUrl}/dev/scenarios/streaming`)
}

const connectSvelte = async (page: Page) => {
  await page.goto('http://127.0.0.1:4173')
  await page.getByRole('button', { name: 'Connect With URL' }).click()
  await page.getByLabel('Server URL *').fill(serverUrl)
  await page.getByRole('button', { name: 'Add Connection' }).last().click()
  await page.getByText('Start session in').waitFor()
}

const selectScenario = async (
  page: Page,
  scenario: 'streaming' | 'tool-use' | 'interruptible' | 'branching'
) => {
  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await page.getByLabel('Scenario', { exact: true }).selectOption(scenario)
  await expect(
    page.getByRole('button', { name: 'Run selected scenario' })
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Close dialog' }).click()
}

test.describe.configure({ mode: 'serial' })

test('old and new shells are visually equivalent', async ({
  page,
  request,
}) => {
  await prepareServer(request)
  await page.setViewportSize({ width: 1440, height: 900 })

  await connectSvelte(page)
  await expect(page.getByText('Mock scenario (streaming)')).toBeVisible({
    timeout: 15_000,
  })
  await page.mouse.move(1000, 500)
  await page.screenshot({
    path: '../../.amp/in/artifacts/svelte-reference.png',
  })
  await page
    .getByRole('button', { name: 'New Tab', exact: true })
    .last()
    .hover()
  await page.screenshot({ path: '../../.amp/in/artifacts/svelte-hover.png' })

  await page.goto('http://127.0.0.1:4174')
  await expect(page.getByText('Start session in')).toBeVisible()
  await expect(page.getByLabel('Model')).toHaveValue('mock/streaming-demo', {
    timeout: 15_000,
  })
  await page.mouse.move(1000, 500)
  await page.screenshot({ path: '../../.amp/in/artifacts/foldkit-port.png' })
  await page
    .getByRole('button', { name: 'New Tab', exact: true })
    .last()
    .hover()
  await page.screenshot({ path: '../../.amp/in/artifacts/foldkit-hover.png' })

  const openTabs = page.getByRole('navigation', { name: 'Open sessions' })
  await page
    .getByRole('button', { name: 'New Tab', exact: true })
    .first()
    .click()
  await expect(
    openTabs.getByRole('button', { name: 'New Tab', exact: true })
  ).toHaveCount(2)
  await openTabs
    .getByRole('button', { name: 'New Tab', exact: true })
    .last()
    .hover()
  await expect(
    openTabs.getByRole('button', { name: 'Close New Tab' }).last()
  ).toBeVisible()
  await openTabs.getByRole('button', { name: 'Close New Tab' }).last().click()
  await expect(
    openTabs.getByRole('button', { name: 'New Tab', exact: true })
  ).toHaveCount(1)

  await page.getByRole('button', { name: 'Diff', exact: true }).click()
  await expect(page.getByText('No file changes')).toBeVisible()
  await page.getByRole('button', { name: 'Conversation tree' }).click()
  await page.getByRole('button', { name: 'Close side panel' }).click()
  await expect(
    page.getByRole('button', { name: 'Conversation tree' })
  ).not.toBeVisible()
  await page.getByRole('button', { name: 'Open side panel' }).click()
  await expect(
    page.getByRole('button', { name: 'Conversation tree' })
  ).toBeVisible()

  const sessions = (await (
    await request.get(`${serverUrl}/sessions`)
  ).json()) as ReadonlyArray<SessionResponse>
  const recent = sessions[0]
  expect(recent).toBeDefined()
  await page.getByRole('button', { name: 'Search sessions' }).click()
  await page.getByRole('textbox', { name: 'Search sessions' }).fill(recent!.id)
  await page
    .getByRole('button', {
      name: `New Session - ${recent!.id}`,
      exact: true,
    })
    .click()
  await expect(page.getByLabel('Prompt')).toBeEnabled()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Server URL').fill(serverUrl)
  await page.getByRole('button', { name: 'Reconnect' }).click()
  await expect(page.getByText('Start session in')).toBeVisible()
})

test('pilots typing, streaming, tools, interruption, branching, and summary', async ({
  context,
  page,
  request,
}) => {
  await prepareServer(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:4174')

  await selectScenario(page, 'streaming')
  const prompt = page.getByLabel('Prompt')
  await prompt.fill('Typed through the real browser input')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(
    page.getByText(/Hello from the Sorato mock agent/).last()
  ).toBeVisible()
  await expect(prompt).toBeEnabled()

  await selectScenario(page, 'tool-use')
  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await page.getByRole('button', { name: 'Run selected scenario' }).click()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(
    page.getByText(/I read AGENTS\.md through the real Read tool/).last()
  ).toBeVisible()
  await expect(prompt).toBeEnabled()

  await selectScenario(page, 'interruptible')
  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await page.getByRole('button', { name: 'Run selected scenario' }).click()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText(/paced-chunk-1/).last()).toBeVisible()
  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await expect(page.getByLabel('Scenario', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Stop run' }).click()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()

  const branchActions = page.getByRole('button', {
    name: 'Branch from this message',
  })
  await branchActions.first().click()
  await selectScenario(page, 'branching')
  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await page.getByRole('button', { name: 'Run selected scenario' }).click()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText(/BRANCHING SCENARIO/).last()).toBeVisible()
  await expect(prompt).toBeEnabled()

  await page.screenshot({
    path: '../../.amp/in/artifacts/foldkit-scenarios.png',
  })
  const sessions = (await (
    await request.get(`${serverUrl}/sessions`)
  ).json()) as ReadonlyArray<SessionResponse>
  const scenarioSession = sessions[0]
  expect(scenarioSession).toBeDefined()
  const sveltePage = await context.newPage()
  await sveltePage.setViewportSize({ width: 1440, height: 900 })
  await connectSvelte(sveltePage)
  await sveltePage
    .getByText(`New Session - ${scenarioSession!.id}`, { exact: true })
    .click()
  await sveltePage
    .getByRole('button', { name: /BRANCHING SCENARIO/ })
    .last()
    .click()
  const messages = sveltePage.getByRole('region', { name: 'Messages' })
  await expect(messages).toContainText('BRANCHING SCENARIO', {
    timeout: 15_000,
  })
  await sveltePage.screenshot({
    path: '../../.amp/in/artifacts/svelte-scenarios.png',
  })
  await sveltePage.close()

  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await page.getByRole('button', { name: 'Summarize selected range' }).click()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(
    page.getByText(/selected conversation range was compacted/).last()
  ).toBeVisible()
  await expect(page.getByText('Generating summary')).not.toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('Summary', { exact: true })).toBeVisible()
  await page.screenshot({
    path: '../../.amp/in/artifacts/foldkit-summary.png',
  })
})
