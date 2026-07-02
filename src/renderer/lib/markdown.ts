import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

/**
 * Markdown → safe HTML for display in the renderer.
 *
 * Security is layered, because this HTML is injected with `v-html` inside the
 * Electron renderer where a script injection would be catastrophic:
 *
 *  1. markdown-it runs with `html: false`, so any raw HTML in the *source* is
 *     escaped to text rather than passed through — a spec or an agent artifact
 *     can't smuggle `<script>` or `<img onerror=…>` in as literal HTML.
 *  2. The rendered output is still run through DOMPurify as defense-in-depth,
 *     stripping anything unexpected (event-handler attributes, `javascript:`
 *     URLs, `<script>`/`<style>`/`<iframe>`, …) even if markdown-it ever emits
 *     something surprising.
 *  3. Links are hardened to `target="_blank"` + `rel="noopener noreferrer"` and
 *     restricted to safe protocols, so a rendered link can't script or leak.
 */
const md = new MarkdownIt({
  html: false, // never trust raw HTML in the markdown source
  linkify: true,
  breaks: false
})

// Force links to open safely (they must never navigate the app window itself).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Tags/attrs allowed through — a deliberately small markdown-shaped allow-list. */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'blockquote',
    'pre',
    'code',
    'span',
    'strong',
    'em',
    'del',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'align'],
  // Block every other protocol (data:, javascript:, vbscript:, …).
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i
}

/** Render markdown to sanitized HTML safe for `v-html`. */
export function renderMarkdown(source: string): string {
  if (!source || source.trim() === '') return ''
  const rendered = md.render(source)
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG)
}
