import { moduleById, type ModuleId } from './modules.js'

/**
 * What an unbuilt module shows.
 *
 * Navigating to a module that is not built has to lead somewhere honest.
 * A blank screen reads as a crash; a screen that names the milestone reads as
 * a plan. That is the same reasoning as the disabled controls: unfinished work
 * should be visible as unfinished, never mistaken for broken.
 *
 * Distinct from EmptyState, which is a built screen with no data in it. Two
 * different situations, and the operator can act on the difference — one is
 * "come back in M4", the other is "type something".
 */
export function ModulePlaceholder({ id }: { id: ModuleId }) {
  const module = moduleById(id)
  const built = module.builtIn === null

  return (
    <div className="placeholder">
      <div>
        <PlaceholderMark />
        <div className="placeholder__badge">
          {built ? 'Screen not built yet' : `Coming in ${module.builtIn}`}
        </div>
        <div className="placeholder__title">{module.label}</div>
        <p className="placeholder__body">
          {built
            ? 'The underlying feature is built and working. This screen has not been ' +
              'drawn yet, so its controls are disabled.'
            : `This module is planned for ${module.builtIn}. It appears here from day ` +
              'one so the shape of the application is visible, and its controls are ' +
              'disabled rather than silently doing nothing.'}
        </p>
      </div>
    </div>
  )
}

/**
 * A line-art mark, drawn inline in currentColor.
 *
 * Inline SVG rather than an image file: an offline desktop application should
 * not carry an asset pipeline for eight strokes, and currentColor means the
 * mark re-themes with the text rather than being a fixed-colour picture.
 *
 * A drawing board with a sheet half-drawn on it — the screen is planned, not
 * missing.
 */
function PlaceholderMark() {
  return (
    <svg
      className="placeholder__mark"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="12" y="10" width="48" height="52" rx="4" />
      <path d="M12 22h48" />
      <path d="M20 33h20M20 42h32M20 51h14" strokeDasharray="4 5" />
      <circle cx="19" cy="16" r="1.6" />
      <circle cx="25" cy="16" r="1.6" />
    </svg>
  )
}
