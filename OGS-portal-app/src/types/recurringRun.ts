import type { Timestamp } from 'firebase/firestore'

export type RecurringRunFrequency = 'weekly' | 'biweekly' | 'monthly'

export interface RecurringRunAssignment {
  customerId: string
  locationId?: string
  locationName?: string
}

export interface RecurringRunTemplate {
  id: string
  name: string
  /** Optional pre-assigned driver for runs generated from this template. */
  driverId?: string
  /** Day of week (0 = Sunday ... 6 = Saturday). */
  dayOfWeek: number
  frequency: RecurringRunFrequency
  /** Anchor date used to determine cadence intervals. */
  startDate: Timestamp
  /** Legacy flat customer assignment list kept for compatibility. */
  customerIds?: string[]
  /** Canonical assignment list with optional location-level routing. */
  customerAssignments?: RecurringRunAssignment[]
  isActive: boolean
  notes?: string
  /** Next date this recurring template should produce a run. */
  nextRunDate?: Timestamp
  /** Timestamp of the last run generated from this template. */
  lastRunGeneratedAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}