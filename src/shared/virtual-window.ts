/**
 * Fixed-height virtual-scroll math (Phase 7.4). Pure so it can be unit-tested
 * without a DOM: given the total row count, a constant row height, and the
 * scroll viewport, it returns the slice of rows to actually render plus the
 * spacer geometry to keep the scrollbar sized as if every row were present.
 *
 * Only the visible window (plus a small overscan above/below, so fast scrolls
 * don't flash blank rows) is mounted — so a log of thousands of events keeps a
 * constant, small number of DOM nodes.
 */

export interface VirtualWindowInput {
  /** Total number of rows in the list. */
  count: number
  /** Height of a single row in pixels (rows must be uniform). */
  rowHeight: number
  /** Current scrollTop of the viewport. */
  scrollTop: number
  /** Visible height of the viewport in pixels. */
  viewportHeight: number
  /** Extra rows to render beyond each edge of the viewport (default 8). */
  overscan?: number
}

export interface VirtualWindow {
  /** First row index to render (inclusive). */
  startIndex: number
  /** One past the last row index to render (exclusive) — use with Array.slice. */
  endIndex: number
  /** Pixel offset to translate the rendered rows down by (startIndex * rowHeight). */
  offsetY: number
  /** Full scrollable height as if all rows were rendered (count * rowHeight). */
  totalHeight: number
}

export function computeVirtualWindow({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 8
}: VirtualWindowInput): VirtualWindow {
  const totalHeight = count * rowHeight
  if (count === 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: count, offsetY: 0, totalHeight }
  }

  const clampedScroll = Math.max(0, Math.min(scrollTop, totalHeight))
  const first = Math.floor(clampedScroll / rowHeight)
  const visibleRows = Math.ceil(viewportHeight / rowHeight)

  const startIndex = Math.max(0, first - overscan)
  const endIndex = Math.min(count, first + visibleRows + overscan)

  return { startIndex, endIndex, offsetY: startIndex * rowHeight, totalHeight }
}
