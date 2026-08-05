import {
  DevLanguageModelResolverLive,
  DevModelCatalogLive,
} from './dev/model-scenarios.ts'
import { runServer } from './server-runtime.ts'

runServer({
  developerMode: true,
  modelCatalog: DevModelCatalogLive,
  languageModelResolver: DevLanguageModelResolverLive,
})
