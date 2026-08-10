/**
 * Every colour and dimension in the application, in one place.
 *
 * Read off docs/mockup.png. Nothing else in the renderer may hard-code a colour
 * or a chrome dimension — if a component needs one it is added here first. That
 * is what makes matching the mockup exactly, or reskinning later, a change to
 * this file rather than a sweep through every screen.
 *
 * Values are CSS custom properties so they can be used from plain CSS as well as
 * from TypeScript, and so a future light/dark or per-shop theme is a variable
 * swap rather than a rebuild.
 */

export const theme = {
  colour: {
    // ── chrome ──────────────────────────────────────────────────────────────
    // Sidebar, top bar and status bar. These were a dark navy spine; the shop
    // asked for golden-and-white, so they are now warm near-whites. The token
    // NAMES are kept deliberately: renaming them would mean editing every rule
    // that uses them, and the point of a token file is that a re-theme is a
    // change to these values alone.
    navy: '#FFFCF4',
    navyDeep: '#F7EEDB',
    navyHover: '#F3E6C9',
    /** Sidebar section labels and muted chrome text. */
    navyMuted: '#9A8347',

    // ── gold ────────────────────────────────────────────────────────────────
    /** The active sidebar item and accents throughout. */
    gold: '#C9A227',
    goldBright: '#DDB63C',
    goldSoft: '#F2E3B4',
    /** Rate figures and the logo mark. Darkened to stay readable on white. */
    goldText: '#9C7A12',

    // ── surfaces ────────────────────────────────────────────────────────────
    canvas: '#FBF7EE',
    surface: '#FFFFFF',
    surfaceMuted: '#FDFAF3',
    /** Table header rows and the summary panel headers. */
    surfaceHeader: '#F8F0DD',
    border: '#E6D9BA',
    borderStrong: '#CDBA8E',

    // ── text ────────────────────────────────────────────────────────────────
    /** Charcoal, not black — easier to read for a whole shift. */
    text: '#2B2620',
    textMuted: '#6E6355',
    /** Stays white: it is used on the coloured action buttons, not on chrome. */
    textInverse: '#FFFFFF',

    // ── semantic ────────────────────────────────────────────────────────────
    /** Remaining weight when positive, and Balance Amount when settled. */
    positive: '#16A34A',
    /** Cut weight, delete icons, and a balance the shop owes. */
    negative: '#DC2626',
    info: '#1D4ED8',
    infoBright: '#2563EB',

    // ── action buttons, in the mockup's order ───────────────────────────────
    actionSave: '#16A34A',
    actionSavePrint: '#2563EB',
    actionPrint: '#7C3AED',
    actionHold: '#E0A82E',
    actionCancel: '#DC2626',

    /** A control that exists but whose module is not built yet. */
    disabledSurface: '#F1EBDC',
    disabledText: '#A89C85',
  },

  size: {
    sidebarWidth: '196px',
    titleBarHeight: '32px',
    topBarHeight: '64px',
    statusBarHeight: '26px',
    /** The 80mm invoice preview column on the right. */
    previewWidth: '272px',
    radius: '4px',
    radiusLarge: '6px',
  },

  font: {
    /** Segoe UI is the Windows system face; the mockup is a Windows app. */
    ui: "'Segoe UI', 'Inter', system-ui, sans-serif",
    /** Weights and amounts. Tabular figures keep decimal points in a column. */
    numeric: "'Segoe UI', 'Consolas', monospace",
    size: {
      xs: '10px',
      sm: '11px',
      base: '12px',
      md: '13px',
      lg: '15px',
      xl: '18px',
    },
  },
} as const

/** Emitted into :root so plain CSS can use the same tokens. */
export function themeCssVariables(): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(theme.colour)) {
    lines.push(`  --colour-${kebab(key)}: ${value};`)
  }
  for (const [key, value] of Object.entries(theme.size)) {
    lines.push(`  --size-${kebab(key)}: ${value};`)
  }
  lines.push(`  --font-ui: ${theme.font.ui};`)
  lines.push(`  --font-numeric: ${theme.font.numeric};`)
  for (const [key, value] of Object.entries(theme.font.size)) {
    lines.push(`  --font-size-${kebab(key)}: ${value};`)
  }
  return `:root {\n${lines.join('\n')}\n}`
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
