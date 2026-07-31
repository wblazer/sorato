import { Schema } from 'effect'
import {
  getJsonWithSchema,
  setJsonWithSchema,
  type Storage,
} from './storage.ts'

export const sidebarWidthKey = 'app-sidebar-width'
export const defaultSidebarWidth = 288
export const minSidebarWidth = 224
export const maxSidebarWidth = 520
export const treePanelOpenKey = 'session-tree-panel-open'
export const treePanelWidthKey = 'session-tree-panel-width'
export const groupAgentStepsKey = 'session-tree-group-agent-steps'
export const defaultTreePanelWidth = 360
export const minTreePanelWidth = 260
export const maxTreePanelWidth = 1200

const clamp = (
  width: number,
  minimum: number,
  maximum: number,
  viewportWidth: number | undefined,
  ratio: number
) =>
  Math.min(
    Math.max(width, minimum),
    viewportWidth === undefined
      ? maximum
      : Math.min(maximum, Math.floor(viewportWidth * ratio))
  )
export const clampSidebarWidth = (
  width: number,
  viewportWidth?: number
): number => clamp(width, minSidebarWidth, maxSidebarWidth, viewportWidth, 0.45)
export const clampTreePanelWidth = (
  width: number,
  viewportWidth?: number
): number =>
  clamp(width, minTreePanelWidth, maxTreePanelWidth, viewportWidth, 0.75)

export const loadSidebarWidth = (
  storage: Storage,
  viewportWidth?: number
): number => {
  const value = getJsonWithSchema(
    storage,
    sidebarWidthKey,
    Schema.Number,
    defaultSidebarWidth
  )
  return Number.isFinite(value)
    ? clampSidebarWidth(value, viewportWidth)
    : defaultSidebarWidth
}
export const saveSidebarWidth = (
  storage: Storage,
  width: number,
  viewportWidth?: number
): number => {
  const value = clampSidebarWidth(width, viewportWidth)
  setJsonWithSchema(storage, sidebarWidthKey, Schema.Number, value)
  return value
}
export const loadTreePanelOpen = (storage: Storage): boolean =>
  getJsonWithSchema(storage, treePanelOpenKey, Schema.Boolean, true)
export const saveTreePanelOpen = (storage: Storage, open: boolean): boolean => {
  setJsonWithSchema(storage, treePanelOpenKey, Schema.Boolean, open)
  return open
}
export const loadGroupAgentSteps = (storage: Storage): boolean =>
  getJsonWithSchema(storage, groupAgentStepsKey, Schema.Boolean, true)
export const saveGroupAgentSteps = (
  storage: Storage,
  groupAgentSteps: boolean
): boolean => {
  setJsonWithSchema(
    storage,
    groupAgentStepsKey,
    Schema.Boolean,
    groupAgentSteps
  )
  return groupAgentSteps
}
export const loadTreePanelWidth = (
  storage: Storage,
  viewportWidth?: number
): number => {
  const value = getJsonWithSchema(
    storage,
    treePanelWidthKey,
    Schema.Number,
    defaultTreePanelWidth
  )
  return Number.isFinite(value)
    ? clampTreePanelWidth(value, viewportWidth)
    : defaultTreePanelWidth
}
export const saveTreePanelWidth = (
  storage: Storage,
  width: number,
  viewportWidth?: number
): number => {
  const value = clampTreePanelWidth(width, viewportWidth)
  setJsonWithSchema(storage, treePanelWidthKey, Schema.Number, value)
  return value
}
