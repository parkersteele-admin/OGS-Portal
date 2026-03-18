/**
 * src/modules/orders/new/RecurringSetup.tsx
 *
 * Modal for setting up a recurring order schedule.
 * Uses the existing Modal UI component.
 */

import React, { useState, useMemo } from 'react'
import { Timestamp } from 'firebase/firestore'
import { Modal } from '../../../components/ui/Modal'
import type { RecurringSchedule } from './types'
import './RecurringSetup.css'

interface RecurringSetupProps {
  open:     boolean
  current:  RecurringSchedule | null
  onSave:   (schedule: RecurringSchedule) => void
  onCancel: () => void
}

type Frequency = RecurringSchedule['frequency']

const FREQ_OPTIONS: { value: Frequency; label: string; days: number }[] = [
  { value: 'weekly',    label: 'Weekly',        days: 7  },
  { value: 'biweekly',  label: 'Every 2 Weeks', days: 14 },
  { value: 'monthly',   label: 'Monthly',       days: 30 },
  { value: 'custom',    label: 'Custom…',       days: 0  },
]

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function freqLabel(freq: Frequency, customDays: number | null): string {
  switch (freq) {
    case 'weekly':   return 'every week'
    case 'biweekly': return 'every 2 weeks'
    case 'monthly':  return 'every month'
    case 'custom':   return customDays ? `every ${customDays} day${customDays !== 1 ? 's' : ''}` : 'on a custom schedule'
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export const RecurringSetup: React.FC<RecurringSetupProps> = ({
  open,
  current,
  onSave,
  onCancel,
}) => {
  const tomorrow = addDays(new Date(), 1)

  const [frequency,      setFrequency]     = useState<Frequency>(current?.frequency ?? 'weekly')
  const [customDays,     setCustomDays]    = useState<number>(current?.customIntervalDays ?? 7)
  const [firstDelivery,  setFirstDelivery] = useState<string>(
    current?.nextDeliveryDate
      ? toDateInputValue(current.nextDeliveryDate.toDate())
      : toDateInputValue(tomorrow),
  )
  const [noEndDate, setNoEndDate]         = useState<boolean>(!current?.endDate)
  const [endDate,   setEndDate]           = useState<string>(
    current?.endDate ? toDateInputValue(current.endDate.toDate()) : '',
  )

  const summaryDate = useMemo(() => {
    if (!firstDelivery) return null
    const d = new Date(firstDelivery + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }, [firstDelivery])

  function handleSave() {
    if (!firstDelivery) return

    const nextDeliveryDate = Timestamp.fromDate(new Date(firstDelivery + 'T00:00:00'))
    const endDateTs = (!noEndDate && endDate)
      ? Timestamp.fromDate(new Date(endDate + 'T00:00:00'))
      : null

    onSave({
      frequency,
      customIntervalDays: frequency === 'custom' ? customDays : null,
      nextDeliveryDate,
      endDate:    endDateTs,
      active:     true,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Set Up Recurring Order"
      size="sm"
    >
      <div className="rs">
        {/* Frequency */}
        <fieldset className="rs__fieldset">
          <legend className="rs__legend">Delivery frequency</legend>
          <div className="rs__freq-grid">
            {FREQ_OPTIONS.map((opt) => (
              <label key={opt.value} className={`rs__freq-btn${frequency === opt.value ? ' rs__freq-btn--active' : ''}`}>
                <input
                  type="radio"
                  name="frequency"
                  value={opt.value}
                  checked={frequency === opt.value}
                  onChange={() => setFrequency(opt.value)}
                  className="rs__freq-radio"
                />
                {opt.label}
              </label>
            ))}
          </div>

          {frequency === 'custom' && (
            <div className="rs__custom-interval">
              <label className="rs__label">
                Interval (days)
                <input
                  className="rs__input rs__input--narrow"
                  type="number"
                  min={1}
                  value={customDays}
                  onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value)))}
                />
              </label>
            </div>
          )}
        </fieldset>

        {/* First delivery */}
        <div className="rs__field">
          <label className="rs__label">
            First delivery date
            <input
              className="rs__input"
              type="date"
              value={firstDelivery}
              min={toDateInputValue(tomorrow)}
              onChange={(e) => setFirstDelivery(e.target.value)}
            />
          </label>
        </div>

        {/* End date */}
        <div className="rs__field">
          <label className="rs__no-end">
            <input
              type="checkbox"
              checked={noEndDate}
              onChange={(e) => setNoEndDate(e.target.checked)}
              className="rs__checkbox"
            />
            No end date
          </label>
          {!noEndDate && (
            <label className="rs__label rs__label--mt">
              End date
              <input
                className="rs__input"
                type="date"
                value={endDate}
                min={firstDelivery || toDateInputValue(tomorrow)}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}
        </div>

        {/* Summary */}
        {summaryDate && (
          <div className="rs__summary">
            Your next delivery will be <strong>{summaryDate}</strong>,
            then {freqLabel(frequency, customDays)}.
            {!noEndDate && endDate && (
              <> Ends{' '}
                {new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}.
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="rs__actions">
          <button
            className="rs__btn rs__btn--primary"
            type="button"
            disabled={!firstDelivery}
            onClick={handleSave}
          >
            Save Recurring Schedule
          </button>
          <button
            className="rs__btn rs__btn--ghost"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
