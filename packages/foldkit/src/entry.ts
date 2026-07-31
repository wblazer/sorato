import { Runtime } from 'foldkit'
import { application } from './main.ts'
import '@phosphor-icons/web/regular'
import './styles.css'

Runtime.run(
  Runtime.makeApplication({
    ...application,
    container: document.getElementById('app'),
  })
)
