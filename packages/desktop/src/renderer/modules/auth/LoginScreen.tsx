import { useState, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import type { UserDto } from '../../../shared/ipc.js'

/**
 * Sign-in, and the forced password change that follows a first login.
 *
 * The seeded administrator is admin/admin, and the seed sets
 * `mustChangePassword`. That default is a real risk on a machine other people
 * can reach, so this screen says so plainly rather than burying it — and the
 * change cannot be skipped, because there is no support server to recover the
 * account later if it is left open.
 *
 * Both buttons go through the action registry. They were the last hand-written
 * <button>s in the renderer, exempted on the grounds that the shell had not
 * drawn this screen — which is exactly the reasoning that let two other bare
 * buttons survive behind a hand-typed data-action.
 *
 * Enter submits from either field. That is done explicitly rather than left to
 * the form's implicit submission, which HTML only performs when the form has a
 * submit button or a single field — neither is true here, so a shopkeeper
 * pressing Enter in the password box would otherwise have got nothing.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: (user: UserDto) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  const [mustChange, setMustChange] = useState<UserDto | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function signIn(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.login({ username, password })
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.user.mustChangePassword) {
        setMustChange(result.user)
        return
      }
      onSignedIn(result.user)
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(): Promise<void> {
    if (busy) return
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.changePassword(password, newPassword)
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (mustChange) onSignedIn({ ...mustChange, mustChangePassword: false })
    } finally {
      setBusy(false)
    }
  }

  const submit = (): void => void (mustChange ? changePassword() : signIn())

  const onEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  // Caps Lock is the single most common reason a correct password is refused,
  // and the field is masked so there is nothing on screen to explain it.
  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>): void =>
    setCapsLock(event.getModifierState('CapsLock'))

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="sidebar__crest">AH</span>
          <span className="sidebar__name">
            AL-HARAM
            <br />
            GOLD JEWELLERS
          </span>
          <span className="login__tagline">Trust in Purity</span>
        </div>

        {mustChange ? (
          <>
            <h1 className="login__title">Choose a new password</h1>
            <p className="login__note">
              This account still uses the password it was created with. Anyone who can
              reach this PC can sign in with it, and there is no support server to
              recover the account later — so it has to be changed now.
            </p>
            <label className="login__field">
              <span>New password</span>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => {
                  trackCapsLock(e)
                  onEnter(e)
                }}
                onKeyUp={trackCapsLock}
                autoFocus
              />
            </label>
            <label className="login__field">
              <span>Repeat new password</span>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => {
                  trackCapsLock(e)
                  onEnter(e)
                }}
                onKeyUp={trackCapsLock}
              />
            </label>
            {capsLock ? <CapsLockHint /> : null}
            <Action
              id="auth.change-password"
              className="login__submit"
              busy={busy}
              onActivate={submit}
            >
              {busy ? 'Saving…' : 'Set password and continue'}
            </Action>
          </>
        ) : (
          <>
            <h1 className="login__title">Sign in</h1>
            <label className="login__field">
              <span>Username</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={onEnter}
                autoFocus
              />
            </label>
            <label className="login__field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  trackCapsLock(e)
                  onEnter(e)
                }}
                onKeyUp={trackCapsLock}
              />
              {capsLock ? <CapsLockHint /> : null}
            </label>
            <Action id="auth.sign-in" className="login__submit" busy={busy} onActivate={submit}>
              <Icon name="exit" size={16} />
              {busy ? 'Signing in…' : 'Sign in'}
            </Action>
          </>
        )}

        {error ? (
          <div className="login__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CapsLockHint() {
  return (
    <p className="login__caps" role="status">
      <Icon name="shield" size={14} />
      Caps Lock is on.
    </p>
  )
}
