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
    /**
     * ── The chrome is dark ──────────────────────────────────────────────────
     *
     * Gold is a mid-value yellow. On white it has nowhere to go: no matter how
     * deep the hex, a mid-value colour on a light ground is low contrast and
     * reads washed out. Gold glows against darkness, which is why a jewellery
     * shop is a dark room with lit cases.
     *
     * So the chrome — sidebar, top bar, status bar — is near-black, and it
     * frames a bright working area that is untouched. The contrast between the
     * two IS the design; the gold is simply what that contrast is made of.
     *
     * Every value below is measured against chromeInk (relative luminance
     * 0.0062). WCAG contrast ratios:
     *
     *   chromeText         12.7 : 1
     *   chromeTextMuted     5.7 : 1
     *   goldOnDark          9.4 : 1
     *   goldOnDarkBright   13.0 : 1
     *
     * All four clear 4.5:1 with room to spare.
     */
    chromeInk: '#15120E',
    /** The top bar, one step up, so the two dark surfaces read as layers. */
    chromeInkRaised: '#1D1914',
    chromeLine: 'rgba(255, 255, 255, 0.08)',
    chromeText: 'rgba(255, 255, 255, 0.82)',
    chromeTextMuted: 'rgba(255, 255, 255, 0.52)',
    chromeHover: 'rgba(255, 255, 255, 0.06)',
    /** A scrollbar thumb on dark. The light-side thumb vanishes against ink. */
    chromeScrollThumb: 'rgba(255, 255, 255, 0.16)',
    /** EXIT, and errors shown in the chrome. The light-side red is unreadable here. */
    chromeDanger: '#E06C63',
    chromeDangerFill: 'rgba(224, 108, 99, 0.1)',
    /** The close button's hover, the one Windows convention worth keeping. */
    chromeClose: '#C42B1C',

    // The old light-chrome tokens. Retained as aliases of the surfaces they
    // now name so nothing outside the chrome had to be rewritten.
    navy: '#FFFFFF',
    navyDeep: '#FAF9F7',
    navyHover: '#FAF9F7',
    navyMuted: '#6B6659',

    // ── gold ────────────────────────────────────────────────────────────────
    //
    // Deep brass, not mustard. The old #C9A227 is retired: on a screen it reads
    // as a yellow, and a yellow used at 10-15% tint reads as beige. This ramp is
    // darker and less saturated, which is what metal actually looks like, and it
    // is used at FULL strength on thin elements rather than washed out on broad
    // ones. A 2px line of #B8860B is brass; a 200px panel of #F6EAC6 is cream.
    //
    /** Text-weight gold. Clears contrast on white, so labels can be gold. */
    goldDeep: '#7A5C00',
    /** The core brass. This is the brand colour. */
    gold: '#A67C00',
    /** Lines, rules, indicators, rings — everything 1-3px. */
    goldMetal: '#B8860B',
    /** Accents on dark only. Never on white. */
    goldBright: '#D4AF37',
    /** The highlight stop in a brushed-metal gradient. Never a fill. */
    goldGlint: '#E8CC7A',
    /** The one surviving tint on the LIGHT side, under the active nav item. */
    goldTint: '#F2E7C4',

    // Gold on dark can and must be brighter than gold on white — the ground is
    // doing the contrast work now, so the metal is free to catch the light.
    /** Nav labels, rate figures, the wordmark. */
    goldOnDark: '#D9B451',
    /** The active nav label and the crest initials. The brightest thing on ink. */
    goldOnDarkBright: '#EFD68A',
    /** The active nav item's fill. A wash of the metal, not a block of it. */
    goldActiveFill: 'rgba(217, 180, 81, 0.12)',
    /** The user chip's avatar disc. */
    goldAvatarFill: 'rgba(217, 180, 81, 0.15)',

    // ── surfaces ────────────────────────────────────────────────────────────
    /**
     * Ivory, and deliberately several steps off white.
     *
     * The old #FAF7F0 was so close to the #FFFFFF cards that the only thing
     * separating them was the 1px border — which is why removing borders was
     * impossible and why the whole screen read as clinical. At this value a
     * white card lifts off the page on its own and the border becomes optional.
     */
    // Warm but near-NEUTRAL. The yellow is pulled out of every one of these,
    // because a yellow-tinted neutral gives gold nothing to contrast against —
    // the brass simply dissolved into the page. Yellow now lives only in the
    // gold ramp above, which is what makes it read as a colour at all.
    canvas: '#F4F3F0',
    surface: '#FFFFFF',
    surfaceMuted: '#FAF9F7',
    /** Card headers, table headers, table footers. */
    surfaceHeader: '#F2F1ED',
    border: '#E4E2DC',
    borderStrong: '#CBC7BD',
    /**
     * The rule between table rows. Barely darker than the row it sits under —
     * a ledger wants to read as lines of figures, not as a grid of boxes.
     */
    rule: '#EDEBE5',

    /**
     * ── The working area has three levels ───────────────────────────────────
     *
     * White cards, a warm parchment mid-layer, and ink. Everything used to sit
     * at the same white value, so the card, the table, the row and the page
     * behind them were one undifferentiated sheet and the eye had nothing to
     * rest on. Layering fixes that; saturation would not, which is why no green,
     * blue or purple comes back with it.
     *
     * Measured, not eyeballed:
     *   goldDeep on parchment    5.5 : 1
     *   goldOnDark on inkPanel   8.5 : 1
     *   text on rowAlt          17.6 : 1
     */
    /** Headers, totals, tabs, secondary buttons, paper artefacts. */
    parchment: '#F5F0E3',
    /** A header on parchment, and the pressed state of a parchment button. */
    parchmentDeep: '#EDE5D2',
    parchmentLine: '#DFD4B8',
    /** A tab hover: parchment at half strength. */
    parchmentSoft: 'rgba(245, 240, 227, 0.5)',
    /** Zebra striping. Two steps off white, no more. */
    rowAlt: '#FBF9F4',
    rowHover: 'rgba(217, 180, 81, 0.1)',
    rowFocus: 'rgba(217, 180, 81, 0.16)',
    /**
     * Table headers and the summary strip. One step LIGHTER than chromeInk, so
     * it reads as content carrying the chrome's language rather than as a piece
     * of chrome that has wandered into the page.
     */
    inkPanel: '#211C15',
    /** A positive figure on inkPanel. The light-side green is unreadable there. */
    positiveOnDark: '#5FBF7F',

    // ── text ────────────────────────────────────────────────────────────────
    /** Near-black with a brown undertone, which is what the serif titles want. */
    text: '#16130C',
    textMuted: '#6B6659',
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

    // The secondary slip actions. Tinted, never saturated: each is a wash of
    // its own meaning over parchment, so the row reads as one family with one
    // brass primary in it rather than as five competing signals.
    actionSavePrintFill: '#F5EAD0',
    actionCancelFill: '#FBEEEA',
    actionCancelBorder: '#E8C4BC',
    actionCancelHover: '#F0E0D8',

    /** A control that exists but whose module is not built yet. */
    disabledSurface: '#F2F1ED',
    disabledText: '#A39E92',
  },

  size: {
    // ── chrome ──────────────────────────────────────────────────────────────
    sidebarWidth: '248px',
    /**
     * The icon-only rail.
     *
     * 64px is a 40px item plus 12px either side: the icon stays on the same
     * optical centre it has when expanded, so collapsing moves the glyphs
     * sideways and nothing else. Narrower and the 20px icon starts touching
     * the brass indicator bar.
     */
    sidebarWidthCollapsed: '64px',
    /** Below this the sidebar collapses itself. See App.tsx. */
    sidebarAutoCollapseBelow: '1280px',
    /**
     * The drag strip along the top edge of the content area.
     *
     * All that is left of the chrome that used to run across the top. The top
     * bar was 76px and the status bar 32px; together with a 30px module title
     * and its margins they cost every screen a little over 200px of height to
     * carry a rate two screens use, a clock, and four facts nobody reads twice.
     *
     * 28px is the floor for a frameless window, not a preference: below about
     * 24px there is nowhere left to grab that is not also a control, and this
     * strip is the ONLY drag region in the application. The three window
     * buttons float at its right and opt out with no-drag.
     */
    dragStripHeight: '28px',
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

    /** The sidebar crest. */
    crest: '44px',

    // ── the retail screen ───────────────────────────────────────────────────
    /** The fixed label stack down the left of the item matrix. */
    itemLabelWidth: '150px',
    /** One item column. Four fit the card; the fifth scrolls it sideways. */
    itemColumnWidth: '158px',
    /**
     * A cell in the item matrix.
     *
     * Ten of these are a FIXED cost — the label stack always has ten rows,
     * whatever the sale — so this is the tightest number that still seats 14px
     * text comfortably. It is measured against the 830px budget, not chosen.
     */
    itemCellHeight: '18px',
    /** A slip tab. Two lines of label plus the slip's own total. */
    slipTabHeight: '44px',
    /** The right-hand summary column. Narrower than the old 320px rail. */
    railWidth: '300px',
    /** A row in SUMMARY or BILL CALCULATIONS. */
    sumRowHeight: '22px',
    /** The header strip: invoice fields, party fields and the rate card. */
    headStripHeight: '92px',
    /** The bottom action bar. */
    actionBarHeight: '52px',

    // ── the gold rate card ──────────────────────────────────────────────────
    /** The ink header strip on the rate card, and on the item/DETAILS cards. */
    rateCardHead: '20px',
    /** One purity cell. Four of them, and "237,970" at 15px sets the floor. */
    rateCardCell: '96px',

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

    // ── retail items table ──────────────────────────────────────────────────
    // Eleven columns, against the wholesale grid's nine, in the same 918px the
    // left column has beside a 248px sidebar and a 320px rail. They are a
    // budget, measured from the widest real content at 13px tabular figures
    // plus the 24px of cell padding, not eight independent preferences:
    //
    //   36 (#) + 56 + 74×3 + 78 + 84×2 + 116 + 76 (action) = 752
    //   919 − 752 = 167 … minus the 16px the column's own scrollbar takes when
    //   the fixed cards push it over its height budget, which is the normal
    //   state at 830px of window. Measured, not assumed: at 167 the table
    //   scrolled sideways inside its card on every sale.
    //
    // Reusing the wholesale widths put the table 118px over its own card and it
    // scrolled sideways on every sale.
    /** "22K". The narrowest column that still fits its own heading. */
    colPurity: '56px',
    /** Gross, Net and Wastage. "47.240" at 13px tabular is 48px plus padding. */
    colWeight: '74px',
    /** Fine weight, one step wider: it is the emphasised figure on the row. */
    colFine: '78px',
    /** Labour and Stone. "4,500.00" needs more than a weight does. */
    colCharge: '84px',
    /** An amount. "1,102,596.13" is the widest content in the table. */
    colRetailAmount: '116px',
    /**
     * 136, not 148. Measured with the sidebar EXPANDED, which is the tighter of
     * the two: the left column is 919px there, and the entry column's own
     * scrollbar takes 15 of them. At 148 the items table grew its own
     * horizontal scrollbar, which cost 8px of the table's height and dropped it
     * from six visible rows to five.
     */
    colRetailNameMin: '136px',

    /**
     * A row in the CALCULATIONS rail.
     *
     * Shorter than a form control on purpose. There are twelve of these in a
     * 320px column beside a table that must not shrink, and at the full 38px
     * control height the rail alone wanted 640px of an 830px window.
     */
    calcRowHeight: '32px',
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
    // Still warm, but the yellow is out of these too — 40,34,20 is a brown-grey,
    // not a brown-yellow. A yellow shadow on a neutral page reads as staining.
    sm: '0 1px 1px rgba(40, 34, 20, 0.05), 0 2px 6px rgba(40, 34, 20, 0.07)',
    md: '0 1px 2px rgba(40, 34, 20, 0.06), 0 6px 18px rgba(40, 34, 20, 0.1)',
    lg: '0 2px 4px rgba(40, 34, 20, 0.07), 0 20px 48px rgba(40, 34, 20, 0.16)',
    /** The one focus ring, on every interactive element. Brass, not mustard. */
    focus: '0 0 0 3px rgba(166, 124, 0, 0.38)',
    /** A pressed button. The surface dents; nothing moves. */
    pressed: 'inset 0 1px 3px rgba(40, 34, 20, 0.18)',
  },

  /**
   * Brushed brass, for the three places a metal edge belongs: the crest ring,
   * the module-title rule and the active nav indicator.
   *
   * The stops are goldMetal → goldGlint → gold. On a 2-3px element the ramp
   * reads as light catching a machined edge. On anything wider it reads as a
   * gradient, which is the one thing this interface must never look like — so
   * it is never applied to a fill.
   */
  gradient: {
    brass: 'linear-gradient(105deg, #B8860B, #E8CC7A, #A67C00)',
    /**
     * A solid brass FILL, for the one primary button in the working area.
     *
     * Permitted where the 3px rule is not, because the chrome now carries the
     * darkness and this is the only brass fill on a white ground — it is the
     * primary action, and it should look like it is made of the same metal as
     * the frame around the screen.
     */
    brassFill: 'linear-gradient(105deg, #B8860B, #A67C00, #B8860B)',
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
  for (const [key, value] of Object.entries(theme.gradient)) {
    lines.push(`  --gradient-${kebab(key)}: ${value};`)
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
