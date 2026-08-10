import { useEffect, useMemo, useRef, useState } from 'react'
import { Action } from '../actions/Action.js'
import { Icon } from '../shell/Icon.js'
import { daysInMonth, fromDisplayDate, isoOf, toDisplayDate } from '../format/dates.js'

/**
 * A date field that looks like it belongs to a desktop application.
 *
 * `<input type="date">` was doing three things wrong at once: it renders the
 * browser's own picker, which is unmistakably a web control sitting in a shop
 * ledger; it shows `10/08/2026` in a slash format nobody else on the screen
 * uses; and its spin buttons are a different size from every other control.
 *
 * This is a plain text input in DD-MM-YYYY with a calendar button attached to
 * it, and a month grid drawn from the same tokens as everything else.
 *
 * The value crossing the boundary is still ISO `YYYY-MM-DD`. Typing is parsed
 * on every keystroke, and a half-finished date simply does not commit — the
 * stored value stays put until the text is a real day, so a slip can never be
 * posted against a date the operator was still in the middle of writing.
 */
export function DateField({
  value,
  onChange,
  label,
  ariaLabel,
}: {
  /** ISO `YYYY-MM-DD`. */
  value: string
  onChange: (iso: string) => void
  label: string
  ariaLabel: string
}) {
  const [text, setText] = useState(() => toDisplayDate(value))
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  // The value can change under us — the shell hands down today's date, and a
  // save resets the form. Re-seed the text unless the user is mid-edit on a
  // date that already means the same day.
  useEffect(() => {
    setText((current) => (fromDisplayDate(current) === value ? current : toDisplayDate(value)))
  }, [value])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const commit = (next: string): void => {
    setText(next)
    const iso = fromDisplayDate(next)
    if (iso) onChange(iso)
  }

  return (
    /* A div, not a <label>: a click on a button inside a label is forwarded to
       the labelled control, which would fight the calendar's own buttons. */
    <div className="field" ref={wrapper}>
      <span className="field__label">{label}</span>
      <span className="input-group">
        <input
          className="input input-group__input"
          value={text}
          onChange={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
          onBlur={() => setText(toDisplayDate(value))}
          placeholder="DD-MM-YYYY"
          inputMode="numeric"
          aria-label={ariaLabel}
        />
        <Action
          id="date.pick"
          variant="segment"
          ariaLabel={`Choose ${label.toLowerCase()}`}
          onActivate={() => setOpen((current) => !current)}
        >
          <Icon name="calendar" size={16} />
        </Action>
      </span>
      {open ? (
        <Calendar
          value={value}
          onPick={(iso) => {
            onChange(iso)
            setText(toDisplayDate(iso))
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const

function Calendar({ value, onPick }: { value: string; onPick: (iso: string) => void }) {
  const selected = fromDisplayDate(toDisplayDate(value)) ?? value
  const [year, month] = useMemo(() => {
    const parts = selected.split('-')
    const y = Number(parts[0])
    const m = Number(parts[1])
    return [Number.isFinite(y) ? y : new Date().getFullYear(), Number.isFinite(m) ? m : 1]
  }, [selected])

  const [view, setView] = useState({ year, month })

  const grid = useMemo(() => {
    const total = daysInMonth(view.year, view.month)
    // Monday-first: the trade week starts Monday, and getDay() puts Sunday at 0.
    const lead = (new Date(view.year, view.month - 1, 1).getDay() + 6) % 7
    const cells: (number | null)[] = Array.from({ length: lead }, () => null)
    for (let day = 1; day <= total; day += 1) cells.push(day)
    return cells
  }, [view])

  const monthName = new Date(view.year, view.month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })

  const shift = (by: number): void =>
    setView((current) => {
      const next = current.month + by
      if (next < 1) return { year: current.year - 1, month: 12 }
      if (next > 12) return { year: current.year + 1, month: 1 }
      return { year: current.year, month: next }
    })

  const todayIso = isoOf(new Date())

  return (
    <div className="calendar" role="dialog" aria-label="Choose a date">
      <div className="calendar__head">
        <Action
          id="date.prev-month"
          variant="icon"
          ariaLabel="Previous month"
          onActivate={() => shift(-1)}
        >
          <Icon name="chevron-left" size={16} />
        </Action>
        <span className="calendar__month">{monthName}</span>
        <Action
          id="date.next-month"
          variant="icon"
          ariaLabel="Next month"
          onActivate={() => shift(1)}
        >
          <Icon name="chevron-right" size={16} />
        </Action>
      </div>
      <div className="calendar__weekdays">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar__grid">
        {grid.map((day, index) => {
          if (day === null) return <span key={`pad-${index}`} />
          const iso = `${String(view.year).padStart(4, '0')}-${String(view.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const classes = [
            'calendar__day',
            iso === selected ? 'is-selected' : '',
            iso === todayIso ? 'is-today' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <Action
              key={iso}
              id="date.day"
              variant="plain"
              className={classes}
              ariaLabel={toDisplayDate(iso)}
              onActivate={() => onPick(iso)}
            >
              {day}
            </Action>
          )
        })}
      </div>
    </div>
  )
}
