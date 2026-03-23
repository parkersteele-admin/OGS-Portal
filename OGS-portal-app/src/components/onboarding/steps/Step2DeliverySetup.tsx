/**
 * src/components/onboarding/steps/Step2DeliverySetup.tsx
 *
 * Onboarding Step 2 — Delivery Setup.
 * Supports up to 3 delivery locations. First location pre-populated from
 * billing/shipping address entered in Step 1.
 */

import React, { useState, useRef, useCallback } from 'react'
import {
  saveLocation,
  deleteLocation,
  advanceSetupStep,
} from '../../../services/onboardingService'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import type {
  Company,
  DeliveryLocation,
  OnboardingAddress,
  CylinderStorage,
  PreferredDay,
} from '../../../types/company'

interface Props {
  company: Company
  locations: DeliveryLocation[]
  onNext: () => void
  onBack: () => void
}

const DAYS: { value: PreferredDay; label: string }[] = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
]

const STORAGE_TYPES: { value: CylinderStorage; label: string }[] = [
  { value: 'outdoors', label: 'Outdoors' },
  { value: 'indoors', label: 'Indoors' },
  { value: 'dock', label: 'Dock Access' },
]

function emptyAddress(): OnboardingAddress {
  return { street: '', city: '', state: '', zip: '' }
}

function emptyLocation(address?: OnboardingAddress): Omit<DeliveryLocation, 'id'> {
  return {
    nickname: '',
    address: address ?? emptyAddress(),
    accessNotes: '',
    preferredDays: [],
    contactName: '',
    contactPhone: '',
    cylinderStorage: 'outdoors',
    currentProvider: null,
  }
}

type LocalLocation = Omit<DeliveryLocation, 'id'> & { localId: string; savedId?: string }

function toLocal(loc: DeliveryLocation): LocalLocation {
  return { ...loc, localId: loc.id, savedId: loc.id }
}

export const Step2DeliverySetup: React.FC<Props> = ({
  company,
  locations: initialLocations,
  onNext,
  onBack,
}) => {
  const companyId = company.companyId

  // Seed: use saved locations or create a first one from the company address
  const [locs, setLocs] = useState<LocalLocation[]>(() => {
    if (initialLocations.length > 0) {
      return initialLocations.map(toLocal)
    }
    const billingAddr =
      company.deliveryAddress ?? company.billingAddress ?? emptyAddress()
    return [
      {
        ...emptyLocation(billingAddr),
        localId: 'new-0',
      },
    ]
  })

  const [hasOtherProvider, setHasOtherProvider] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const saveTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ── Auto-save (per location) ───────────────────────────────────────────────

  const scheduleAutoSave = useCallback(
    (loc: LocalLocation) => {
      const existing = saveTimeouts.current.get(loc.localId)
      if (existing) clearTimeout(existing)
      const t = setTimeout(async () => {
        try {
          await saveLocation(companyId, {
            nickname: loc.nickname,
            address: loc.address,
            accessNotes: loc.accessNotes,
            preferredDays: loc.preferredDays,
            contactName: loc.contactName,
            contactPhone: loc.contactPhone,
            cylinderStorage: loc.cylinderStorage,
            currentProvider: loc.currentProvider,
          }, loc.savedId)
        } catch {
          // Silent auto-save failure
        }
      }, 800)
      saveTimeouts.current.set(loc.localId, t)
    },
    [companyId],
  )

  // ── Update helpers ────────────────────────────────────────────────────────

  const updateLoc = useCallback(
    (localId: string, patch: Partial<LocalLocation>) => {
      setLocs((prev) => {
        const next = prev.map((l) =>
          l.localId === localId ? { ...l, ...patch } : l,
        )
        const updated = next.find((l) => l.localId === localId)
        if (updated) scheduleAutoSave(updated)
        return next
      })
    },
    [scheduleAutoSave],
  )

  const toggleDay = (localId: string, day: PreferredDay) => {
    setLocs((prev) =>
      prev.map((l) => {
        if (l.localId !== localId) return l
        const has = l.preferredDays.includes(day)
        const updated = {
          ...l,
          preferredDays: has
            ? l.preferredDays.filter((d) => d !== day)
            : [...l.preferredDays, day],
        }
        scheduleAutoSave(updated)
        return updated
      }),
    )
  }

  const addLocation = () => {
    if (locs.length >= 3) return
    setLocs((prev) => [
      ...prev,
      { ...emptyLocation(), localId: `new-${Date.now()}` },
    ])
  }

  const removeLocation = async (loc: LocalLocation) => {
    if (loc.savedId) {
      await deleteLocation(companyId, loc.savedId)
    }
    setLocs((prev) => prev.filter((l) => l.localId !== loc.localId))
  }

  // ── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    locs.forEach((loc, i) => {
      if (!loc.nickname.trim()) errs[`${i}.nickname`] = 'Required'
      if (!loc.address.street.trim()) errs[`${i}.street`] = 'Required'
      if (!loc.address.city.trim()) errs[`${i}.city`] = 'Required'
      if (!loc.address.state.trim()) errs[`${i}.state`] = 'Required'
      if (!loc.address.zip.trim()) errs[`${i}.zip`] = 'Required'
      if (!loc.contactName.trim()) errs[`${i}.contactName`] = 'Required'
      if (!loc.contactPhone.trim()) errs[`${i}.contactPhone`] = 'Required'
    })
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleNext = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      await Promise.all(
        locs.map((loc) =>
          saveLocation(
            companyId,
            {
              nickname: loc.nickname,
              address: loc.address,
              accessNotes: loc.accessNotes,
              preferredDays: loc.preferredDays,
              contactName: loc.contactName,
              contactPhone: loc.contactPhone,
              cylinderStorage: loc.cylinderStorage,
              currentProvider:
                hasOtherProvider && loc.currentProvider
                  ? loc.currentProvider
                  : null,
            },
            loc.savedId,
          ),
        ),
      )
      await advanceSetupStep(companyId, 2)
      onNext()
    } catch {
      setErrors({ _form: 'Save failed. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ob-step">
      <h2 className="ob-step__heading">Delivery Setup</h2>
      <p className="ob-step__sub">
        Add your delivery location(s). You can add up to 3 during setup and add more later.
      </p>
      {errors._form && <p className="ob-step__err" role="alert">{errors._form}</p>}

      {locs.map((loc, i) => (
        <div key={loc.localId} className="ob-step__location-card">
          <div className="ob-step__location-header">
            <h3 className="ob-step__location-title">Location {i + 1}</h3>
            {locs.length > 1 && (
              <button
                type="button"
                className="ob-step__remove-btn"
                onClick={() => void removeLocation(loc)}
              >
                Remove
              </button>
            )}
          </div>

          <Input
            label="Nickname"
            placeholder='e.g. "Main Kitchen" or "Taproom"'
            value={loc.nickname}
            onChange={(e) => updateLoc(loc.localId, { nickname: e.target.value })}
            error={errors[`${i}.nickname`]}
            required
          />

          <fieldset className="ob-step__fieldset">
            <legend className="ob-step__legend">Address</legend>
            <Input
              label="Street"
              value={loc.address.street}
              onChange={(e) =>
                updateLoc(loc.localId, { address: { ...loc.address, street: e.target.value } })
              }
              error={errors[`${i}.street`]}
              required
            />
            <div className="ob-step__row">
              <Input
                label="City"
                value={loc.address.city}
                onChange={(e) =>
                  updateLoc(loc.localId, { address: { ...loc.address, city: e.target.value } })
                }
                error={errors[`${i}.city`]}
                required
              />
              <Input
                label="State"
                value={loc.address.state}
                onChange={(e) =>
                  updateLoc(loc.localId, { address: { ...loc.address, state: e.target.value } })
                }
                error={errors[`${i}.state`]}
                required
                maxLength={2}
                style={{ maxWidth: '6rem' }}
              />
              <Input
                label="Zip"
                value={loc.address.zip}
                onChange={(e) =>
                  updateLoc(loc.localId, { address: { ...loc.address, zip: e.target.value } })
                }
                error={errors[`${i}.zip`]}
                required
                maxLength={10}
                style={{ maxWidth: '8rem' }}
              />
            </div>
          </fieldset>

          <div className="ob-step__row">
            <Input
              label="Delivery Contact Name"
              value={loc.contactName}
              onChange={(e) => updateLoc(loc.localId, { contactName: e.target.value })}
              error={errors[`${i}.contactName`]}
              required
            />
            <Input
              label="Contact Phone"
              type="tel"
              value={loc.contactPhone}
              onChange={(e) => updateLoc(loc.localId, { contactPhone: e.target.value })}
              error={errors[`${i}.contactPhone`]}
              required
            />
          </div>

          <div className="ui-field">
            <label className="ui-field__label">Access Notes</label>
            <textarea
              className="ui-input ob-step__textarea"
              placeholder="Gate codes, dock hours, parking instructions…"
              value={loc.accessNotes}
              onChange={(e) => updateLoc(loc.localId, { accessNotes: e.target.value })}
              rows={2}
            />
          </div>

          {/* Preferred delivery days */}
          <div className="ui-field">
            <span className="ui-field__label">Preferred Delivery Days</span>
            <div className="ob-step__day-chips">
              {DAYS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`ob-step__day-chip${loc.preferredDays.includes(value) ? ' ob-step__day-chip--on' : ''}`}
                  onClick={() => toggleDay(loc.localId, value)}
                  aria-pressed={loc.preferredDays.includes(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Cylinder storage */}
          <div className="ui-field">
            <span className="ui-field__label">Cylinder Storage</span>
            <div className="ob-step__radio-group">
              {STORAGE_TYPES.map(({ value, label }) => (
                <label key={value} className="ob-step__radio-label">
                  <input
                    type="radio"
                    name={`storage-${loc.localId}`}
                    value={value}
                    checked={loc.cylinderStorage === value}
                    onChange={() => updateLoc(loc.localId, { cylinderStorage: value })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Current provider */}
      <div className="ui-field ob-step__section">
        <span className="ui-field__label">
          Do you currently receive gas from another supplier?
        </span>
        <div className="ob-step__radio-group">
          <label className="ob-step__radio-label">
            <input
              type="radio"
              name="current-provider-yn"
              value="yes"
              checked={hasOtherProvider === true}
              onChange={() => setHasOtherProvider(true)}
            />
            Yes
          </label>
          <label className="ob-step__radio-label">
            <input
              type="radio"
              name="current-provider-yn"
              value="no"
              checked={hasOtherProvider === false}
              onChange={() => setHasOtherProvider(false)}
            />
            No
          </label>
        </div>
        {hasOtherProvider && (
          <div className="ob-step__section">
            {locs.map((loc, i) => (
              <Input
                key={loc.localId}
                label={
                  locs.length > 1
                    ? `Current supplier for Location ${i + 1}`
                    : 'Who is your current supplier?'
                }
                value={loc.currentProvider ?? ''}
                onChange={(e) =>
                  updateLoc(loc.localId, { currentProvider: e.target.value })
                }
              />
            ))}
          </div>
        )}
      </div>

      {locs.length < 3 && (
        <button
          type="button"
          className="ob-step__add-location-btn"
          onClick={addLocation}
        >
          + Add Another Location
        </button>
      )}

      <div className="ob-step__actions">
        <Button variant="ghost" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleNext()}
          loading={submitting}
          className="ob-step__next"
        >
          Next: Gas Usage
        </Button>
      </div>
    </div>
  )
}
