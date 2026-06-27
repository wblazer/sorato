import { getJson, setJson } from '$lib/storage.js'

const treePanelOpenKey = 'session-tree-panel-open'
const treePanelWidthKey = 'session-tree-panel-width'
const defaultTreePanelWidth = 360
const minTreePanelWidth = 260
const maxTreePanelWidth = 1200

function clampTreePanelWidth(width: number) {
  const viewportMax =
    typeof window === 'undefined'
      ? maxTreePanelWidth
      : Math.min(maxTreePanelWidth, Math.floor(window.innerWidth * 0.75))
  return Math.min(Math.max(width, minTreePanelWidth), viewportMax)
}

function initialTreePanelWidth() {
  const stored = getJson<number>(treePanelWidthKey, defaultTreePanelWidth)
  return Number.isFinite(stored)
    ? clampTreePanelWidth(stored)
    : defaultTreePanelWidth
}

function createSessionLayoutStore() {
  let treePanelOpen = $state(getJson<boolean>(treePanelOpenKey, true))
  let treePanelWidth = $state(initialTreePanelWidth())

  return {
    get treePanelOpen() {
      return treePanelOpen
    },
    get treePanelWidth() {
      return treePanelWidth
    },
    setTreePanelOpen(open: boolean) {
      treePanelOpen = open
      setJson(treePanelOpenKey, open)
    },
    toggleTreePanel() {
      const open = !treePanelOpen
      treePanelOpen = open
      setJson(treePanelOpenKey, open)
    },
    setTreePanelWidth(width: number) {
      const clamped = clampTreePanelWidth(width)
      treePanelWidth = clamped
      setJson(treePanelWidthKey, clamped)
    },
    clampTreePanelWidth,
    minTreePanelWidth,
    maxTreePanelWidth,
    defaultTreePanelWidth,
  }
}

export const sessionLayoutStore = createSessionLayoutStore()
