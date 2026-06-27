import { getJson, setJson } from '$lib/storage.js'

const sidebarWidthKey = 'app-sidebar-width'
const defaultSidebarWidth = 288
const minSidebarWidth = 224
const maxSidebarWidth = 520

function clampSidebarWidth(width: number) {
  const viewportMax =
    typeof window === 'undefined'
      ? maxSidebarWidth
      : Math.min(maxSidebarWidth, Math.floor(window.innerWidth * 0.45))
  return Math.min(Math.max(width, minSidebarWidth), viewportMax)
}

function initialSidebarWidth() {
  const stored = getJson<number>(sidebarWidthKey, defaultSidebarWidth)
  return Number.isFinite(stored)
    ? clampSidebarWidth(stored)
    : defaultSidebarWidth
}

function createAppLayoutStore() {
  let sidebarWidth = $state(initialSidebarWidth())

  return {
    get sidebarWidth() {
      return sidebarWidth
    },
    setSidebarWidth(width: number) {
      const clamped = clampSidebarWidth(width)
      sidebarWidth = clamped
      setJson(sidebarWidthKey, clamped)
    },
    clampSidebarWidth,
    minSidebarWidth,
    maxSidebarWidth,
    defaultSidebarWidth,
  }
}

export const appLayoutStore = createAppLayoutStore()
