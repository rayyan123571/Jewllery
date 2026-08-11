/**
 * Every icon in the application.
 *
 * Inline rather than an icon package: an offline desktop app should not depend
 * on a font or an icon CDN, and these are the only glyphs the interface needs.
 *
 * ── The rules every glyph obeys ────────────────────────────────────────────
 * They were not obeyed before, and mixed stroke weights are the fastest way to
 * make an interface look assembled rather than drawn.
 *
 *   1. **One grid.** 24×24, with the artwork inside a 20×20 optical box —
 *      2px of air on every side, so a 16px icon beside 14px text has the same
 *      visual weight as its neighbour.
 *   2. **One stroke.** 1.5, set once on the <svg>. No glyph overrides it, and
 *      none is drawn as a filled shape, because a filled glyph next to a
 *      stroked one reads as two different sets.
 *   3. **One terminal.** Round caps and round joins throughout.
 *   4. **One corner radius.** Rectangles are drawn with rx≈2, circles are true
 *      circles. No mitred corners anywhere.
 *   5. **currentColor only.** No glyph carries a colour; they inherit, so an
 *      icon in a disabled control greys out with its label.
 *
 * Several were redrawn to get here: cart and purchase were near-duplicates at
 * different scales, scale (the balance) was drawn off-grid and out of the
 * optical box, and book, stock and tools all sat a pixel or two proud of it.
 */

const PATHS: Record<string, string> = {
  // ── navigation ──────────────────────────────────────────────────────────
  home: 'M3.5 10.2 12 3.6l8.5 6.6M6 9v11h12V9',
  cart: 'M3.5 4.5h2.2l2.1 9.8h9.3l1.9-7.2H6.6M9.5 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0m6 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  // A shop scale with a pan hanging from each arm: the wholesale counter.
  wholesale: 'M12 4.2v15.6M6 7.4h12M12 4.2 6 7.4M12 4.2l6 3.2M4 12.4h4l-2-5zM16 12.4h4l-2-5zM4 12.4a2 2 0 0 0 4 0M16 12.4a2 2 0 0 0 4 0M8.5 19.8h7',
  // Deliberately the mirror of `cart`, not a second drawing of it.
  purchase:
    'M20.5 4.5h-2.2l-2.1 9.8H6.9L5 7.1h12.4M12.5 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0m-6 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  stock: 'M12 3.8 20 8v8L12 20.2 4 16V8zM4 8l8 4.2M12 12.2 20 8M12 12.2v8',
  user: 'M12 11.6a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6M4.8 20a7.2 7.2 0 0 1 14.4 0',
  suppliers:
    'M9.2 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M3.4 19.4a5.8 5.8 0 0 1 11.6 0M17 11.4a2.6 2.6 0 1 0 0-5.2M19 19.4a4.6 4.6 0 0 0-3.2-4.4',
  book: 'M6 4.4h10.4a1.6 1.6 0 0 1 1.6 1.6v13.6H7.6A1.6 1.6 0 0 1 6 18V4.4Zm2 0v13.6M10 8.4h5M10 11.6h5',
  chart: 'M4.5 19.5V11m5 8.5V5.5m5 14V13m5 6.5V8',
  scale: 'M12 4.8v14.4M7 7.6h10M12 4.8 7 7.6M12 4.8l5 2.8M4 13.2h5l-2.5-5.6zM15 13.2h5l-2.5-5.6zM4 13.2a2.5 2.5 0 0 0 5 0M15 13.2a2.5 2.5 0 0 0 5 0M8.5 19.2h7',
  shield: 'M12 4 5.5 6.6v5c0 3.9 2.7 7.1 6.5 8.2 3.8-1.1 6.5-4.3 6.5-8.2v-5zM9.4 11.8l2 2 3.2-3.6',
  gear: 'M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M19.4 12a7.4 7.4 0 0 0-.2-1.6l1.8-1.3-1.8-3.1-2.1.9a7.4 7.4 0 0 0-2.7-1.6L14 4h-4l-.4 2.3a7.4 7.4 0 0 0-2.7 1.6l-2.1-.9L3 10.1l1.8 1.3a7.4 7.4 0 0 0 0 3.2L3 15.9 4.8 19l2.1-.9a7.4 7.4 0 0 0 2.7 1.6L10 22h4l.4-2.3a7.4 7.4 0 0 0 2.7-1.6l2.1.9 1.8-3.1-1.8-1.3c.1-.5.2-1 .2-1.6',
  users:
    'M9.2 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M3.4 19.4a5.8 5.8 0 0 1 11.6 0M16.6 11.4a2.8 2.8 0 1 0 0-5.6M19 19.4a4.6 4.6 0 0 0-3.4-4.4',
  tools: 'M14.6 5.2a3.8 3.8 0 0 0 4.6 4.6l-9.4 9.4-4.6-4.6zM4.6 19.4l1.8-1.8',
  exit: 'M13.6 4.6H18a1.6 1.6 0 0 1 1.6 1.6v11.6A1.6 1.6 0 0 1 18 19.4h-4.4M10 8.4 6.4 12l3.6 3.6M6.4 12h8.4',

  // ── controls ────────────────────────────────────────────────────────────
  refresh: 'M19.4 12a7.4 7.4 0 1 1-2.4-5.5M19.6 4.6v4h-4',
  search: 'M11 17.4a6.4 6.4 0 1 0 0-12.8 6.4 6.4 0 0 0 0 12.8M15.8 15.8 19.8 19.8',
  plus: 'M12 5.2v13.6M5.2 12h13.6',
  trash: 'M4.6 7h14.8M9.4 7V4.8h5.2V7M6.6 7l.9 12.2h9l.9-12.2M10.4 10.6v5.6M13.6 10.6v5.6',
  eye: 'M3 12s3.6-6.2 9-6.2S21 12 21 12s-3.6 6.2-9 6.2S3 12 3 12m9 2.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8',
  save: 'M5.4 4.6h11L18.6 7v12.4H5.4zM8.6 4.6v4.8h6.4V4.6M8.6 19.4v-5.6h6.8v5.6',
  print: 'M7.4 9.4V4.6h9.2v4.8M7.4 17.4H5.2v-6.2h13.6v6.2h-2.2M8.2 14.6h7.6v4.8H8.2z',
  pause: 'M9.6 5.2v13.6M14.4 5.2v13.6',
  cross: 'M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6',
  upload: 'M12 15.6V5.2m0 0L8.4 8.8M12 5.2l3.6 3.6M4.6 18.8h14.8',
  barcode: 'M4.6 5.4v13.2M7.6 5.4v13.2M10.6 5.4v9.4M13.6 5.4v13.2M16.6 5.4v9.4M19.4 5.4v13.2',
  calendar: 'M4.6 6.6h14.8v12.8H4.6zM4.6 10.4h14.8M8.4 4.6v3.8M15.6 4.6v3.8',
  chevron: 'M7.4 10.2 12 14.8l4.6-4.6',
  'chevron-left': 'M13.8 7.4 9.2 12l4.6 4.6',
  'chevron-right': 'M10.2 7.4 14.8 12l-4.6 4.6',
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const path = PATHS[name] ?? PATHS['gear']
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // One weight, set once. No glyph is allowed to override it.
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  )
}
