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
  const labels = {
    streaming: 'Streaming response',
    'tool-use': 'Tool use',
    interruptible: 'Interruptible stream',
    branching: 'Branch marker',
  } as const
  await page.getByRole('button', { name: 'Scenario Lab' }).click()
  await page.getByRole('button', { name: 'Scenario', exact: true }).click()
  const scenarioListbox = page.getByRole('listbox', { name: 'Scenario' })
  await scenarioListbox.press(labels[scenario][0] ?? '')
  await expect(
    page.getByRole('option', { name: labels[scenario] })
  ).toHaveAttribute('data-active', '')
  await scenarioListbox.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Scenario', exact: true })
  ).toContainText(labels[scenario])
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
  await expect(page.locator('.model-select')).toContainText(
    'Mock scenario (streaming)',
    {
      timeout: 15_000,
    }
  )
  await page.mouse.move(1000, 500)
  await page.screenshot({ path: '../../.amp/in/artifacts/foldkit-port.png' })
  await page
    .getByRole('button', { name: 'New Tab', exact: true })
    .last()
    .hover()
  await page.screenshot({ path: '../../.amp/in/artifacts/foldkit-hover.png' })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Settings', exact: true })
  ).toBeFocused()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } })
  await expect(page.getByRole('dialog')).not.toBeVisible()

  const projectCombobox = page.getByRole('combobox', { name: 'Project' })
  await page.locator('.project-select').click()
  await projectCombobox.fill('Sorato')
  await projectCombobox.press('ArrowDown')
  await projectCombobox.press('Enter')
  await expect(page.locator('.project-select')).toContainText('Sorato')

  const modelCombobox = page.getByRole('combobox', { name: 'Model' })
  await page.locator('.model-select').click()
  await modelCombobox.fill('streaming')
  await modelCombobox.press('ArrowDown')
  await modelCombobox.press('Enter')
  await expect(page.locator('.model-select')).toContainText(
    'Mock scenario (streaming)'
  )

  const treeTab = page.getByRole('tab', { name: 'Tree' })
  const diffTab = page.getByRole('tab', { name: 'Diff' })
  await treeTab.focus()
  await treeTab.press('ArrowRight')
  await expect(diffTab).toHaveAttribute('aria-selected', 'true')
  await diffTab.press('ArrowLeft')
  await expect(treeTab).toHaveAttribute('aria-selected', 'true')

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

  await diffTab.click()
  await expect(page.getByText('No file changes')).toBeVisible()
  await page.getByRole('button', { name: 'Close side panel' }).click()
  await expect(
    page.getByRole('button', { name: 'Open side panel' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open side panel' }).click()
  await expect(
    page.getByRole('button', { name: 'Close side panel' })
  ).toBeVisible()

  const sessions = (await (
    await request.get(`${serverUrl}/sessions`)
  ).json()) as ReadonlyArray<SessionResponse>
  const recent = sessions[0]
  expect(recent).toBeDefined()
  if (recent === undefined) throw new Error('Expected a recent session')
  await page.getByRole('button', { name: 'Search sessions' }).click()
  await page.getByRole('textbox', { name: 'Search sessions' }).fill(recent.id)
  await page
    .getByRole('button', {
      name: `New Session - ${recent.id}`,
      exact: true,
    })
    .click()
  await expect(page.getByLabel('Prompt')).toBeEnabled()

  await page.getByRole('button', { name: /^Connection:/ }).click()
  await page.getByLabel('Server URL').fill(serverUrl)
  await page.getByRole('button', { name: 'Reconnect' }).click()
  await expect(page.getByText('Start session in')).toBeVisible()
})

test('persists resizing and client-side interaction settings', async ({
  page,
  request,
}) => {
  await prepareServer(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:4174')
  await expect(page.getByText('Start session in')).toBeVisible()

  const sidebar = page.locator('.app-sidebar')
  const sidebarBefore = await sidebar.boundingBox()
  const sidebarHandle = await page
    .getByRole('separator', { name: 'Resize sidebar' })
    .boundingBox()
  expect(sidebarBefore).not.toBeNull()
  expect(sidebarHandle).not.toBeNull()
  if (sidebarBefore === null || sidebarHandle === null)
    throw new Error('Expected the sidebar and its resize handle')
  await page.mouse.move(sidebarHandle.x + 2, sidebarHandle.y + 100)
  await page.mouse.down()
  await expect(page.locator('.resize-capture.sidebar')).toBeVisible()
  await page.mouse.move(sidebarHandle.x + 82, sidebarHandle.y + 100)
  await page.mouse.up()
  await expect(sidebar).toHaveCSS('width', '368px')

  const treePanel = page.locator('.tree-panel')
  const treeHandle = await page
    .getByRole('separator', { name: 'Resize conversation panel' })
    .boundingBox()
  expect(treeHandle).not.toBeNull()
  if (treeHandle === null) throw new Error('Expected the tree resize handle')
  await page.mouse.move(treeHandle.x + 2, treeHandle.y + 100)
  await page.mouse.down()
  await expect(page.locator('.resize-capture.tree')).toBeVisible()
  await page.mouse.move(treeHandle.x - 60, treeHandle.y + 100)
  await page.mouse.up()
  await expect(treePanel).toHaveCSS('width', '422px')

  const sessions = (await (
    await request.get(`${serverUrl}/sessions`)
  ).json()) as ReadonlyArray<SessionResponse>
  const recent = sessions[0]
  if (recent === undefined) throw new Error('Expected a recent session')
  await page.getByRole('button', { name: 'Search sessions' }).click()
  await page.getByRole('textbox', { name: 'Search sessions' }).fill(recent.id)
  await page
    .getByRole('button', {
      name: `New Session - ${recent.id}`,
      exact: true,
    })
    .click()

  const groupSteps = page.getByRole('checkbox', { name: 'Group agent steps' })
  await expect(groupSteps).toHaveAttribute('aria-checked', 'true')
  await groupSteps.click()
  await expect(groupSteps).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const expandSystem = page.getByRole('switch', {
    name: 'Expand system messages by default',
  })
  await expect(expandSystem).toHaveAttribute('aria-checked', 'false')
  await expandSystem.click()
  await expect(expandSystem).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.reload()
  await expect(sidebar).toHaveCSS('width', '368px')
  await expect(treePanel).toHaveCSS('width', '422px')
  await page.getByRole('button', { name: 'Search sessions' }).click()
  await page.getByRole('textbox', { name: 'Search sessions' }).fill(recent.id)
  await page
    .getByRole('button', {
      name: `New Session - ${recent.id}`,
      exact: true,
    })
    .click()
  await expect(
    page.getByRole('checkbox', { name: 'Group agent steps' })
  ).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByRole('switch', {
      name: 'Expand system messages by default',
    })
  ).toHaveAttribute('aria-checked', 'true')
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
  if (scenarioSession === undefined)
    throw new Error('Expected a scenario session')
  const sveltePage = await context.newPage()
  await sveltePage.setViewportSize({ width: 1440, height: 900 })
  await connectSvelte(sveltePage)
  await sveltePage
    .getByText(`New Session - ${scenarioSession.id}`, { exact: true })
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

  await page.getByRole('button', { name: 'Compact', exact: true }).click()
  await expect(page.getByText('Select a range to compact')).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Summarizer instructions' })
    .fill('Preserve branch and tool outcomes.')
  await page.getByRole('button', { name: 'Generate summary' }).click()
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
