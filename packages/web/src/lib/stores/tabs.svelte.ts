import type { AppTab, Session } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import { messagesStore } from './messages.svelte.js'

interface TabSet {
  readonly tabs: AppTab[]
  readonly activeTabId: string | null
}

const newTab = (): AppTab => {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    sessionId: null,
    projectId: null,
    title: null,
    kind: 'new',
    createdAt: now,
    updatedAt: now,
  }
}

function createTabStore() {
  let tabSets = $state<Record<string, TabSet>>({})
  const fallbackTabSet = initialTabSet()

  function activeConnectionKey(): string {
    return connectionsStore.activeConnection?.id ?? '__no_connection__'
  }

  function initialTabSet(): TabSet {
    const tab = newTab()
    return { tabs: [tab], activeTabId: tab.id }
  }

  function getTabSet(): TabSet {
    return tabSets[activeConnectionKey()] ?? fallbackTabSet
  }

  function ensureTabSet(): TabSet {
    const key = activeConnectionKey()
    const existing = tabSets[key]
    if (existing) return existing
    const created = initialTabSet()
    tabSets = { ...tabSets, [key]: created }
    return created
  }

  function setTabSet(next: TabSet) {
    tabSets = { ...tabSets, [activeConnectionKey()]: next }
  }

  function ensureActiveConnectionTabSet() {
    ensureTabSet()
  }

  function loadActiveTabMessages(): Promise<void> {
    const tab = activeTab()
    if (tab?.sessionId) return messagesStore.loadMessages(tab.sessionId)
    messagesStore.clearActive()
    return Promise.resolve()
  }

  function activeTab(): AppTab | null {
    const state = getTabSet()
    return state.activeTabId
      ? (state.tabs.find((tab) => tab.id === state.activeTabId) ?? null)
      : null
  }

  function setActiveTab(id: string) {
    const state = ensureTabSet()
    setTabSet({ ...state, activeTabId: id })
    const tab = state.tabs.find((item) => item.id === id)
    if (tab?.sessionId) void messagesStore.loadMessages(tab.sessionId)
    if (!tab?.sessionId) messagesStore.clearActive()
  }

  function openNewTab() {
    const state = ensureTabSet()
    const tab = newTab()
    setTabSet({ tabs: [tab, ...state.tabs], activeTabId: tab.id })
    messagesStore.clearActive()
  }

  function closeTab(id: string) {
    const state = ensureTabSet()
    const index = state.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return

    const next = state.tabs.filter((tab) => tab.id !== id)

    if (state.activeTabId === id) {
      const replacement = next[Math.max(0, index - 1)] ?? next[0] ?? null
      if (replacement) {
        setTabSet({ tabs: next, activeTabId: replacement.id })
        setActiveTab(replacement.id)
      } else {
        setTabSet({ tabs: next, activeTabId: null })
        messagesStore.clearActive()
      }
    } else {
      setTabSet({ ...state, tabs: next })
    }
  }

  function activateAdjacentTab(direction: 1 | -1) {
    const state = ensureTabSet()
    if (state.tabs.length < 2) return
    const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
    if (index < 0) return

    const nextIndex =
      (index + direction + state.tabs.length) % state.tabs.length
    setActiveTab(state.tabs[nextIndex].id)
  }

  function activateNextTab() {
    activateAdjacentTab(1)
  }

  function activatePreviousTab() {
    activateAdjacentTab(-1)
  }

  function setDraftProject(tabId: string, projectId: string | null) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, projectId, updatedAt: Date.now() } : tab
      ),
    })
  }

  function resetActiveTabToNewSession() {
    const state = ensureTabSet()
    if (!state.activeTabId) {
      openNewTab()
      return
    }

    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              sessionId: null,
              title: null,
              kind: 'new' as const,
              updatedAt: Date.now(),
            }
          : tab
      ),
    })
    messagesStore.clearActive()
  }

  function clearProject(projectId: string) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.projectId === projectId && tab.sessionId === null
          ? { ...tab, projectId: null, updatedAt: Date.now() }
          : tab
      ),
    })
  }

  function attachSession(tabId: string, session: Session) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              kind: 'session',
              sessionId: session.id,
              projectId: session.projectId,
              title: session.title,
              updatedAt: Date.now(),
            }
          : tab
      ),
    })
  }

  function updateSessionTitle(sessionId: string, title: string | null) {
    const state = ensureTabSet()
    setTabSet({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.sessionId === sessionId
          ? { ...tab, title, updatedAt: Date.now() }
          : tab
      ),
    })
  }

  return {
    get tabs() {
      return getTabSet().tabs
    },
    get activeTabId() {
      return getTabSet().activeTabId
    },
    get activeTab() {
      return activeTab()
    },
    setActiveTab,
    openNewTab,
    closeTab,
    activateNextTab,
    activatePreviousTab,
    resetActiveTabToNewSession,
    setDraftProject,
    clearProject,
    attachSession,
    updateSessionTitle,
    ensureActiveConnectionTabSet,
    loadActiveTabMessages,
  }
}

export const tabStore = createTabStore()
