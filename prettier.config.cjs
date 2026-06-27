/** @type {import('prettier').Config} */
module.exports = {
  plugins: ['prettier-plugin-svelte'],
  semi: false,
  singleQuote: true,
  overrides: [
    {
      files: '*.svelte',
      options: {
        parser: 'svelte',
      },
    },
  ],
}
