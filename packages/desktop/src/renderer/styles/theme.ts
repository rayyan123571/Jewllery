/**
 * Every colour and dimension in the application, in one place.
 *
 * Nothing else in the renderer may hard-code a colour, a font, a spacing step or
 * a chrome dimension — if a component needs one it is added here first. That is
 * what makes a re-theme a change to this file rather than a sweep through every
 * screen.
 *
 * Values are CSS custom properties so they can be used from plain CSS as well as
 * from TypeScript, and so a future per-shop theme is a variable swap rather than
 * a rebuild.
 *
 * ── The scale ──────────────────────────────────────────────────────────────
 * The first cut of this file was drawn straight off the mockup, which was drawn
 * at Windows-Forms density: 12px body text, 26px inputs, 22px table rows. That
 * is legible for a five-minute demo and punishing for an eight-hour shift. The
 * whole scale is one step larger now — 14px body, 38px inputs, 40px rows — and
 * the chrome is proportionally wider. Nothing about the colour language changed;
 * it was never the problem.
 */

export const theme = {
  colour: {
    // ── chrome ──────────────────────────────────────────────────────────────
    // Sidebar, top bar and status bar. These were a dark navy spine; the shop
    // asked for golden-and-white, so they are now white and warm near-whites.
    // The token NAMES are kept deliberately: renaming them would mean editing
    // every rule that uses them, and the point of a token file is that a
    // re-theme is a change to these values alone.
    /** The sidebar and top-bar surface. White — the chrome is not a colour block. */
    navy: '#FFFFFF',
    /** The deeper chrome tone: status bar, chrome dividers. */
    navyDeep: '#FDFAF3',
    /** Hover on a chrome control. */
    navyHover: '#FDFAF3',
    /** Sidebar section labels and muted chrome text. */
    navyMuted: '#6B6153',

    // ── gold ────────────────────────────────────────────────────────────────
    /** The accent. Used as a 3px indicator and a border, never as a large fill. */
    gold: '#C9A227',
    goldBright: '#E0BE4E',
    /** The active-item and callout fill. Gold at full strength is loud here. */
    goldSoft: '#F6EAC6',
    /** goldSoft again, at the strength a whole table row can carry. */
    goldWash: '#FCF6E6',
    /** Rate figures, the wordmark, and the active sidebar label on goldSoft. */
    goldText: '#8A6D10',

    // ── surfaces ────────────────────────────────────────────────────────────
    /**
     * Ivory, and deliberately several steps off white.
     *
     * The old #FAF7F0 was so close to the #FFFFFF cards that the only thing
     * separating them was the 1px border — which is why removing borders was
     * impossible and why the whole screen read as clinical. At this value a
     * white card lifts off the page on its own and the border becomes optional.
     */
    canvas: '#F6F1E6',
    surface: '#FFFFFF',
    surfaceMuted: '#FBF7EE',
    /** Card headers, table headers, table footers. */
    surfaceHeader: '#F8F2E3',
    border: '#EBE1CC',
    borderStrong: '#D8C79E',
    /**
     * The rule between table rows. Barely darker than the row it sits under —
     * a ledger wants to read as lines of figures, not as a grid of boxes.
     */
    rule: '#F0E9DA',

    // ── text ────────────────────────────────────────────────────────────────
    /** Near-black warmed towards the paper, not a cold #000. */
    text: '#1F1B14',
    textMuted: '#6B6153',
    /** Stays white: it is used on the coloured action buttons, not on chrome. */
    textInverse: '#FFFFFF',

    // ── semantic ────────────────────────────────────────────────────────────
    /** Remaining weight when positive, and Balance Amount when settled. */
    positive: '#157F3C',
    /** Cut weight, delete icons, and a balance the shop owes. */
    negative: '#C0271F',
    info: '#1D4ED8',
    infoBright: '#2563EB',
    /** Tinted grounds for the three banner states. Never colour-on-colour. */
    positiveSoft: '#EAF5EE',
    negativeSoft: '#FBEDEC',
    warnSoft: '#FDF6E3',
    warnBorder: '#E3CC7E',
    warnText: '#7A5C09',

    // ── action buttons ──────────────────────────────────────────────────────
    // Desaturated ~8% from the mockup's values. Five saturated blocks in a row
    // read as five warnings; at this strength they read as five buttons.
    actionSave: '#1D9A51',
    actionSavePrint: '#2D64E1',
    actionPrint: '#8144E4',
    actionHold: '#D6A638',
    /** The hold colour is too light to read as a label on white. This is not. */
    actionHoldText: '#8A6A10',
    actionCancel: '#D23232',
    /** EXIT, in the sidebar foot. The one control that closes the application. */
    actionExit: '#B3261E',

    /** A control that exists but whose module is not built yet. */
    disabledSurface: '#F2ECDD',
    disabledText: '#A0937C',
  },

  size: {
    // ── chrome ──────────────────────────────────────────────────────────────
    sidebarWidth: '248px',
    titleBarHeight: '32px',
    topBarHeight: '76px',
    statusBarHeight: '32px',
    /** The 80mm invoice preview column on the right. */
    previewWidth: '320px',

    // ── controls ────────────────────────────────────────────────────────────
    /** Text inputs and selects. Was 26px, which is a Windows-95 target. */
    controlHeight: '38px',
    /** A table row, and the height of a cell editor inside one. */
    rowHeight: '40px',
    cellPadding: '10px 12px',
    /** Toolbar and dialog buttons. */
    buttonHeight: '44px',
    /** Sign-in fields. One step above a form field: there are only two of them. */
    loginInputHeight: '40px',
    /** The five slip actions and the login submit: the biggest targets. */
    buttonHeightLarge: '48px',
    /** 14 modules must fit 768px of screen without the sidebar scrolling. */
    sidebarItemHeight: '40px',
    tabHeight: '40px',
    /** The whole summary strip. One line: label left, figure right. */
    statStripHeight: '60px',
    /** The attached segment on an input group — the "+" and the search glyph. */
    inputGroupButton: '36px',

    radius: '8px',
    radiusLarge: '14px',
    radiusPill: '999px',

    /** The gold rule under a module title. Short and deliberate, not full width. */
    titleRuleWidth: '64px',
    /** The sidebar crest. */
    crest: '44px',

    /** Scrollbars. 8px, no stepper buttons — see the ::-webkit rules. */
    scrollbar: '8px',

    // ── item-details columns ────────────────────────────────────────────────
    // The table is `table-layout: fixed`, so these ARE the layout. Widths live
    // here rather than on the <th> elements because a column that is one pixel
    // too narrow clips a heading, and that is a dimension like any other.
    // These are a budget, not eight independent choices: they are subtracted
    // from the table's width and whatever is left becomes Item Name, which has
    // no token because it is the column that should absorb the slack. The first
    // cut summed to 854px of a 860px table and left Item Name 6px wide.
    colIndex: '36px',
    colGross: '88px',
    colKatt: '88px',
    colKhalis: '92px',
    colRate: '96px',
    colAmount: '112px',
    colRemarks: '92px',
    /** 64px ellipsised its own "Action" heading. This fits it with room over. */
    colAction: '76px',
    /**
     * The floor under Item Name, the one column with no width of its own.
     *
     * Below the sum of the fixed columns plus this, the table scrolls sideways
     * inside its card instead of squeezing the name to a few pixels — which is
     * what happened at 1366px wide, where the fixed columns alone left it 22px.
     */
    colNameMin: '180px',
  },

  /** The spacing scale. Every gap and pad in the application is one of these. */
  space: {
    '4': '4px',
    '8': '8px',
    '12': '12px',
    '16': '16px',
    '24': '24px',
    '32': '32px',
    '48': '48px',
  },

  /**
   * Elevation, warm-tinted rather than grey. A grey shadow over a warm white
   * ground reads as dirt; the same shadow mixed towards the paper reads as depth.
   */
  /**
   * Elevation, warm-tinted rather than grey, and two-layer.
   *
   * A single soft blur reads as fog. A tight contact shadow plus a wider
   * ambient one reads as an object resting on paper — which is what a card on
   * an ivory ground is meant to be. Every value is mixed towards the paper
   * (74,58,20 is a warm brown), never neutral: a grey shadow over ivory looks
   * like dirt on the page.
   */
  shadow: {
    sm: '0 1px 1px rgba(74, 58, 20, 0.04), 0 2px 6px rgba(74, 58, 20, 0.05)',
    md: '0 1px 2px rgba(74, 58, 20, 0.05), 0 6px 18px rgba(74, 58, 20, 0.07)',
    lg: '0 2px 4px rgba(74, 58, 20, 0.06), 0 20px 48px rgba(74, 58, 20, 0.13)',
    /** The one focus ring, on every interactive element. See index.css. */
    focus: '0 0 0 3px rgba(201, 162, 39, 0.35)',
  },

  /**
   * Three faces, bundled locally. See styles/fonts.css.
   *
   * Segoe UI was never a decision, it was a default — and at 13–15px, which is
   * where almost every word in this application lives, it is visibly looser and
   * blurrier than Inter. The whole interface is set in Inter now, and the serif
   * is reserved for the four places the brand actually speaks.
   */
  font: {
    /** Everything: labels, buttons, menu items, body. */
    ui: "'Inter Variable', 'Segoe UI', system-ui, sans-serif",
    /** Wordmark, module titles, invoice header. NOTHING else. */
    brand: "'Cormorant Garamond Variable', Georgia, 'Times New Roman', serif",
    /**
     * Figures. The same face as the UI, with tabular numerals switched on —
     * a jeweller reads columns of weights all day, and if the decimal points
     * do not line up nothing else on the screen matters.
     */
    numeric: "'Inter Variable', 'Segoe UI', system-ui, sans-serif",
    /** The feature string every figure carries. Applied via --font-numeric-features. */
    numericFeatures: "'tnum' 1, 'ss01' 1",
    size: {
      /** Section headings and overlines only. Nothing readable-as-prose. */
      xxs: '11px',
      xs: '12px',
      sm: '13px',
      base: '14px',
      md: '15px',
      lg: '18px',
      xl: '22px',
      /** Stat figures. The second-largest thing on any screen. */
      xxl: '26px',
      /** Module titles, in the display serif. The largest, by a clear margin. */
      display: '30px',
      /** The wordmark in the sidebar lockup. */
      brand: '17px',
      /** The wordmark on the login card, where there is room for it to breathe. */
      brandLarge: '26px',
    },
  },

  /**
   * Letter-spacing. Small caps labels need air or they read as a smear; display
   * serif at 30px needs slightly negative tracking or it reads as spaced-out.
   */
  tracking: {
    display: '-0.01em',
    label: '0.1em',
    tagline: '0.22em',
  },

  line: {
    body: '1.5',
    heading: '1.2',
    /** The two-line wordmark. Tight enough that it reads as one lockup. */
    brand: '1.05',
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
  for (const [key, value] of Object.entries(theme.space)) {
    lines.push(`  --space-${key}: ${value};`)
  }
  for (const [key, value] of Object.entries(theme.shadow)) {
    lines.push(`  --shadow-${kebab(key)}: ${value};`)
  }
  lines.push(`  --font-ui: ${theme.font.ui};`)
  lines.push(`  --font-brand: ${theme.font.brand};`)
  lines.push(`  --font-numeric: ${theme.font.numeric};`)
  lines.push(`  --font-numeric-features: ${theme.font.numericFeatures};`)
  for (const [key, value] of Object.entries(theme.font.size)) {
    lines.push(`  --font-size-${kebab(key)}: ${value};`)
  }
  for (const [key, value] of Object.entries(theme.tracking)) {
    lines.push(`  --tracking-${kebab(key)}: ${value};`)
  }
  for (const [key, value] of Object.entries(theme.line)) {
    lines.push(`  --line-${kebab(key)}: ${value};`)
  }
  return `:root {\n${lines.join('\n')}\n}`
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
