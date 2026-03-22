import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { runsCol, runStopsCol } from '../lib/firestore'
import type { Run, RunStop, RunStatus, RunStopStatus } from '../types/run'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions } from './base'

export interface RunFilters {
  driverId?: string
  status?: RunStatus
  dateAfter?: Date
  dateBefore?: Date
}

export interface CreateRunInput {
  driverId: string
  truckId?: string
  scheduledDate: Date
  notes?: string
}

export interface CreateRunStopInput {
  runId: string
  order: number
  orderId: string
  customerId: string
  tankId?: string
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getRun(id: string): Promise<Run> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'runs', id))
    return fromSnap<Run>(snap, 'runs')
  })
}

export async function getRuns(
  filters: RunFilters = {},
  options: PageOptions = {},
): Promise<Page<Run>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = [orderBy('scheduledDate')]
    if (filters.driverId)   constraints.push(where('driverId', '==', filters.driverId))
    if (filters.status)     constraints.push(where('status', '==', filters.status))
    if (filters.dateAfter)  constraints.push(where('scheduledDate', '>=', filters.dateAfter))
    if (filters.dateBefore) constraints.push(where('scheduledDate', '<=', filters.dateBefore))
    return paginate<Run>(runsCol, constraints, options)
  })
}

export async function getRunStops(runId: string): Promise<RunStop[]> {
  return serviceCall(async () => {
    const snap = await getDocs(query(runStopsCol(runId), orderBy('order')))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as RunStop)
  })
}

export function subscribeToRun(id: string, callback: (run: Run | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'runs', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Run) : null)
  })
}

export function subscribeToRunStops(
  runId: string,
  callback: (stops: RunStop[]) => void,
): Unsubscribe {
  return onSnapshot(query(runStopsCol(runId), orderBy('order')), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as RunStop))
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createRun(data: CreateRunInput): Promise<string> {
  return serviceCall(async () => {
    const runNumber = `RUN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    const ref = await addDoc(runsCol, {
      runNumber,
      ...clean,
      status: 'scheduled' as RunStatus,
      stopIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as Omit<Run, 'id'>)
    return ref.id
  })
}

export async function updateRun(
  id: string,
  data: Partial<Omit<Run, 'id' | 'createdAt'>>,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'runs', id), { ...data, updatedAt: serverTimestamp() }),
  )
}

export async function archiveRun(id: string): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'runs', id), {
      status: 'archived' as RunStatus,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  )
}

export async function deleteRun(id: string): Promise<void> {
  return serviceCall(async () => {
    const stops = await getRunStops(id)
    const batch = writeBatch(db)
    stops.forEach((s) => batch.delete(doc(db, 'runs', id, 'stops', s.id)))
    batch.delete(doc(db, 'runs', id))
    await batch.commit()
  })
}

// ── Stop management ───────────────────────────────────────────────────────────

export async function addRunStop(data: CreateRunStopInput): Promise<string> {
  return serviceCall(async () => {
    const cleanStop = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    const stopRef = await addDoc(runStopsCol(data.runId), {
      ...cleanStop,
      status: 'pending' as RunStopStatus,
    } as unknown as RunStop)
    // Keep the parent run's stopIds array in sync
    const run = await getRun(data.runId)
    await updateDoc(doc(db, 'runs', data.runId), {
      stopIds: [...(run.stopIds ?? []), stopRef.id],
      updatedAt: serverTimestamp(),
    })
    return stopRef.id
  })
}

export async function updateRunStop(
  runId: string,
  stopId: string,
  data: Partial<Omit<RunStop, 'id' | 'runId'>>,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'runs', runId, 'stops', stopId), data),
  )
}

export async function reorderRunStops(runId: string, orderedStopIds: string[]): Promise<void> {
  return serviceCall(async () => {
    const batch = writeBatch(db)
    orderedStopIds.forEach((stopId, idx) => {
      batch.update(doc(db, 'runs', runId, 'stops', stopId), { order: idx + 1 })
    })
    batch.update(doc(db, 'runs', runId), {
      stopIds: orderedStopIds,
      updatedAt: serverTimestamp(),
    })
    await batch.commit()
  })
}

/** Stub — call the route optimisation Cloud Function. */
export async function optimiseRunRoute(runId: string): Promise<void> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ runId: string }, { stopIds: string[] }>(
      functions,
      'optimiseRunRoute',
    )
    const result = await fn({ runId })
    await reorderRunStops(runId, result.data.stopIds)
  })
}

/** Mark a stop's status and record arrival/completion timestamps. */
export async function updateStopStatus(
  runId: string,
  stopId: string,
  status: RunStopStatus,
): Promise<void> {
  return serviceCall(async () => {
    const update: Record<string, unknown> = { status }
    if (status === 'arrived')   update.arrivedAt   = serverTimestamp()
    if (status === 'completed') update.completedAt = serverTimestamp()
    await updateDoc(doc(db, 'runs', runId, 'stops', stopId), update)

    // If all stops are completed mark the run complete
    const stops = await getRunStops(runId)
    if (stops.every((s) => s.status === 'completed' || s.status === 'skipped')) {
      await updateDoc(doc(db, 'runs', runId), {
        status: 'completed' as RunStatus,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
  })
}
