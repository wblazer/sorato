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
  const href = token?.attrGet('href')
  if (
    token !== undefined &&
    href !== null &&
    href !== undefined &&
    /^(?:https?:|mailto:)/i.test(href)
  ) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen
    ? defaultLinkOpen(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}

export const renderMarkdown = (source: string): string =>
  markdown.render(source)
