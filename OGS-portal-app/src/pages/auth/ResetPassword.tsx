/**
 * ResetPassword.tsx
 * OGS Portal — forgot password page.
 *
 * Features:
 *  - Email input with client-side validation
 *  - Calls Firebase sendPasswordResetEmail via lib/auth.sendPasswordReset
 *  - Success state replaces the form
 *  - Back to sign in link
 *  - Redirect to home if already authenticated
 */

import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sendPasswordReset } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME } from '../../types/auth'
import { Button } from '../../components/ui/Button'
import './Login.css'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const [email,   setEmail]   = useState('')
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)

  // Already signed in — redirect immediately
  React.useEffect(() => {
    if (!authLoading && user) {
      navigate(ROLE_HOME[user.role], { replace: true })
    }
  }, [user, authLoading, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }

    setLoading(true)
    try {
      await sendPasswordReset(email.trim())
      setSent(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      // Firebase returns user-not-found even in production; normalise it to
      // avoid leaking whether an address is registered.
      if (msg.includes('user-not-found') || msg.includes('invalid-email')) {
        // Still show success — don't confirm whether the account exists.
        setSent(true)
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Please try again later.')
      } else {
        setError('Could not send reset email. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

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

        {sent ? (
          /* ── Success state ── */
          <div className="rp-success">
            <div className="rp-success__icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="rp-success__title">Check your email</h2>
            <p className="rp-success__body">
              If <strong>{email}</strong> is associated with an account, we've
              sent a reset link. Check your inbox (and spam folder).
            </p>
          </div>
        ) : (
          /* ── Reset form ── */
          <form className="rp-form" onSubmit={handleSubmit} noValidate>
            <p className="rp-hint">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            <div className="ui-field">
              <label className="ui-field__label" htmlFor="rp-email">
                Email
              </label>
              <input
                id="rp-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                className={`ui-input${error ? ' ui-input--error' : ''}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@example.com"
                aria-invalid={!!error}
                aria-describedby={error ? 'rp-email-error' : undefined}
              />
              {error && (
                <span id="rp-email-error" className="ui-field__error" role="alert">
                  {error}
                </span>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              className="rp-submit-btn"
            >
              Send reset link
            </Button>
          </form>
        )}

        {/* ── Back to sign in ── */}
        <div className="rp-back">
          <Link to="/login" className="rp-back-link">
            ← Back to sign in
          </Link>
        </div>

      </div>
    </div>
  )
}
