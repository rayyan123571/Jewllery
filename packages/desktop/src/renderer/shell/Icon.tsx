/**
 * Small inline icons for the sidebar and module bar.
 *
 * Inline rather than an icon package: an offline desktop app should not depend
 * on a font or an icon CDN, and these are the only glyphs the shell needs.
 * Drawn on a 24-unit grid with a 1.7 stroke to match the mockup's weight.
 */

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  cart: 'M3 4h2l2.2 10.5h10.1L20 7H6M9 20a1 1 0 1 0 2 0 1 1 0 0 0-2 0m7 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  wholesale: 'M12 3v4m0 0-2.5 2.5M12 7l2.5 2.5M4 11h16l-1.5 9h-13z',
  purchase: 'M3 5h3l2 11h10l2-8H7M8 20a1 1 0 1 0 2 0 1 1 0 0 0-2 0m8 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
  stock: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM4 7.5 12 12m0 0 8-4.5M12 12v9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4.5 20a7.5 7.5 0 0 1 15 0',
  suppliers:
    'M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6m8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M3 20a6 6 0 0 1 12 0m2 0a5 5 0 0 1 4-4.9',
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zm2 0v14M9 8h6M9 11h6',
  chart: 'M4 20V10m5 10V5m5 15v-7m5 7V8',
  scale: 'M12 4v16M7 8h10M5 8l-2 5a3 3 0 0 0 6 0zm14 0-2 5a3 3 0 0 0 6 0zM8 20h8',
  shield: 'M12 3.5 5 6.5v5c0 4.2 2.9 7.7 7 8.9 4.1-1.2 7-4.7 7-8.9v-5zM9 12l2.2 2.2L15.5 10',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6m8-3a8 8 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a8 8 0 0 0-3-1.7L14 2h-4l-.5 2.7a8 8 0 0 0-3 1.7l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 3.4l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 3 1.7L10 22h4l.5-2.7a8 8 0 0 0 3-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7',
  users:
    'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0m1.5-8a3 3 0 1 0 0-6m4.5 14a5 5 0 0 0-4-4.9',
  tools: 'M14.5 4.5a4 4 0 0 0 5 5l-10 10-5-5zM4 20l2-2',
  exit: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h9',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5.5-1.5L21 21',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12m9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  print: 'M7 9V4h10v5M7 18H5v-6h14v6h-2M8 15h8v5H8z',
  pause: 'M9 5v14M15 5v14',
  cross: 'M6 6l12 12M18 6 6 18',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M4 19h16',
  barcode: 'M4 5v14M7 5v14M10 5v10M13 5v14M16 5v10M20 5v14',
  calendar: 'M4 6h16v14H4zM4 10h16M8 4v4M16 4v4',
  chevron: 'M7 10l5 5 5-5',
  'chevron-left': 'M14 7l-5 5 5 5',
  'chevron-right': 'M10 7l5 5-5 5',
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
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  )
}
