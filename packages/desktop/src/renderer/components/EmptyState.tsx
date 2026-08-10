import { Action } from '../actions/Action.js'
import type { ActionId } from '../actions/registry.js'

/**
 * What a built screen shows when it has nothing to show yet.
 *
 * Distinct from ModulePlaceholder, and the distinction is the point:
 * ModulePlaceholder means *this screen does not exist yet*, this means *this
 * screen works and there is no data in it*. Confusing the two teaches the
 * operator that empty means broken.
 *
 * A bare header row over blank space is the failure this exists to prevent. It
 * reads as a table that failed to load, and the operator's next move is to
 * click things until something happens.
 *
 * The optional action is always a LIVE one. An empty state whose only offer is
 * a disabled button is worse than no offer at all.
 */
export function EmptyState({
  title,
  line,
  actionId,
  actionLabel,
}: {
  title: string
  line: string
  actionId?: ActionId
  actionLabel?: string
}) {
  return (
    <div className="empty">
      <EmptyMark />
      <p className="empty__title">{title}</p>
      <p className="empty__line">{line}</p>
      {actionId && actionLabel ? (
        <Action id={actionId} variant="toolbar">
          {actionLabel}
        </Action>
      ) : null}
    </div>
  )
}

/**
 * A line-art mark, drawn inline in currentColor.
 *
 * Inline rather than an image file for the same reason the shell's icons are:
 * an offline desktop application should not depend on an asset pipeline or a
 * CDN for three strokes, and currentColor means it re-themes with the text.
 */
function EmptyMark() {
  return (
    <svg
      className="empty__mark"
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="7" width="30" height="34" rx="3" />
      <path d="M15 16h18M15 23h18M15 30h11" />
    </svg>
  )
}
