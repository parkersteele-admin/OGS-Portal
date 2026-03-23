/**
 * src/pages/public/SignUp.tsx
 *
 * Public sign-up page that creates a Firebase Auth account, writes the
 * company and user Firestore documents, sets the custom claim, and redirects
 * to the onboarding wizard at /portal/onboarding.
 *
 * Includes duplicate-company detection (non-blocking, runs on blur of
 * Company Name), with inline prompts to request access to an existing account
 * or continue as a new company.
 */

import React, { useState, useId, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from 'firebase/auth'
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../../lib/firebase'
import { refreshCurrentUser } from '../../lib/auth'
import { useAuthStore } from '../../store/authStore'
import { normalizeCompanyName, extractDomain } from '../../utils/companyName'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DuplicateMatch {
  type: 'domain' | 'name'
  companyId: string
  companyName: string
}

interface CheckCompanyResult {
  match: boolean
  type?: 'domain' | 'name'
  companyId?: string
  companyName?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

const SignUp: React.FC = () => {
  const navigate = useNavigate()

  // Form state
  const [companyName, setCompanyName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Duplicate detection state
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null)
  const [dismissedMatch, setDismissedMatch] = useState(false)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // "Request to Join" hold state
  const [joinRequestSent, setJoinRequestSent] = useState(false)

  const duplicateCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pwId = useId()
  const confirmPwId = useId()
  const termsId = useId()

  // ── Duplicate detection ──────────────────────────────────────────────────

  const checkDuplicate = useCallback(
    async (name: string, userEmail: string) => {
      if (!name.trim()) return
      setCheckingDuplicate(true)
      setDuplicateMatch(null)
      setDismissedMatch(false)
      try {
        const fn = httpsCallable<
          { companyName: string; email: string },
          CheckCompanyResult
        >(functions, 'checkForExistingCompany')
        const { data } = await fn({ companyName: name, email: userEmail })
        if (data.match && data.companyId && data.companyName && data.type) {
          setDuplicateMatch({
            type: data.type,
            companyId: data.companyId,
            companyName: data.companyName,
          })
        }
      } catch {
        // Non-blocking — fail silently per spec
      } finally {
        setCheckingDuplicate(false)
      }
    },
    [],
  )

  const handleCompanyNameBlur = () => {
    if (duplicateCheckTimeout.current) clearTimeout(duplicateCheckTimeout.current)
    // Fail silently after 1.5 s per spec
    duplicateCheckTimeout.current = setTimeout(() => {
      void checkDuplicate(companyName, email)
    }, 300)
  }

  // ── Request to Join ──────────────────────────────────────────────────────

  const handleRequestToJoin = async () => {
    if (!duplicateMatch) return
    setSubmitting(true)
    setFormError(null)

    try {
      // Create Auth user
      const { user: firebaseUser } = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      )
      await sendEmailVerification(firebaseUser)

      // Write users/{uid} with companyId: null, status: 'pending'
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        companyId: null,
        email,
        name: `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        phone: phone || null,
        role: 'viewer',
        isPrimary: false,
        status: 'pending',
        smsOptIn: false,
        smsPhone: null,
        pwaInstallPrompted: false,
        createdAt: serverTimestamp(),
        lastLoginAt: null,
      })

      // Call Cloud Function to create join request + notify owner
      const requestFn = httpsCallable<
        { companyId: string; requesterUid: string; requesterName: string; requesterEmail: string },
        void
      >(functions, 'requestToJoinCompany')
      await requestFn({
        companyId: duplicateMatch.companyId,
        requesterUid: firebaseUser.uid,
        requesterName: `${firstName} ${lastName}`.trim(),
        requesterEmail: email,
      })

      setJoinRequestSent(true)
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ── Main sign-up ─────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!companyName.trim()) errors.companyName = 'Company name is required.'
    if (!firstName.trim()) errors.firstName = 'First name is required.'
    if (!lastName.trim()) errors.lastName = 'Last name is required.'
    if (!email.trim()) errors.email = 'Email is required.'
    if (!phone.trim()) errors.phone = 'Phone number is required.'
    const pwErr = validatePassword(password)
    if (pwErr) errors.password = pwErr
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.'
    if (!agreedToTerms) errors.terms = 'You must agree to the terms of service.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setFormError(null)

    try {
      // 1. Create Firebase Auth user + send verification email
      const { user: firebaseUser } = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      )
      await sendEmailVerification(firebaseUser)

      // 2. Create company document (auto-ID — never use Auth UID)
      const companyRef = doc(collection(db, 'customers'))
      const companyId = companyRef.id
      await setDoc(companyRef, {
        companyId,
        companyName: companyName.trim(),
        companyNameNormalized: normalizeCompanyName(companyName),
        domain: extractDomain(email),
        billingAddress: { street: '', city: '', state: '', zip: '' },
        deliveryAddress: null,
        status: 'pending_verification',
        setupStep: 0,
        setupComplete: false,
        paymentMethod: null,
        billingEmail: email,
        smsOptIn: false,
        smsPhone: null,
        smsConsentAt: null,
        usageProfile: [],
        businessType: null,
        taxExempt: false,
        taxExemptNumber: null,
        billingContactName: `${firstName} ${lastName}`.trim(),
        generalManagerName: null,
        phone,
        pwaInstallPrompted: false,
        createdAt: serverTimestamp(),
        createdBy: firebaseUser.uid,
      })

      // 3. Write users/{uid}
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        companyId,
        email,
        name: `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        phone,
        role: 'owner',
        isPrimary: true,
        status: 'active',
        smsOptIn: false,
        smsPhone: null,
        pwaInstallPrompted: false,
        createdAt: serverTimestamp(),
        lastLoginAt: null,
      })

      // 4. Set custom claim via Cloud Function
      const setClaimFn = httpsCallable<
        { uid: string; companyId: string; role: string },
        void
      >(functions, 'setCompanyClaim')
      await setClaimFn({ uid: firebaseUser.uid, companyId, role: 'owner' })

      // 5. Force token refresh (activates new custom claim for Firestore rules)
      //    and re-hydrate the auth store with the freshly-written user doc so
      //    ProtectedRoute sees role:'owner' before we navigate.
      const refreshedUser = await refreshCurrentUser()
      if (refreshedUser) {
        useAuthStore.getState().setUser(refreshedUser)
      }

      // 6. Redirect to onboarding wizard
      navigate('/portal/onboarding', { replace: true })
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ── Join request sent holding screen ────────────────────────────────────

  if (joinRequestSent) {
    return (
      <div className="signup-layout">
        <div className="signup-card">
          <div className="signup-card__logo" aria-label="Ohio Gas Supply Co." />
          <div className="signup-hold">
            <div className="signup-hold__icon" aria-hidden="true">✉️</div>
            <h1 className="signup-hold__heading">Request Sent</h1>
            <p className="signup-hold__body">
              Your request has been sent to the account owner. You'll receive an email once
              they respond.
            </p>
            <Link to="/login" className="signup-hold__back">Back to sign in</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Main form ────────────────────────────────────────────────────────────

  return (
    <div className="signup-layout">
      <div className="signup-card">
        <div className="signup-card__logo" aria-label="Ohio Gas Supply Co." />
        <h1 className="signup-card__heading">Create your account</h1>
        <p className="signup-card__sub">Set up your Ohio Gas Supply customer portal.</p>

        {formError && (
          <div className="signup-err" role="alert">
            {formError}
          </div>
        )}

        <form className="signup-form" onSubmit={handleSubmit} noValidate>
          {/* Company Name */}
          <div className="signup-field-wrap">
            <Input
              label="Company Name"
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value)
                setDuplicateMatch(null)
                setDismissedMatch(false)
              }}
              onBlur={handleCompanyNameBlur}
              error={fieldErrors.companyName}
              required
              autoComplete="organization"
            />
            {checkingDuplicate && (
              <span className="signup-check-spinner" aria-label="Checking…" />
            )}
          </div>

          {/* Duplicate match notices */}
          {duplicateMatch && !dismissedMatch && (
            <div
              className={`signup-dup signup-dup--${duplicateMatch.type}`}
              role="status"
            >
              {duplicateMatch.type === 'domain' ? (
                <>
                  <p className="signup-dup__text">
                    🏢 <strong>We found an existing account for {duplicateMatch.companyName}.</strong>{' '}
                    Someone from your organization may have already set up an account.
                    You can request access to join it, or continue creating a separate one.
                  </p>
                  <div className="signup-dup__actions">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void handleRequestToJoin()}
                      loading={submitting}
                    >
                      Request to Join
                    </Button>
                    <button
                      type="button"
                      className="signup-dup__dismiss"
                      onClick={() => setDismissedMatch(true)}
                    >
                      Continue as new account
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="signup-dup__text">
                    🔍 <strong>Did you mean {duplicateMatch.companyName}?</strong>{' '}
                    An account with a similar name already exists.
                  </p>
                  <div className="signup-dup__actions">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void handleRequestToJoin()}
                      loading={submitting}
                    >
                      Request to Join
                    </Button>
                    <button
                      type="button"
                      className="signup-dup__dismiss"
                      onClick={() => setDismissedMatch(true)}
                    >
                      This is a different company
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Name row */}
          <div className="signup-row">
            <Input
              label="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={fieldErrors.firstName}
              required
              autoComplete="given-name"
            />
            <Input
              label="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={fieldErrors.lastName}
              required
              autoComplete="family-name"
            />
          </div>

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            required
            autoComplete="email"
          />

          <Input
            label="Phone Number"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={fieldErrors.phone}
            required
            autoComplete="tel"
          />

          {/* Password */}
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={pwId}>
              Password
            </label>
            <div className="signup-pw-wrap">
              <input
                id={pwId}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`ui-input signup-pw-input${fieldErrors.password ? ' ui-input--error' : ''}`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? `${pwId}-error` : undefined}
              />
              <button
                type="button"
                className="signup-pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
            {fieldErrors.password && (
              <span id={`${pwId}-error`} className="ui-field__error" role="alert">
                {fieldErrors.password}
              </span>
            )}
          </div>

          {/* Confirm Password */}
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={confirmPwId}>
              Confirm Password
            </label>
            <input
              id={confirmPwId}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className={`ui-input${fieldErrors.confirmPassword ? ' ui-input--error' : ''}`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              aria-invalid={!!fieldErrors.confirmPassword}
              aria-describedby={
                fieldErrors.confirmPassword ? `${confirmPwId}-error` : undefined
              }
            />
            {fieldErrors.confirmPassword && (
              <span id={`${confirmPwId}-error`} className="ui-field__error" role="alert">
                {fieldErrors.confirmPassword}
              </span>
            )}
          </div>

          {/* Terms */}
          <div className="ui-field signup-terms">
            <label className="signup-terms__label">
              <input
                id={termsId}
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="signup-terms__check"
                aria-invalid={!!fieldErrors.terms}
                aria-describedby={fieldErrors.terms ? `${termsId}-error` : undefined}
              />
              I agree to Ohio Gas Supply&apos;s{' '}
              <a
                href="https://www.ohiogassupply.com/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="signup-terms__link"
              >
                terms of service
              </a>
            </label>
            {fieldErrors.terms && (
              <span id={`${termsId}-error`} className="ui-field__error" role="alert">
                {fieldErrors.terms}
              </span>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="signup-submit"
          >
            Create Account
          </Button>
        </form>

        <p className="signup-card__footer">
          Already have an account?{' '}
          <Link to="/login" className="signup-card__login-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default SignUp
