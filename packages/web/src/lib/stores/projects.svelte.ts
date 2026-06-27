import { apiClient, runApiEffect } from '$lib/api-client.js'
import type { UiApiError } from '$lib/api-errors.js'
import type { Project } from '$lib/types.js'
import { Effect } from 'effect'
import { connectionsStore } from './connections.svelte.js'
import { modelsStore } from './models.svelte.js'

function createProjectStore() {
  let projects = $state<Project[]>([])
  let selectedProjectId = $state<string | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  function fetchProjects() {
    const clearLoading = Effect.sync(() => {
      loading = false
    })

    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        loading = true
        error = null
      })

      const client = yield* apiClient(connectionsStore.getApiBase())
      const result = yield* runApiEffect(
        client.projects.list(),
        'Failed to load projects'
      )

      yield* Effect.sync(() => {
        projects = [...result]
        if (!selectedProjectId && projects.length > 0) {
          selectedProjectId = projects[0]?.id ?? null
        }
        if (selectedProjectId) {
          void Effect.runPromise(modelsStore.load(selectedProjectId))
        }
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
        })
      ),
      Effect.ensuring(clearLoading)
    )
  }

  function createLocalProject(path: string) {
    return Effect.gen(function* () {
      const client = yield* apiClient(connectionsStore.getApiBase())
      const project = yield* runApiEffect(
        client.projects.create({ payload: { path } }),
        'Failed to create project'
      )

      return yield* Effect.sync(() => {
        const created: Project = project
        projects = [created, ...projects]
        selectProject(created.id)
        return created
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          const failedProject = null
          error = cause.message
          return failedProject
        })
      )
    )
  }

  function selectProject(id: string | null) {
    selectedProjectId = id
    if (id) void Effect.runPromise(modelsStore.load(id))
  }

  function archiveProject(id: string, archiveSessions: boolean) {
    return Effect.gen(function* () {
      const client = yield* apiClient(connectionsStore.getApiBase())
      yield* runApiEffect(
        client.projects.archive({
          params: { id },
          payload: { archiveSessions },
        }),
        'Failed to archive project'
      )

      return yield* Effect.sync(() => {
        projects = projects.filter((project) => project.id !== id)
        if (selectedProjectId === id) {
          const nextProject = projects[0] ?? null
          selectProject(nextProject?.id ?? null)
        }
        return true
      })
    }).pipe(
      Effect.catch((cause: UiApiError) =>
        Effect.sync(() => {
          error = cause.message
          return false
        })
      )
    )
  }

  function getProject(id: string | null): Project | null {
    const missingProject = null
    if (!id) return missingProject
    return projects.find((project) => project.id === id) ?? missingProject
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
