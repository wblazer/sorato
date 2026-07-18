import { Schema } from 'effect'
import { getJsonWithSchema, setJsonWithSchema } from '$lib/storage.js'

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
  const stored = getJsonWithSchema(
    treePanelWidthKey,
    Schema.Number,
    defaultTreePanelWidth
  )
  return Number.isFinite(stored)
    ? clampTreePanelWidth(stored)
    : defaultTreePanelWidth
}

function createSessionLayoutStore() {
  let treePanelOpen = $state(
    getJsonWithSchema(treePanelOpenKey, Schema.Boolean, true)
  )
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
      setJsonWithSchema(treePanelOpenKey, Schema.Boolean, open)
    },
    toggleTreePanel() {
      const open = !treePanelOpen
      treePanelOpen = open
      setJsonWithSchema(treePanelOpenKey, Schema.Boolean, open)
    },
    setTreePanelWidth(width: number) {
      const clamped = clampTreePanelWidth(width)
      treePanelWidth = clamped
      setJsonWithSchema(treePanelWidthKey, Schema.Number, clamped)
    },
    clampTreePanelWidth,
    minTreePanelWidth,
    maxTreePanelWidth,
    defaultTreePanelWidth,
  }
}

export const sessionLayoutStore = createSessionLayoutStore()
