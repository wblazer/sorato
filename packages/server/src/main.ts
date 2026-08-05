import { LanguageModelResolverLive, ModelCatalogLive } from './model-catalog.ts'
import { runServer } from './server-runtime.ts'

runServer({
  developerMode: false,
  modelCatalog: ModelCatalogLive,
  languageModelResolver: LanguageModelResolverLive,
})
