/**
 * src/pages/portal/JoinSetup.tsx
 *
 * Account setup flow for new customers — reached by scanning the QR code or
 * clicking the setup link created when their quote is accepted.
 *
 * Route: /join/:token  (public, no auth required)
 *
 * Steps:
 *  1. Load company info from the setup token (getSetupLinkInfo CF)
 *  2. Customer picks their role at the company
 *  3. Customer enters name, email, and password
 *  4. Firebase Auth account is created → completeAccountSetup CF links it to company
 *  5. Redirect to /portal/dashboard
 */

import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import './JoinSetup.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerRole = 'owner' | 'manager' | 'billing' | 'delivery' | 'viewer'

interface CompanyInfo {
  companyId: string
  companyName: string
  address: string
  city: string
  state: string
}

const ROLES: { value: CustomerRole; label: string; description: string }[] = [
  {
    value: 'owner',
    label: 'Owner / Primary Contact',
    description: 'Full access — manage billing, team members, and all settings.',
  },
  {
    value: 'manager',
    label: 'Manager',
    description: 'Create and manage orders, view invoices, and track deliveries.',
  },
  {
    value: 'billing',
    label: 'Billing',
    description: 'View and pay invoices, manage payment methods.',
  },
  {
    value: 'delivery',
    label: 'Delivery / Receiving',
    description: 'View delivery schedules and confirm received orders.',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to orders, invoices, and tank levels.',
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

const JoinSetupPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Loading state
  const [company, setCompany]     = useState<CompanyInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)

  // Multi-step state
  const [step, setStep]           = useState<'role' | 'account' | 'done'>('role')
  const [selectedRole, setSelectedRole] = useState<CustomerRole>('owner')

  // Account form
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)

  // ── Load company info from token ─────────────────────────────────────────

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid setup link.')
      setLoading(false)
      return
    }

    const fn = httpsCallable<{ token: string }, CompanyInfo>(functions, 'getSetupLinkInfo')
    fn({ token })
      .then((result) => setCompany(result.data))
      .catch((err: { message?: string; code?: string }) => {
        if (err.code === 'functions/deadline-exceeded') {
          setLoadError('This setup link has expired. Please ask your sales rep for a new one.')
        } else if (err.code === 'functions/failed-precondition') {
          setLoadError('An account has already been created for this company. Sign in instead.')
        } else {
          setLoadError('Invalid or expired setup link.')
        }
      })
      .finally(() => setLoading(false))
  }, [token])

  // ── Existing signed-in user: skip account creation ───────────────────────

  const handleExistingUser = async () => {
    if (!user) return
    setSubmitting(true)
    setFormError(null)
    try {
      const fn = httpsCallable<{ token: string; role: CustomerRole }, { success: boolean; companyId: string }>(
        functions, 'completeAccountSetup',
      )
      await fn({ token, role: selectedRole })
      navigate('/portal/dashboard', { replace: true })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── New user: create account then complete setup ─────────────────────────

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setFormError('Please enter your first and last name.')
      return
    }
    if (!email.trim()) {
      setFormError('Please enter your email address.')
      return
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      // 1. Create Firebase Auth account
      const { user: fbUser } = await createUserWithEmailAndPassword(auth, email.trim(), password)

      // 2. Set display name
      await updateProfile(fbUser, { displayName: `${firstName.trim()} ${lastName.trim()}` })

      // 3. Send verification email (non-blocking)
      sendEmailVerification(fbUser).catch(() => null)

      // 4. Link account to company
      const fn = httpsCallable<{ token: string; role: CustomerRole }, { success: boolean; companyId: string }>(
        functions, 'completeAccountSetup',
      )
      await fn({ token, role: selectedRole })

      setStep('done')
      setTimeout(() => navigate('/portal/dashboard', { replace: true }), 2500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      // Firebase Auth codes
      if (msg.includes('email-already-in-use')) {
        setFormError('An account with this email already exists. Sign in to link your account.')
      } else {
        setFormError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
            <Link to="/login" className="signup-hold__back">Sign in to your account</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!company) return null

  // ── Done state ────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="signup-layout">
        <div className="signup-card">
          <div className="signup-card__logo" aria-label="Ohio Gas Supply Co." />
          <div className="join-done">
            <div className="join-done__icon" aria-hidden="true">✅</div>
            <h1 className="join-done__title">You're all set!</h1>
            <p className="join-done__body">
              Your account is linked to <strong>{company.companyName}</strong>.
              Taking you to your dashboard…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="signup-layout">
      <div className="signup-card join-card">
        <div className="signup-card__logo" aria-label="Ohio Gas Supply Co." />

        <div className="join-company">
          <span className="join-company__label">Setting up account for</span>
          <strong className="join-company__name">{company.companyName}</strong>
          {company.city && (
            <span className="join-company__location">
              {company.city}{company.state ? `, ${company.state}` : ''}
            </span>
          )}
        </div>

        {/* ── Step indicator ───────────────────────────────────────────────── */}
        <div className="join-steps" aria-label="Progress">
          <div className={`join-steps__dot${step === 'role' ? ' join-steps__dot--active' : ' join-steps__dot--done'}`}>
            1
          </div>
          <div className="join-steps__line" />
          <div className={`join-steps__dot${step === 'account' ? ' join-steps__dot--active' : ''}`}>
            2
          </div>
        </div>

        {formError && (
          <div className="signup-err" role="alert">{formError}</div>
        )}

        {/* ── Step 1: Role selection ────────────────────────────────────────── */}
        {step === 'role' && (
          <div className="join-role-step">
            <h1 className="signup-card__heading">Your role</h1>
            <p className="signup-card__sub">
              How will you use the portal? This sets your access level.
            </p>

            <div className="join-roles" role="radiogroup" aria-label="Select your role">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className={`join-role${selectedRole === r.value ? ' join-role--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={selectedRole === r.value}
                    onChange={() => setSelectedRole(r.value)}
                    className="join-role__radio"
                  />
                  <span className="join-role__content">
                    <span className="join-role__label">{r.label}</span>
                    <span className="join-role__desc">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              className="signup-submit"
              onClick={() => setStep('account')}
            >
              Continue
            </Button>
          </div>
        )}

        {/* ── Step 2: Account creation (or existing-user link) ──────────────── */}
        {step === 'account' && (
          <>
            <h1 className="signup-card__heading">Create your account</h1>
            <p className="signup-card__sub">
              You'll use this to sign in to the OGS Portal.
            </p>

            {/* Existing user: just link the account */}
            {user && (
              <div className="accept-invite__confirm">
                <p>
                  You're signed in as <strong>{user.email}</strong>. Link this account
                  to <strong>{company.companyName}</strong>?
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="signup-submit"
                  loading={submitting}
                  onClick={() => void handleExistingUser()}
                >
                  Link my account
                </Button>
                <button
                  type="button"
                  className="join-back-btn"
                  onClick={() => setStep('role')}
                >
                  ← Back
                </button>
              </div>
            )}

            {/* New user: full sign-up form */}
            {!user && (
              <form onSubmit={(e) => void handleCreateAccount(e)} className="signup-form" noValidate>
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
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  hint="Minimum 8 characters"
                />

                <div className="join-form-actions">
                  <button
                    type="button"
                    className="join-back-btn"
                    onClick={() => { setFormError(null); setStep('role') }}
                  >
                    ← Back
                  </button>
                  <Button
                    variant="primary"
                    size="lg"
                    type="submit"
                    loading={submitting}
                    className="signup-submit"
                  >
                    Create account
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default JoinSetupPage
