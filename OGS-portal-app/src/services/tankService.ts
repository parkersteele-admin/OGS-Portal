import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  collection,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { tanksCol, customerTanksCol, tankEventsCol } from '../lib/firestore'
import type { Tank, TankStatus, TankOwnership, TankEvent, TankEventType } from '../types/tank'
import {
  serviceCall,
  fromSnap,
  paginate,
  type Page,
  type PageOptions,
  OgsValidationError,
} from './base'

export interface TankFilters {
  customerId?: string
  status?: TankStatus
  gasType?: string
}

export interface CreateTankInput {
  customerId: string
  serialNumber: string
  gasType: string
  sizeLabel: string
  capacityValue: number
  capacityUnit: string
  ownership?: TankOwnership
  monthlyRate?: number
  notes?: string
}

// Valid lifecycle transitions
const VALID_TRANSITIONS: Record<TankStatus, TankStatus[]> = {
  available:  ['on_truck', 'deployed', 'inspection'],
  on_truck:   ['available', 'deployed', 'returned'],
  deployed:   ['returned', 'inspection'],
  returned:   ['available', 'inspection'],
  inspection: ['available', 'returned'],
}

export function canTransition(from: TankStatus, to: TankStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getTank(id: string): Promise<Tank> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'tanks', id))
    return fromSnap<Tank>(snap, 'tanks')
  })
}

export async function getTanks(
  filters: TankFilters = {},
  options: PageOptions = {},
): Promise<Page<Tank>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = []
    if (filters.customerId) constraints.push(where('customerId', '==', filters.customerId))
    if (filters.status)     constraints.push(where('status', '==', filters.status))
    if (filters.gasType)    constraints.push(where('gasType', '==', filters.gasType))
    constraints.push(orderBy('serialNumber'))
    return paginate<Tank>(tanksCol, constraints, options)
  })
}

/** Returns tanks for a specific customer via subcollection. */
export async function getCustomerTanks(customerId: string): Promise<Tank[]> {
  return serviceCall(async () => {
    const col = customerTanksCol(customerId)
    const snap = await getDocs(query(col, orderBy('serialNumber')))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank)
  })
}

export function subscribeToTank(id: string, callback: (tank: Tank | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'tanks', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Tank) : null)
  })
}

export function subscribeToCustomerTanks(
  customerId: string,
  callback: (tanks: Tank[]) => void,
): Unsubscribe {
  const col = customerTanksCol(customerId)
  return onSnapshot(query(col, orderBy('serialNumber')), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank))
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Creates the tank in both /tanks and /customers/{id}/tanks for query flexibility. */
export async function createTank(data: CreateTankInput): Promise<string> {
  return serviceCall(async () => {
    // Strip undefined fields — Firestore rejects them
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    const payload = {
      ...clean,
      ownership: data.ownership ?? ('company' as TankOwnership),
      status: 'available' as TankStatus,
    }
    // Write to top-level collection
    const ref = await addDoc(tanksCol, payload as never)
    // Mirror to customer subcollection
    await setDoc(doc(db, `customers/${data.customerId}/tanks`, ref.id), { ...payload, id: ref.id })
    return ref.id
  })
}

export async function updateTank(
  id: string,
  data: Partial<Omit<Tank, 'id'>>,
): Promise<void> {
  return serviceCall(async () => {
    const update = { ...data, updatedAt: serverTimestamp() }
    const tank = await getTank(id)
    const writes: Promise<void>[] = [updateDoc(doc(db, 'tanks', id), update)]
    // Only sync the customer subcollection when a customerId exists AND the
    // status change is not a driver-only operation (loaded/returned have no
    // customer context). Subcollection writes require dispatch permissions.
    if (tank.customerId && data.status !== 'on_truck' && data.status !== 'returned') {
      writes.push(updateDoc(doc(db, `customers/${tank.customerId}/tanks`, id), update))
    }
    await Promise.all(writes)
  })
}

export async function updateTankLevel(id: string, levelPct: number): Promise<void> {
  if (levelPct < 0 || levelPct > 100) {
    throw new OgsValidationError('Tank level must be between 0 and 100')
  }
  return updateTank(id, { currentLevelPct: levelPct })
}

export async function transitionTankStatus(id: string, nextStatus: TankStatus): Promise<void> {
  return serviceCall(async () => {
    const tank = await getTank(id)
    if (!canTransition(tank.status, nextStatus)) {
      throw new OgsValidationError(
        `Cannot transition tank from '${tank.status}' to '${nextStatus}'`,
      )
    }
    await updateTank(id, { status: nextStatus })
  })
}

export async function deleteTank(id: string): Promise<void> {
  return serviceCall(async () => {
    const tank = await getTank(id)
    await Promise.all([
      deleteDoc(doc(db, 'tanks', id)),
      deleteDoc(doc(db, `customers/${tank.customerId}/tanks`, id)),
    ])
  })
}

// ── Compliance ────────────────────────────────────────────────────────────────

/** Returns tanks whose nextInspectionDate is within the next `days` days. */
export async function getTanksDueForInspection(days = 30): Promise<Tank[]> {
  return serviceCall(async () => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + days)
    const snap = await getDocs(
      query(
        tanksCol,
        where('status', 'in', ['available', 'deployed']),
        where('nextInspectionDate', '<=', cutoff),
        orderBy('nextInspectionDate'),
      ),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank)
  })
}

// ── Tank event log ────────────────────────────────────────────────────────────

async function addTankEvent(
  tankId: string,
  type: TankEventType,
  actorId: string,
  actorName: string,
  extra?: Partial<Omit<TankEvent, 'id' | 'type' | 'timestamp' | 'actorId' | 'actorName'>>,
): Promise<void> {
  const eventsCol = collection(db, `tanks/${tankId}/events`)
  await addDoc(eventsCol, {
    type,
    timestamp: serverTimestamp(),
    actorId,
    actorName,
    ...extra,
  })
}

export async function getTankEvents(tankId: string): Promise<TankEvent[]> {
  return serviceCall(async () => {
    const evCol = tankEventsCol(tankId)
    const snap = await getDocs(query(evCol, orderBy('timestamp', 'desc')))
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TankEvent, 'id'>) }))
  })
}

export function subscribeToTankEvents(
  tankId: string,
  callback: (events: TankEvent[]) => void,
): Unsubscribe {
  const evCol = tankEventsCol(tankId)
  return onSnapshot(query(evCol, orderBy('timestamp', 'desc')), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TankEvent, 'id'>) })))
  })
}

// ── Driver operations ─────────────────────────────────────────────────────────

/** Load a tank from inventory onto a driver's truck. */
export async function loadTankToTruck(
  tankId: string,
  driverId: string,
  driverName: string,
): Promise<void> {
  return serviceCall(async () => {
    const tank = await getTank(tankId)
    if (tank.status !== 'available') {
      throw new OgsValidationError(
        `Tank ${tank.serialNumber} is not available (currently: ${tank.status}).`,
      )
    }
    await updateTank(tankId, {
      status: 'on_truck',
      driverId,
      driverName,
      loadedAt: serverTimestamp() as unknown as Tank['loadedAt'],
    })
    await addTankEvent(tankId, 'loaded_to_truck', driverId, driverName)
  })
}

/** Mark a tank as delivered to a customer (driver action). */
export async function deliverTankToCustomer(
  tankId: string,
  customerId: string,
  customerName: string,
  driverId: string,
  driverName: string,
  signedBy?: string,
): Promise<void> {
  return serviceCall(async () => {
    const tank = await getTank(tankId)
    if (tank.status !== 'on_truck') {
      throw new OgsValidationError(`Tank ${tank.serialNumber} is not on a truck.`)
    }
    await updateTank(tankId, {
      status: 'deployed',
      customerId,
      driverId: undefined,
      driverName: undefined,
    })
    await addTankEvent(tankId, 'delivered_to_customer', driverId, driverName, {
      customerId,
      customerName,
      signedBy,
    })
  })
}

/** Driver checks in an empty tank returned from a customer. */
export async function checkInEmptyTank(
  tankId: string,
  driverId: string,
  driverName: string,
  note?: string,
): Promise<void> {
  return serviceCall(async () => {
    const tank = await getTank(tankId)
    if (tank.status !== 'deployed') {
      throw new OgsValidationError(
        `Tank ${tank.serialNumber} is not deployed at a customer (currently: ${tank.status}).`,
      )
    }
    await updateTank(tankId, {
      status: 'returned',
      driverId: undefined,
      driverName: undefined,
      customerId: 'WAREHOUSE',
    })
    await addTankEvent(tankId, 'empty_returned', driverId, driverName, { note })
  })
}

/** Get all tanks currently on a specific driver's truck. */
export async function getDriverTruckTanks(driverId: string): Promise<Tank[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(tanksCol, where('status', '==', 'on_truck'), where('driverId', '==', driverId)),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank)
  })
}

/** Subscribe to all tanks on a driver's truck in real time. */
export function subscribeToDriverTruckTanks(
  driverId: string,
  callback: (tanks: Tank[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(tanksCol, where('status', '==', 'on_truck'), where('driverId', '==', driverId)),
    (snap) => callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank)),
  )
}

/**
 * Returns deployed tanks that the driver last touched —
 * used to determine if a driver has empties waiting to be checked in.
 */
export async function getDriverPendingReturns(driverId: string): Promise<Tank[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(
        tanksCol,
        where('status', '==', 'deployed'),
        // We store lastDriverId for return tracking — fall back to basic deployed check
      ),
    )
    // Filter client-side by driverId presence in events is complex;
    // instead we track pendingReturn via a dedicated field:
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }) as Tank)
      .filter((t) => (t as Tank & { pendingReturnDriverId?: string }).pendingReturnDriverId === driverId)
  })
}
