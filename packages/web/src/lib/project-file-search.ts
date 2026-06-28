import { apiClient, runApiEffect } from '$lib/api-client.js'
import { connectionsStore } from '$lib/stores/connections.svelte.js'
import { Effect } from 'effect'

export function searchProjectFiles(projectId: string, query: string) {
  return Effect.gen(function* () {
    const client = yield* apiClient(connectionsStore.getApiBase())
    const result = yield* runApiEffect(
      client.projects.searchFiles({
        params: { id: projectId },
        query: { query, limit: 20 },
      }),
      'Failed to search files'
    )

    return result.entries
  })
}
