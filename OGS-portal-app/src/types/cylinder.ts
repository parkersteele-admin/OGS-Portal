import type { Timestamp } from 'firebase/firestore'

/**
 * A single cylinder record in the /cylinders collection.
 * Represents a physical propane/gas cylinder tracked by QR code.
 */
export interface Cylinder {
  cylinderId: string
  productId: string
  productName: string
  sizeLabel: string
  status: 'available' | 'onTruck' | 'atCustomer' | 'returned' | 'maintenance'
  currentRunId?: string
  currentCustomerId?: string
  lastScannedAt?: Timestamp
  lastScannedBy?: string
}

/**
 * A single entry in /runs/{runId}/manifest/{cylinderId}.
 * Represents a cylinder that must be physically loaded before the run starts.
 */
export interface ManifestItem {
  cylinderId: string
  productId: string
  productName: string
  sizeLabel: string
  customerId: string
  customerName: string
  stopSequence: number
  orderType: 'route' | 'offRoute' | 'addOn'
  required: true
  scanned: boolean
  scannedAt?: Timestamp
  scannedBy?: string
}

/**
 * A missing-cylinder flag entry in /runs/{runId}/flags/{cylinderId}.
 */
export interface CylinderFlag {
  cylinderId: string
  reportedBy: string
  reportedAt: Timestamp
  notes: string
  resolved: boolean
}
