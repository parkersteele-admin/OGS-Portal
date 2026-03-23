/**
 * src/components/onboarding/NotificationPrefs.tsx
 *
 * Notification preference widget for Step 4.
 * - Email is always-on (locked checkbox)
 * - SMS opt-in (with required TCPA language)
 * - PWA install card (collapsible, via PwaInstallCard)
 */

import React, { useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { PwaInstallCard } from './PwaInstallCard'
import { Input } from '../ui/Input'

interface Props {
  companyId: string
  uid: string
  billingEmail: string
  initialSmsOptIn: boolean
  initialSmsPhone: string | null
}

export interface NotifPrefsResult {
  smsOptIn: boolean
  smsPhone: string | null
  smsConsentAt: unknown // serverTimestamp
}

interface NotifPrefsHandle {
  save: () => Promise<NotifPrefsResult | null>
}

/**
 * Notification prefs component — imperative save handled by parent via ref,
 * or call the returned save() when embedding inside a form submission.
 * For onboarding we export a simple stateful version the step calls directly.
 */
export const NotificationPrefs = React.forwardRef<NotifPrefsHandle, Props>(
  ({ companyId, uid, billingEmail, initialSmsOptIn, initialSmsPhone }, _ref) => {
    const [smsOptIn, setSmsOptIn] = useState(initialSmsOptIn)
    const [smsPhone, setSmsPhone] = useState(initialSmsPhone ?? '')
    const [smsAgreed, setSmsAgreed] = useState(false)
    const [errors, setErrors] = useState<Record<string, string>>({})

    const handleSmsToggle = (on: boolean) => {
      setSmsOptIn(on)
      if (!on) {
        setSmsAgreed(false)
        setErrors({})
      }
    }

    return (
      <div className="notif-prefs">
        {/* Email — always on */}
        <div className="notif-prefs__section">
          <h4 className="notif-prefs__heading">Email Notifications</h4>
          <label className="notif-prefs__locked-label">
            <input type="checkbox" checked readOnly disabled />
            Invoice and account notices sent to {billingEmail} — always enabled.
          </label>
        </div>

        {/* SMS opt-in */}
        <div className="notif-prefs__section">
          <div className="notif-prefs__sms-header">
            <h4 className="notif-prefs__heading">Text Message Notifications</h4>
            <label className="notif-prefs__toggle-label">
              <input
                type="checkbox"
                role="switch"
                checked={smsOptIn}
                onChange={(e) => handleSmsToggle(e.target.checked)}
              />
              {smsOptIn ? 'Enabled' : 'Disabled'}
            </label>
          </div>

          {smsOptIn && (
            <div className="notif-prefs__sms-body">
              <Input
                label="Mobile Number"
                type="tel"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                error={errors.smsPhone}
                required
                autoComplete="tel"
                hint="We'll send delivery notifications, order confirmations, and low-cylinder alerts."
              />
              <p className="notif-prefs__disclosure">
                Receive delivery notifications, order confirmations, and low-cylinder alerts
                by text. Message &amp; data rates may apply. Reply <strong>STOP</strong> at
                any time to unsubscribe.
              </p>
              <label
                className={`notif-prefs__consent-label${errors.smsAgreed ? ' notif-prefs__consent-label--err' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={smsAgreed}
                  onChange={(e) => setSmsAgreed(e.target.checked)}
                  aria-invalid={!!errors.smsAgreed}
                />
                I agree to receive text messages from Ohio Gas Supply Co.
              </label>
              {errors.smsAgreed && (
                <span className="ui-field__error" role="alert">{errors.smsAgreed}</span>
              )}
            </div>
          )}
        </div>

        {/* PWA install */}
        <div className="notif-prefs__section">
          <PwaInstallCard
            uid={uid}
            companyId={companyId}
          />
        </div>
      </div>
    )
  },
)

NotificationPrefs.displayName = 'NotificationPrefs'

/**
 * Validates and persists SMS prefs to Firestore.
 * Returns the saved data (or null if no SMS opt-in).
 */
export async function saveNotificationPrefs(
  companyId: string,
  uid: string,
  smsOptIn: boolean,
  smsPhone: string,
  smsAgreed: boolean,
): Promise<{ valid: boolean; error?: string }> {
  if (smsOptIn) {
    if (!smsPhone.trim()) {
      return { valid: false, error: 'Please enter your mobile number for text messages.' }
    }
    if (!smsAgreed) {
      return {
        valid: false,
        error: 'You must agree to receive text messages to enable SMS notifications.',
      }
    }

    const consentAt = serverTimestamp()
    await Promise.all([
      updateDoc(doc(db, 'customers', companyId), {
        smsOptIn: true,
        smsPhone,
        smsConsentAt: consentAt,
      }),
      updateDoc(doc(db, 'users', uid), {
        smsOptIn: true,
        smsPhone,
      }),
    ])
  } else {
    await Promise.all([
      updateDoc(doc(db, 'customers', companyId), {
        smsOptIn: false,
        smsPhone: null,
        smsConsentAt: null,
      }),
      updateDoc(doc(db, 'users', uid), {
        smsOptIn: false,
        smsPhone: null,
      }),
    ])
  }

  return { valid: true }
}
