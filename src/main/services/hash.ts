import { createHash } from 'node:crypto'

/** SHA-256 hex digest of spec content — used to detect real changes so we only
 * cut a new spec version when the text actually differs. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
