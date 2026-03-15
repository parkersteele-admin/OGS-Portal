import type { Timestamp } from 'firebase/firestore'

export type RunStatus = 'scheduled' | 'in-progress' | 'completed' | 'cancelled'

export type RunStopStatus = 'pending' | 'arrived' | 'completed' | 'skipped'

export interface Run {
  id: string
  runNumber: string
  driverId: string
  truckId?: string
  scheduledDate: Timestamp
  status: RunStatus
  /** Ordered list of stop document IDs for this run. */
  stopIds: string[]
  startedAt?: Timestamp
  completedAt?: Timestamp
  totalGallons?: number
  notes?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface RunStop {
  id: string
  runId: string
  /** 1-based sequence number within the run. */
  order: number
  orderId: string
  customerId: string
  tankId?: string
  status: RunStopStatus
  gallonsDelivered?: number
  arrivedAt?: Timestamp
  completedAt?: Timestamp
  signatureUrl?: string
  photoUrls?: string[]
  notes?: string
}
