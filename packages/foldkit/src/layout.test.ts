import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  clampTreePanelWidth,
  loadGroupAgentSteps,
  loadSidebarWidth,
  loadTreePanelOpen,
  loadTreePanelWidth,
  saveGroupAgentSteps,
  saveSidebarWidth,
  saveTreePanelOpen,
  saveTreePanelWidth,
} from './layout.ts'
import { createStorage, type StorageLike } from './storage.ts'

const backend = (): StorageLike => {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    key: (index) => [...map.keys()][index] ?? null,
  }
}

describe('layout foundations', () => {
  it('clamps sidebar to 224..520 and 45vw', () => {
    expect(clampSidebarWidth(0)).toBe(224)
    expect(clampSidebarWidth(999)).toBe(520)
    expect(clampSidebarWidth(500, 800)).toBe(360)
  })
  it('clamps tree to 260..1200 and 75vw', () => {
    expect(clampTreePanelWidth(0)).toBe(260)
    expect(clampTreePanelWidth(9999)).toBe(1200)
    expect(clampTreePanelWidth(900, 800)).toBe(600)
  })
  it('loads defaults, persists clamped values, open state, and rejects invalid persistence', () => {
    const raw = backend()
    const storage = createStorage(raw)
    expect(loadSidebarWidth(storage)).toBe(288)
    expect(loadTreePanelWidth(storage)).toBe(360)
    expect(loadTreePanelOpen(storage)).toBe(true)
    expect(loadGroupAgentSteps(storage)).toBe(true)
    expect(saveSidebarWidth(storage, 999, 800)).toBe(360)
    expect(loadSidebarWidth(storage, 800)).toBe(360)
    expect(saveTreePanelWidth(storage, 100, 800)).toBe(260)
    expect(loadTreePanelWidth(storage, 800)).toBe(260)
    expect(saveTreePanelOpen(storage, false)).toBe(false)
    expect(loadTreePanelOpen(storage)).toBe(false)
    expect(saveGroupAgentSteps(storage, false)).toBe(false)
    expect(loadGroupAgentSteps(storage)).toBe(false)
    raw.setItem('sorato:app-sidebar-width', '"bad"')
    raw.setItem('sorato:session-tree-panel-width', 'null')
    raw.setItem('sorato:session-tree-panel-open', '1')
    raw.setItem('sorato:session-tree-group-agent-steps', 'null')
    expect(loadSidebarWidth(storage)).toBe(288)
    expect(loadTreePanelWidth(storage)).toBe(360)
    expect(loadTreePanelOpen(storage)).toBe(true)
    expect(loadGroupAgentSteps(storage)).toBe(true)
  })
})
