/**
 * src/pages/portal/AcceptInvite.tsx
 *
 * Handles invite accept flow at /accept-invite?token={inviteId}.
 * - Validates token (status === 'pending', not expired)
 * - New users: shows sign-up form (name + password; email pre-filled)
 * - Existing users: shows "Join [company]?" confirmation
 */

import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../lib/firebase'
import { getInvite } from '../../services/onboardingService'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import type { TeamInvite } from '../../types/company'

const AcceptInvitePage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const token = searchParams.get('token') ?? ''

  const [invite, setInvite] = useState<TeamInvite | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // New user form state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid invite link.')
      setLoading(false)
      return
    }
    getInvite(token)
      .then((inv) => {
        if (!inv) {
          setLoadError('Invite not found or already used.')
        } else if (inv.status !== 'pending') {
          setLoadError(`This invite has already been ${inv.status}.`)
        } else if (inv.expiresAt.toDate() < new Date()) {
          setLoadError('This invite has expired. Ask the account owner to send a new one.')
        } else {
          setInvite(inv)
        }
      })
      .catch(() => setLoadError('Failed to load invite. Please try again.'))
      .finally(() => setLoading(false))
  }, [token])

  const acceptInviteFn = async (uid: string) => {
    const fn = httpsCallable<{ inviteId: string; uid: string }, void>(
      functions,
      'acceptInvite',
    )
    await fn({ inviteId: token, uid })
    navigate('/portal/dashboard', { replace: true })
  }

  const handleNewUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite) return
    if (!firstName.trim() || !lastName.trim() || password.length < 8) {
      setFormError('Please fill in all fields. Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const { user: fbUser } = await createUserWithEmailAndPassword(
        auth,
        invite.email,
        password,
      )
      await sendEmailVerification(fbUser)
      await acceptInviteFn(fbUser.uid)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleExistingUser = async () => {
    if (!invite || !user) return
    setSubmitting(true)
    setFormError(null)
    try {
      await acceptInviteFn(user.id)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="layout-loading">
        <span className="layout-loading__spinner" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="signup-layout">
        <div className="signup-card">
          <div className="signup-card__logo" aria-label="Ohio Gas Supply Co." />
          <div className="signup-hold">
            <p className="ob-step__err">{loadError}</p>
            <Link to="/login" className="signup-hold__back">Go to sign in</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!invite) return null

  return (
    <div className="signup-layout">
      <div className="signup-card">
        <div className="signup-card__logo" aria-label="Ohio Gas Supply Co." />
        <h1 className="signup-card__heading">You're invited!</h1>
        <p className="signup-card__sub">
          Join your team on the OGS Portal.
        </p>

        {formError && (
          <div className="signup-err" role="alert">{formError}</div>
        )}

        {/* Existing user — just confirm */}
        {user && user.email === invite.email && (
          <div className="accept-invite__confirm">
            <p>
              You are signed in as <strong>{user.email}</strong>.
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleExistingUser()}
              loading={submitting}
              className="signup-submit"
            >
              Accept Invitation
            </Button>
          </div>
        )}

        {/* New user — create account */}
        {!user && (
          <form onSubmit={(e) => void handleNewUser(e)} className="signup-form" noValidate>
            <Input
              label="Email"
              value={invite.email}
              readOnly
              type="email"
            />
            <div className="signup-row">
              <Input
                label="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
              />
              <Input
                label="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
              />
            </div>
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              className="signup-submit"
            >
              Create Account &amp; Join
            </Button>
          </form>
        )}

        <p className="signup-card__footer">
          Already have a different account?{' '}
          <Link to="/login" className="signup-card__login-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default AcceptInvitePage
