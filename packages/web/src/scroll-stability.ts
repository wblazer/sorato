import { mount } from 'svelte'
import './app.css'
import ScrollStabilityPlayground from '$lib/components/scroll-stability-playground.svelte'

const target = document.querySelector('#app')

if (!(target instanceof HTMLElement)) {
  throw new Error('Missing scroll stability fixture root')
}

mount(ScrollStabilityPlayground, {
  target,
  props: {
    onClose: () => undefined,
    useContainment: new URL(window.location.href).searchParams.has('contain'),
  },
})
