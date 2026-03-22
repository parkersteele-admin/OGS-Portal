import type { Timestamp } from 'firebase/firestore'

export type RunStatus = 'scheduled' | 'in-progress' | 'completed' | 'cancelled' | 'archived'

export type RunStopStatus = 'pending' | 'arrived' | 'completed' | 'skipped'

/** Tracks where a run is in the pre-departure truck loading process. */
export type LoadStatus = 'pending' | 'loading' | 'ready' | 'started'

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
  /** Truck load manifest checklist status. */
  loadStatus?: LoadStatus
  loadStartedAt?: Timestamp
  loadCompletedAt?: Timestamp
  /** UID of the driver who completed the truck load. */
  loadedBy?: string
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
