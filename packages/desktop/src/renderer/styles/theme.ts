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
    /** Title bar, sidebar and status bar. The dark navy spine of the app. */
    navy: '#1B2A4A',
    navyDeep: '#16233D',
    navyHover: '#243A63',
    /** Sidebar section labels and muted chrome text. */
    navyMuted: '#8FA0BF',

    // ── gold ────────────────────────────────────────────────────────────────
    /** The active sidebar item and the active module in the top bar. */
    gold: '#D4A029',
    goldBright: '#E8A83A',
    goldSoft: '#F0C755',
    /** Rate figures in the top-right panel, and the logo mark. */
    goldText: '#E3B341',

    // ── surfaces ────────────────────────────────────────────────────────────
    canvas: '#EEF1F5',
    surface: '#FFFFFF',
    surfaceMuted: '#F7F9FC',
    /** Table header rows and the summary panel headers. */
    surfaceHeader: '#F1F4F9',
    border: '#D8DEE6',
    borderStrong: '#B9C2CF',

    // ── text ────────────────────────────────────────────────────────────────
    text: '#1F2937',
    textMuted: '#6B7280',
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
    disabledSurface: '#E5E9F0',
    disabledText: '#9AA5B4',
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
