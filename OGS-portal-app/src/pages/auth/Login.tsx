/**
 * Login.tsx
 * OGS Portal sign-in page.
 *
 * Features:
 *  - Orange-bar brand lockup + tagline
 *  - Email + password inputs (show/hide toggle)
 *  - Client-side validation before the network call
 *  - Loading state on button
 *  - Generic error message (doesn't leak which field is wrong)
 *  - Role-based redirect on success; redirect if already authed
 */

import React, { useState, useId } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { signIn } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME } from '../../types/auth'
import { Button } from '../../components/ui/Button'
import './Login.css'

// ── Password field with show/hide toggle ────────────────────────────────────

interface PasswordFieldProps {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  error?: string
}

const PasswordField: React.FC<PasswordFieldProps> = ({ value, onChange, disabled, error }) => {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        Password
      </label>
      <div className="lgn-pw-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          className={`ui-input lgn-pw-input${error ? ' ui-input--error' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="lgn-pw-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? (
            // Eye-off icon
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C6 20 2 12 2 12a18.09 18.09 0 0 1 4.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            // Eye icon
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
      {error && (
        <span id={`${id}-error`} className="ui-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateInputs(email: string, password: string): string | null {
  if (!email.trim()) return 'Email is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.'
  if (!password) return 'Password is required.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

// ── LoginPage ────────────────────────────────────────────────────────────────

export default function Login() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const { user, loading: authLoading } = useAuth()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  // Already signed in — redirect immediately
  React.useEffect(() => {
    if (!authLoading && user) {
      const from = (location.state as { from?: string })?.from
      navigate(from ?? ROLE_HOME[user.role], { replace: true })
    }
  }, [user, authLoading, navigate, location.state])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const validationError = validateInputs(email, password)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      const appUser = await signIn(email.trim(), password)
      const from    = (location.state as { from?: string })?.from
      navigate(from ?? ROLE_HOME[appUser.role], { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (
        msg.includes('invalid-credential') ||
        msg.includes('wrong-password') ||
        msg.includes('user-not-found') ||
        msg.includes('INVALID_LOGIN_CREDENTIALS')
      ) {
        setError('Invalid email or password.')
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Please try again later.')
      } else if (msg.includes('User account not found')) {
        setError('Account not found. Contact your administrator.')
      } else {
        setError('Sign in failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Hold render until auth state resolves to avoid flash of login → redirect
  if (authLoading) return null

  return (
    <div className="auth-wrap">
      <div className="auth-card">

        {/* ── Brand lockup ── */}
        <div className="auth-brand">
          <div className="auth-brand__bar" aria-hidden="true" />
          <div className="auth-brand__lockup">
            <span className="auth-brand__name">OGS Portal</span>
            <span className="auth-brand__tagline">
              Reliable Gas. Local Service. Built for Ohio.
            </span>
          </div>
        </div>

        {/* ── Form ── */}
        <form className="lgn-form" onSubmit={handleSubmit} noValidate>
          <div className="lgn-fields">
            {/* Email */}
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="lgn-email">
                Email
              </label>
              <input
                id="lgn-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                className="ui-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@example.com"
              />
            </div>

            {/* Password */}
            <PasswordField
              value={password}
              onChange={setPassword}
              disabled={loading}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="lgn-error" role="alert" aria-live="polite">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            className="lgn-submit-btn"
          >
            Sign in
          </Button>
        </form>

        {/* ── Forgot password ── */}
        <div className="lgn-footer">
          <Link to="/reset-password" className="lgn-link">
            Forgot password?
          </Link>
        </div>

      </div>
    </div>
  )
}
