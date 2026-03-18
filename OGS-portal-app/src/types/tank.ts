import type { Timestamp } from 'firebase/firestore'

export type TankStatus = 'available' | 'on_truck' | 'deployed' | 'returned' | 'inspection'

/** Who legally owns the physical tank. */
export type TankOwnership = 'company' | 'customer'

export type TankEventType =
  | 'created'
  | 'loaded_to_truck'
  | 'unloaded_from_truck'
  | 'delivered_to_customer'
  | 'empty_returned'
  | 'status_changed'
  | 'inspection_updated'

export interface TankEvent {
  id: string
  type: TankEventType
  timestamp: Timestamp
  actorId: string
  actorName: string
  note?: string
  customerId?: string
  customerName?: string
  signedBy?: string
}

export interface Tank {
  id: string
  customerId: string
  serialNumber: string
  /** Gas type stored in the tank, e.g. "propane", "CO2", "nitrogen". */
  gasType: string
  /** Human-readable size label, e.g. "500 gal", "100 cf". */
  sizeLabel: string
  capacityValue: number
  /** Unit for capacityValue, e.g. "gal" or "cf". */
  capacityUnit: string
  status: TankStatus
  ownership?: TankOwnership
  /** Estimated fill level as a percentage 0–100. */
  currentLevelPct?: number
  rentalStartDate?: Timestamp
  /** Monthly rental rate in dollars, if applicable. */
  monthlyRate?: number
  lastInspectionDate?: Timestamp
  nextInspectionDate?: Timestamp
  notes?: string
  /** Driver UID when status is on_truck */
  driverId?: string
  /** Driver display name when status is on_truck */
  driverName?: string
  /** Loaded onto truck at */
  loadedAt?: Timestamp
}
