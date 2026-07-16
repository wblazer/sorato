import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: false,
})

markdown.use(taskLists, { enabled: false, label: true, labelAfter: true })

const defaultLinkOpen = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const href = token.attrGet('href')

  if (href !== null && /^(?:https?:|mailto:)/i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }

  return defaultLinkOpen
    ? defaultLinkOpen(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}

const defaultImage = markdown.renderer.rules.image
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('loading', 'lazy')
  tokens[index].attrSet('decoding', 'async')
  tokens[index].attrSet('referrerpolicy', 'no-referrer')

  return defaultImage
    ? defaultImage(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.table_open = () =>
  '<div class="markdown-table-wrap" tabindex="0" role="region" aria-label="Scrollable table"><table>\n'
markdown.renderer.rules.table_close = () => '</table></div>\n'

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/, 1)[0] ?? ''
  const label = language || 'text'
  const languageClass = language
    ? ` class="language-${markdown.utils.escapeHtml(language)}"`
    : ''

  return `<div class="markdown-code-block" data-language="${markdown.utils.escapeHtml(label)}">
<span data-markdown-copy-mount data-not-typeset></span>
<pre><code${languageClass}>${markdown.utils.escapeHtml(token.content)}</code></pre>
</div>\n`
}

export function renderMarkdown(source: string): string {
  return markdown.render(source)
}
