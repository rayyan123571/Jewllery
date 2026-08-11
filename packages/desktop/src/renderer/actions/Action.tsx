import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { actionTitle, type ActionId, type ActionRegistry } from './registry.js'

/**
 * The only way to render an interactive control.
 *
 * Nothing in the renderer may write a bare <button>. Every control goes through
 * here, which means every control is looked up in the registry, which means
 * every control is either wired to a handler or rendered disabled with hover
 * text naming the module it belongs to. There is no third path.
 *
 * shell.test.tsx enforces that by rendering the real shell and failing on any
 * <button> in the DOM without a data-action attribute — so a hand-written button
 * fails the build rather than quietly shipping as a no-op.
 */

const ActionRegistryContext = createContext<ActionRegistry | null>(null)

export function ActionsProvider({
  registry,
  children,
}: {
  registry: ActionRegistry
  children: ReactNode
}) {
  return (
    <ActionRegistryContext.Provider value={registry}>{children}</ActionRegistryContext.Provider>
  )
}

export function useActions(): ActionRegistry {
  const registry = useContext(ActionRegistryContext)
  if (!registry) {
    throw new Error('Action used outside an ActionsProvider')
  }
  return registry
}

export type ActionVariant =
  | 'sidebar'
  | 'topbar'
  | 'tab'
  | 'primary'
  | 'secondary'
  /** Same size as primary, but its semantic colour on the border and label only. */
  | 'outline'
  | 'toolbar'
  | 'ghost'
  | 'quick'
  | 'icon'
  /** Attached to an input, sharing its border — the "+" and the search glyph. */
  | 'segment'
  /**
   * A labelled segment that switches the MEANING of the input beside it, e.g.
   * a labour charge being a fixed amount or an amount per tola. Wider than a
   * `segment` because it carries a word rather than a glyph, and it can be
   * active — the number in the box means nothing without it.
   */
  | 'mode'
  /** A row in a popover menu. */
  | 'menu'
  | 'window'
  | 'plain'

interface ActionProps {
  readonly id: ActionId
  readonly children: ReactNode
  readonly variant?: ActionVariant
  /** Marks the current module in the sidebar and top bar. */
  readonly active?: boolean
  readonly className?: string
  readonly style?: CSSProperties
  /** Accessible name when the control renders only an icon. */
  readonly ariaLabel?: string
  /**
   * A handler for controls that need per-instance context the registry cannot
   * hold — a rate row knows WHICH purity it is, and the registry is a flat list
   * of controls, not a list of rows.
   *
   * When given, it runs instead of the entry's own `run`. The entry must still
   * exist and still be `ready`, so both tests keep their grip: the id resolves,
   * the button is enabled, and it is not a silent no-op.
   */
  readonly onActivate?: () => void
  /**
   * Activate on mousedown instead of click.
   *
   * For a control inside a list that a blur would close underneath it: by the
   * time click fires the list is gone and the click lands on nothing. Still a
   * registry action, still disabled when the module is not built — only the
   * event that triggers it moves.
   */
  readonly activateOnMouseDown?: boolean
  /**
   * Submits the surrounding <form> instead of running the handler directly.
   *
   * For a control that is a form's submit: it keeps Enter-in-a-field working,
   * which is how the whole screen is driven at a counter. The action still
   * resolves in the registry and is still disabled when its module is not
   * built, so both tests keep their grip.
   */
  readonly type?: 'button' | 'submit'
  /**
   * Temporarily unavailable because this action is already in flight.
   *
   * Can only ever ADD `disabled` to a ready control — it can never enable one
   * the registry says is not built. A transient busy state is not a third kind
   * of action, it is a ready action mid-run.
   */
  readonly busy?: boolean
}

export function Action({
  id,
  children,
  variant = 'plain',
  active = false,
  className,
  style,
  ariaLabel,
  onActivate,
  activateOnMouseDown = false,
  type = 'button',
  busy = false,
}: ActionProps) {
  const registry = useActions()
  const action = registry[id]
  const notBuilt = action.kind === 'not-built'

  const activate = (): void => {
    if (onActivate) onActivate()
    // Narrowed rather than asserted: a not-built action has no `run` field at
    // all, so there is nowhere for a silent no-op to hide even here.
    else if (action.kind === 'ready') void action.run()
  }

  return (
    <button
      type={type}
      // Read by shell.test.tsx. Every button in the DOM must carry this.
      data-action={id}
      data-action-state={action.kind}
      className={[`action action--${variant}`, active ? 'is-active' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
      // A real disabled attribute, not a class that looks disabled — the control
      // must be genuinely unclickable and skipped by keyboard navigation.
      // `busy` may only add to this, never subtract: a not-built control is
      // disabled whatever the screen claims.
      disabled={notBuilt || busy}
      title={actionTitle(action)}
      aria-label={ariaLabel ?? undefined}
      onMouseDown={
        notBuilt || !activateOnMouseDown
          ? undefined
          : (event) => {
              // Keeps focus where it is, so the list this sits in survives long
              // enough for the handler to run.
              event.preventDefault()
              activate()
            }
      }
      onClick={
        notBuilt
          ? undefined
          : (event) => {
              // In mousedown mode the pointer path has already fired. A click
              // with detail 0 came from the keyboard, which has no mousedown —
              // without this, Enter and Space would do nothing.
              if (activateOnMouseDown && event.detail !== 0) return
              activate()
            }
      }
    >
      {children}
      {notBuilt ? <span className="action__lock" aria-hidden="true" /> : null}
    </button>
  )
}
