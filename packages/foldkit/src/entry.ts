import { overlay } from '@foldkit/devtools'
import { Runtime } from 'foldkit'
import { Message, application } from './main.ts'
import './styles.css'

Runtime.run(
  Runtime.makeApplication({
    ...application,
    container: document.getElementById('app'),
    devTools: { Message, overlay },
  })
)
