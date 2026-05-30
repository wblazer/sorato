import { httpErrorMessage, requestErrorMessage } from '$lib/api-errors.js'
import type { Project } from '$lib/types.js'
import { connectionsStore } from './connections.svelte.js'
import { modelsStore } from './models.svelte.js'

function createProjectStore() {
  let projects = $state<Project[]>([])
  let selectedProjectId = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function fetchProjects() {
    loading = true
    error = null
    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/projects`)
      if (!res.ok) throw new Error(await httpErrorMessage(res))
      projects = await res.json()
      if (!selectedProjectId && projects.length > 0) {
        selectedProjectId = projects[0]?.id ?? null
      }
      if (selectedProjectId) void modelsStore.load(selectedProjectId)
    } catch (e) {
      error = requestErrorMessage(e, 'Failed to load projects')
    } finally {
      loading = false
    }
  }

  async function createLocalProject(path: string): Promise<Project | null> {
    try {
      const res = await fetch(`${connectionsStore.getApiBase()}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!res.ok) throw new Error(await httpErrorMessage(res))
      const project: Project = await res.json()
      projects = [project, ...projects]
      selectProject(project.id)
      return project
    } catch (e) {
      error = requestErrorMessage(e, 'Failed to create project')
      return null
    }
  }

  function selectProject(id: string | null) {
    selectedProjectId = id
    if (id) void modelsStore.load(id)
  }

  async function archiveProject(
    id: string,
    archiveSessions: boolean
  ): Promise<boolean> {
    try {
      const res = await fetch(
        `${connectionsStore.getApiBase()}/projects/${id}/archive`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archiveSessions }),
        }
      )
      if (!res.ok) throw new Error(await httpErrorMessage(res))
      projects = projects.filter((project) => project.id !== id)
      if (selectedProjectId === id) {
        const nextProject = projects[0] ?? null
        selectProject(nextProject?.id ?? null)
      }
      return true
    } catch (e) {
      error = requestErrorMessage(e, 'Failed to archive project')
      return false
    }
  }

  function getProject(id: string | null): Project | null {
    if (!id) return null
    return projects.find((project) => project.id === id) ?? null
  }

  return {
    get projects() {
      return projects
    },
    get selectedProjectId() {
      return selectedProjectId
    },
    get selectedProject() {
      return getProject(selectedProjectId)
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    fetchProjects,
    createLocalProject,
    archiveProject,
    selectProject,
    getProject,
  }
}

export const projectStore = createProjectStore()
