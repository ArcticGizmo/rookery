import { describe, expect, it } from 'vitest'
import { parseNumstat, totalChanges } from '../../src/shared/changes'

describe('parseNumstat', () => {
  it('parses additions/deletions and the file path', () => {
    const files = parseNumstat('12\t3\tsrc/a.ts\n0\t7\tsrc/b.ts\n')
    expect(files).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3, binary: false },
      { path: 'src/b.ts', additions: 0, deletions: 7, binary: false }
    ])
  })

  it('marks binary files (— counts) and zeroes their lines', () => {
    const [file] = parseNumstat('-\t-\tassets/logo.png')
    expect(file).toEqual({ path: 'assets/logo.png', additions: 0, deletions: 0, binary: true })
  })

  it('keeps tabs inside a renamed path and skips malformed lines', () => {
    const files = parseNumstat('5\t0\tsrc/with\ttab.ts\n\ngarbage\n2\t2\tok.ts')
    expect(files.map((f) => f.path)).toEqual(['src/with\ttab.ts', 'ok.ts'])
  })
})

describe('totalChanges', () => {
  it('sums additions and deletions across repos', () => {
    const totals = totalChanges([
      { repo: 'api', files: [{ path: 'a', additions: 10, deletions: 2, binary: false }] },
      {
        repo: 'web',
        files: [
          { path: 'b', additions: 3, deletions: 1, binary: false },
          { path: 'c', additions: 0, deletions: 0, binary: true }
        ]
      }
    ])
    expect(totals).toEqual({ additions: 13, deletions: 3 })
  })
})
