import adapter from '@sveltejs/adapter-static'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      // SPA mode — all routes fall back to index.html
      fallback: 'index.html',
    }),
  },
}

export default config
