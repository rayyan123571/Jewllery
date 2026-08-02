import { useState, type FormEvent } from 'react'
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
 * Not routed through the action registry: these are form submissions inside a
 * screen the shell has not drawn yet, not shell controls. The no-dead-buttons
 * rule applies to the application chrome, and both buttons here are wired.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: (user: UserDto) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [mustChange, setMustChange] = useState<UserDto | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function signIn(event: FormEvent): Promise<void> {
    event.preventDefault()
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

  async function changePassword(event: FormEvent): Promise<void> {
    event.preventDefault()
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

  return (
    <div className="login">
      <form className="login__card" onSubmit={mustChange ? changePassword : signIn}>
        <div className="login__brand">
          <span className="sidebar__crest">AH</span>
          <span className="sidebar__name">
            AL-HARAM
            <br />
            GOLD JEWELLERS
          </span>
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
              />
            </label>
            <button className="login__submit" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Set password and continue'}
            </button>
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
              />
            </label>
            <button className="login__submit" type="submit" disabled={busy}>
              <Icon name="exit" size={15} />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        )}

        {error ? <div className="login__error">{error}</div> : null}
      </form>
    </div>
  )
}
