import type { Timestamp } from 'firebase/firestore'

export type TankStatus = 'available' | 'deployed' | 'returned' | 'inspection'

/** Who legally owns the physical tank. */
export type TankOwnership = 'company' | 'customer'

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
}
