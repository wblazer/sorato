import { expect, type Page, test } from '@playwright/test'

type ScrollMetrics = {
  readonly clientHeight: number
  readonly controllerScrollWrites: number
  readonly distanceToEnd: number
  readonly mode: string | undefined
  readonly scrollHeight: number
  readonly scrollTop: number
}

const fixtureUrl = '/scroll-stability.html'

const settleLayout = (page: Page) =>
  page.evaluate(() =>
    document.fonts.ready.then(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
    )
  )

const readMetrics = (page: Page): Promise<ScrollMetrics> =>
  page
    .locator('[data-fixture-scroller] [data-slot="scroll-area-viewport"]')
    .evaluate((viewport) => ({
      clientHeight: viewport.clientHeight,
      controllerScrollWrites: Number(viewport.dataset.scrollWriteCount),
      distanceToEnd:
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      mode: viewport.dataset.scrollMode,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    }))

test('follows deterministic markdown and code growth at the bottom', async ({
  page,
}) => {
  await page.goto(fixtureUrl)
  await settleLayout(page)

  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'Stream next chunk' }).click()
    await settleLayout(page)
    const metrics = await readMetrics(page)
    expect(metrics.mode).toBe('following-bottom')
    expect(metrics.distanceToEnd).toBeLessThanOrEqual(1)
  }
})

test('preserves a reader marker through streamed-to-durable replacement', async ({
  page,
}, testInfo) => {
  await page.goto(fixtureUrl)
  const nextChunk = page.getByRole('button', { name: 'Stream next chunk' })
  await nextChunk.click()
  await nextChunk.click()
  await settleLayout(page)

  const viewport = page.locator(
    '[data-fixture-scroller] [data-slot="scroll-area-viewport"]'
  )
  await viewport.hover()
  await page.mouse.wheel(0, -700)
  await settleLayout(page)

  const marker = page.getByText('Reader marker 8:', { exact: false })
  await marker.scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, -120)
  await settleLayout(page)
  const beforeMetrics = await readMetrics(page)
  const beforeMarker = await marker.boundingBox()

  await page.getByRole('button', { name: 'Complete response' }).click()
  await settleLayout(page)

  const afterMetrics = await readMetrics(page)
  const afterMarker = await marker.boundingBox()
  testInfo.annotations.push({
    type: 'reader-position-evidence',
    description: JSON.stringify({
      markerDelta: (afterMarker?.y ?? 0) - (beforeMarker?.y ?? 0),
      scrollTopDelta: afterMetrics.scrollTop - beforeMetrics.scrollTop,
    }),
  })
  expect(beforeMetrics.mode).toBe('free-scrolling')
  expect(afterMetrics.mode).toBe('free-scrolling')
  expect(afterMetrics.scrollTop).toBeCloseTo(beforeMetrics.scrollTop, 0)
  expect(afterMarker?.y).toBeCloseTo(beforeMarker?.y ?? 0, 0)
  await expect(page.locator('[data-response-branch="durable"]')).toBeVisible()
})

test('does not follow regrowth after native completion clamping', async ({
  page,
}, testInfo) => {
  await page.goto(fixtureUrl)
  const nextChunk = page.getByRole('button', { name: 'Stream next chunk' })
  await nextChunk.click()
  await nextChunk.click()
  await settleLayout(page)

  const viewport = page.locator(
    '[data-fixture-scroller] [data-slot="scroll-area-viewport"]'
  )
  await viewport.hover()
  await page.mouse.wheel(0, -240)
  await settleLayout(page)
  expect((await readMetrics(page)).mode).toBe('free-scrolling')

  await page.getByRole('button', { name: 'Shrink response' }).click()
  await settleLayout(page)
  const clamped = await readMetrics(page)
  expect(clamped.mode).toBe('free-scrolling')

  await page.getByRole('button', { name: 'Restore response' }).click()
  await settleLayout(page)
  const restored = await readMetrics(page)
  testInfo.annotations.push({
    type: 'clamp-regrowth-evidence',
    description: JSON.stringify({
      controllerScrollWrites:
        restored.controllerScrollWrites - clamped.controllerScrollWrites,
      nativeScrollTopDelta: restored.scrollTop - clamped.scrollTop,
    }),
  })
  expect(restored.mode).toBe('free-scrolling')
  expect(restored.controllerScrollWrites).toBe(clamped.controllerScrollWrites)
})

test('records cold intrinsic-size geometry separately from stable rows', async ({
  page,
}, testInfo) => {
  const measureTraversal = async (url: string) => {
    await page.goto(url)
    await settleLayout(page)
    const initial = await readMetrics(page)
    await page
      .locator('[data-fixture-scroller] [data-slot="scroll-area-viewport"]')
      .evaluate((viewport) => {
        viewport.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, deltaY: -100 })
        )
        viewport.scrollTo({ top: 500, behavior: 'auto' })
      })
    await settleLayout(page)
    const realized = await readMetrics(page)
    return { initial, realized }
  }

  const legacy = await measureTraversal(`${fixtureUrl}?contain=1`)
  const stable = await measureTraversal(fixtureUrl)
  const evidence = {
    legacyScrollHeightDelta:
      legacy.realized.scrollHeight - legacy.initial.scrollHeight,
    stableScrollHeightDelta:
      stable.realized.scrollHeight - stable.initial.scrollHeight,
  }
  testInfo.annotations.push({
    type: 'scroll-geometry-evidence',
    description: JSON.stringify(evidence),
  })

  expect(Math.abs(evidence.stableScrollHeightDelta)).toBeLessThanOrEqual(1)
  expect(Math.abs(evidence.legacyScrollHeightDelta)).toBeGreaterThan(100)
})
