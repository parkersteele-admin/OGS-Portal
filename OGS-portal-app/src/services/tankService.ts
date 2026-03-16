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
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { tanksCol, customerTanksCol } from '../lib/firestore'
import type { Tank, TankStatus, TankOwnership } from '../types/tank'
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
  available:  ['deployed', 'inspection'],
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
    const payload = {
      ...data,
      ownership: data.ownership ?? ('company' as TankOwnership),
      status: 'available' as TankStatus,
      currentLevelPct: undefined,
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
    await Promise.all([
      updateDoc(doc(db, 'tanks', id), update),
      updateDoc(doc(db, `customers/${tank.customerId}/tanks`, id), update),
    ])
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
