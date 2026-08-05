/**
 * The constants that make a slip legible on 80mm thermal paper.
 *
 * Every value here is carried across from the working reference implementation
 * (GoldLab `electron/rasterPrint.cjs`), where each was arrived at by looking at
 * paper coming out of a real printer. They are not design preferences.
 */

/**
 * 576 dots = 72.1mm printable width × 8 dots/mm at 203dpi.
 *
 * The HTML is authored at exactly this width in CSS pixels so that one CSS pixel
 * becomes one printer dot. Nothing is scaled: dot column 0 lands on head dot 0,
 * which is what makes left/right drift structurally impossible rather than
 * something to be tuned per printer.
 */
export const RECEIPT_WIDTH_DOTS = 576

/**
 * Urdu-first stack. Nastaliq faces render Urdu correctly; Arial does not, and a
 * fallback that silently reshapes Urdu letters produces a slip nobody can read.
 */
export const FONT_STACK =
  "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"

/** Latin/number face. Used for figures, which must not go through Nastaliq. */
export const NUMERIC_FONT = 'Arial'

/**
 * Thin strokes disappear under a 1-bit threshold at 203dpi — the pixel is either
 * full black or nothing, and an anti-aliased grey edge becomes white. Weight 700
 * plus a small text-stroke keeps every glyph as real ink.
 */
export const LABEL_WEIGHT = 700
export const VALUE_WEIGHT = 700
export const STROKE = '-webkit-text-stroke:0.4px #000;'

export const LABEL_PX = 24
export const VALUE_PX = 22
export const SMALL_PX = 18

/**
 * The item table carries six columns — item, gross, katt, rate, khalis, amount —
 * and at VALUE_PX they do not fit in 576 dots: the amount column runs off the
 * edge and the last figure is lost. Found by rendering the slip at head width
 * and looking at it, not by reading the code.
 *
 * These sizes are what make six columns fit. Amounts are the widest content
 * (seven digits plus separators), so they get their own, smallest size.
 */
export const ITEM_LABEL_PX = 17
export const ITEM_VALUE_PX = 16
export const ITEM_AMOUNT_PX = 15
export const ITEM_CELL_PADDING = '2px 3px'

/**
 * Escapes user text before it reaches the slip.
 *
 * A party name is typed by a shopkeeper and could contain `<` or `&`. Injecting
 * it raw would at best corrupt the layout and at worst break the measurement
 * script the print pipeline relies on.
 */
export function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(
      /[&<>"']/g,
      (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    )
}

/**
 * Reports the rendered height back to the print pipeline.
 *
 * The offscreen window has no idea how tall a slip is until it lays out, and a
 * fixed height would either clip a long slip or feed blank paper after a short
 * one. The pipeline awaits `window.__ready`, which resolves once fonts have
 * loaded — measuring before that returns the height of the fallback face and
 * cuts the last line off.
 */
export const READY_SCRIPT =
  '<script>window.__ready=(async()=>{' +
  'try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
  'await new Promise(r=>setTimeout(r,80));' +
  'var el=document.querySelector("[data-measure]")||document.body;' +
  'var h=Math.ceil(el.getBoundingClientRect().height)+2;' +
  'document.body.style.height=h+"px";return h})()</scr' +
  'ipt>'
