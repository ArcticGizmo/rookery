// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/renderer/lib/markdown'

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code`.')
    expect(html).toContain('<h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders lists and code blocks', () => {
    const html = renderMarkdown('- one\n- two\n\n```\nblock\n```')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<pre>')
  })

  // --- Security: no script injection through the Electron renderer ---

  it('escapes raw HTML in the source (html:false) so no live <script> survives', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world')
    // The text may remain (escaped), but there must be no executable element.
    expect(html).not.toContain('<script')
  })

  it('does not emit a live <img onerror> element from raw HTML in the source', () => {
    const html = renderMarkdown('text <img src=x onerror=alert(1)> more')
    expect(html).not.toContain('<img')
  })

  it('never produces a javascript: link href', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    // The dangerous property is a clickable javascript: href; inert text is fine.
    expect(html.toLowerCase()).not.toContain('href="javascript')
  })

  it('hardens real links with target=_blank and rel=noopener', () => {
    const html = renderMarkdown('[site](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('returns an empty string for blank input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).toBe('')
  })
})
