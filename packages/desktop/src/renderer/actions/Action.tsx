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
  | 'toolbar'
  | 'quick'
  | 'icon'
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
}

export function Action({
  id,
  children,
  variant = 'plain',
  active = false,
  className,
  style,
  ariaLabel,
}: ActionProps) {
  const registry = useActions()
  const action = registry[id]
  const notBuilt = action.kind === 'not-built'

  return (
    <button
      type="button"
      // Read by shell.test.tsx. Every button in the DOM must carry this.
      data-action={id}
      data-action-state={action.kind}
      className={[`action action--${variant}`, active ? 'is-active' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
      // A real disabled attribute, not a class that looks disabled — the control
      // must be genuinely unclickable and skipped by keyboard navigation.
      disabled={notBuilt}
      title={actionTitle(action)}
      aria-label={ariaLabel ?? undefined}
      onClick={
        notBuilt
          ? undefined
          : () => {
              void action.run()
            }
      }
    >
      {children}
      {notBuilt ? <span className="action__lock" aria-hidden="true" /> : null}
    </button>
  )
}
