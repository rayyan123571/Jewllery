import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Action } from '../actions/Action.js'
import { Icon } from '../shell/Icon.js'

/**
 * One place where the application says what just happened.
 *
 * Save confirmations and failures used to be a `message` state on each screen,
 * rendered as a banner wherever that screen happened to put it — so the same
 * event appeared in a different place, at a different width, depending on which
 * tab was open, and a confirmation on a scrolled screen could land off the top.
 *
 * The shop turned notifications OFF. What remains is the minimum a ledger
 * can honestly run with:
 *
 *   - A success shows nothing at all. The screen itself is the confirmation —
 *     the grid clears and the invoice number advances.
 *   - A failure appears (something did NOT happen, and silence there loses
 *     money), then dismisses itself after a few seconds. Nothing ever waits
 *     for a click.
 *
 * This is for events. A persistent CONDITION — no rate recorded for this date —
 * stays inline on the screen it constrains, because it is still true after the
 * toast would have gone.
 */

const FAILURE_LIFETIME_MS = 8000

export interface AppMessage {
  readonly id: number
  readonly kind: 'ok' | 'bad'
  readonly text: string
}

interface MessagesApi {
  readonly messages: readonly AppMessage[]
  readonly push: (kind: 'ok' | 'bad', text: string) => void
  readonly dismiss: (id: number) => void
}

const MessagesContext = createContext<MessagesApi | null>(null)

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<readonly AppMessage[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setMessages((current) => current.filter((message) => message.id !== id))
  }, [])

  const push = useCallback(
    (kind: 'ok' | 'bad', text: string) => {
      // Success notifications are OFF, at the shop's request: a till that
      // pops a confirmation after every save is a till that trains people to
      // click past messages. Success is visible where it matters — the grid
      // clears, the number advances, the summary moves. Screens keep calling
      // push('ok', …) so the record of WHAT to say survives; this is the one
      // switch that decides it is not said.
      if (kind === 'ok') return
      const id = nextId.current++
      setMessages((current) => [...current, { id, kind, text }])
      // A failure still shows — a save that silently did not happen is money
      // lost — but it dismisses itself too, so nothing on this screen ever
      // demands a click.
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), FAILURE_LIFETIME_MS),
      )
    },
    [dismiss],
  )

  // Every pending timer is cleared on unmount, so a dismissal cannot fire into
  // a component that is gone.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api = useMemo(() => ({ messages, push, dismiss }), [messages, push, dismiss])
  return <MessagesContext.Provider value={api}>{children}</MessagesContext.Provider>
}

export function useMessages(): MessagesApi {
  const api = useContext(MessagesContext)
  if (!api) throw new Error('useMessages used outside a MessagesProvider')
  return api
}

/** The region itself. Rendered once, by the shell. */
export function MessageRegion() {
  const { messages, dismiss } = useMessages()
  if (messages.length === 0) return null
  return (
    <div className="messages" role="status" aria-live="polite">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`banner ${message.kind === 'ok' ? 'banner--good' : 'banner--bad'}`}
        >
          <Icon name={message.kind === 'ok' ? 'save' : 'cross'} size={16} />
          <span className="messages__text">{message.text}</span>
          <Action
            id="message.dismiss"
            variant="icon"
            ariaLabel="Dismiss this message"
            onActivate={() => dismiss(message.id)}
          >
            <Icon name="cross" size={14} />
          </Action>
        </div>
      ))}
    </div>
  )
}
