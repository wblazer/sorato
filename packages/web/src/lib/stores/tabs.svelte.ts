import type { AppTab, Session } from '$lib/types.js'
import { messagesStore } from './messages.svelte.js'

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
  let tabs = $state<AppTab[]>([newTab()])
  let activeTabId = $state<string | null>(tabs[0]?.id ?? null)

  const activeTab = $derived(
    activeTabId ? (tabs.find((tab) => tab.id === activeTabId) ?? null) : null
  )

  function setActiveTab(id: string) {
    activeTabId = id
    const tab = tabs.find((item) => item.id === id)
    if (tab?.sessionId) void messagesStore.loadMessages(tab.sessionId)
    if (!tab?.sessionId) messagesStore.clear()
  }

  function openNewTab() {
    const tab = newTab()
    tabs = [tab, ...tabs]
    activeTabId = tab.id
    messagesStore.clear()
  }

  function closeTab(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return

    const next = tabs.filter((tab) => tab.id !== id)
    tabs = next

    if (activeTabId === id) {
      const replacement = next[Math.max(0, index - 1)] ?? next[0] ?? null
      if (replacement) {
        setActiveTab(replacement.id)
      } else {
        activeTabId = null
        messagesStore.clear()
      }
    }
  }

  function setDraftProject(tabId: string, projectId: string | null) {
    tabs = tabs.map((tab) =>
      tab.id === tabId ? { ...tab, projectId, updatedAt: Date.now() } : tab
    )
  }

  function clearProject(projectId: string) {
    tabs = tabs.map((tab) =>
      tab.projectId === projectId && tab.sessionId === null
        ? { ...tab, projectId: null, updatedAt: Date.now() }
        : tab
    )
  }

  function attachSession(tabId: string, session: Session) {
    tabs = tabs.map((tab) =>
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
    )
  }

  function updateSessionTitle(sessionId: string, title: string | null) {
    tabs = tabs.map((tab) =>
      tab.sessionId === sessionId
        ? { ...tab, title, updatedAt: Date.now() }
        : tab
    )
  }

  return {
    get tabs() {
      return tabs
    },
    get activeTabId() {
      return activeTabId
    },
    get activeTab() {
      return activeTab
    },
    setActiveTab,
    openNewTab,
    closeTab,
    setDraftProject,
    clearProject,
    attachSession,
    updateSessionTitle,
  }
}

export const tabStore = createTabStore()
