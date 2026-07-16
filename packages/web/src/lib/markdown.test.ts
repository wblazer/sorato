import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown.js'
import { highlightCode } from './syntax-highlighting.js'

describe('renderMarkdown', () => {
  it('renders common agent response formatting', () => {
    const rendered = renderMarkdown(
      '# Result\n\n- **safe**\n- `typed`\n\n| Name | Value |\n| --- | --- |\n| one | two |'
    )

    expect(rendered).toContain('<h1>Result</h1>')
    expect(rendered).toContain('<strong>safe</strong>')
    expect(rendered).toContain('<code>typed</code>')
    expect(rendered).toContain('class="markdown-table-wrap"')
  })

  it('renders fenced code as escaped text with copy controls', () => {
    const rendered = renderMarkdown('```ts\nconst tag = "<script>"\n```')

    expect(rendered).toContain('data-language="ts"')
    expect(rendered).toContain('data-markdown-copy-mount')
    expect(rendered).not.toContain('markdown-code-header')
    expect(rendered).toContain('&lt;script&gt;')
    expect(rendered).not.toContain('<script>')
  })

  it('does not trust raw HTML or unsafe link protocols', () => {
    const rendered = renderMarkdown(
      '<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))'
    )

    expect(rendered).not.toContain('<img')
    expect(rendered).not.toContain('href="javascript:')
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('isolates external links and makes task lists read-only', () => {
    const rendered = renderMarkdown(
      '[Effect](https://effect.website)\n\n- [x] Parsed\n- [ ] Rendered'
    )

    expect(rendered).toContain('target="_blank"')
    expect(rendered).toContain('rel="noopener noreferrer"')
    expect(rendered).toContain('type="checkbox"')
    expect(rendered).toContain('disabled=""')
  })
})

describe('highlightCode', () => {
  it('tokenizes supported languages without changing the source', async () => {
    const source = 'const answer: number = 42\n'
    const highlighted = await highlightCode(source, 'ts')

    expect(highlighted).toBeDefined()
    expect(
      highlighted
        ?.map((line) => line.map((token) => token.content).join(''))
        .join('\n')
    ).toBe(source)
    expect(highlighted?.flat().some((token) => token.color !== undefined)).toBe(
      true
    )
  })

  it('falls back to plain code for unknown languages', async () => {
    await expect(
      highlightCode('still readable', 'not-a-real-language')
    ).resolves.toBeUndefined()
  })
})
