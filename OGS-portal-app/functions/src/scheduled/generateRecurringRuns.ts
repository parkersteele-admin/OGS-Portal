import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import { db, FieldValue, Timestamp } from '../admin'

type RecurringRunFrequency = 'weekly' | 'biweekly' | 'monthly'

interface RecurringRunAssignment {
  customerId: string
  locationId?: string
  locationName?: string
}

interface CustomerLocation {
  id: string
  name?: string
  shipToAddress?: {
    line1?: string
    city?: string
    state?: string
    zip?: string
  }
}

interface CustomerRecord {
  name?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  locations?: CustomerLocation[]
  defaultLocationId?: string
  deliveryContactName?: string
}

interface RouteScheduleLineItem {
  productId: string
  qty: number
  unitPrice: number
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function normalizeAssignments(docData: FirebaseFirestore.DocumentData): RecurringRunAssignment[] {
  const fromAssignments = Array.isArray(docData.customerAssignments)
    ? (docData.customerAssignments as Array<Record<string, unknown>>)
        .map((entry) => ({
          customerId: String(entry.customerId ?? '').trim(),
          locationId: entry.locationId ? String(entry.locationId).trim() : undefined,
          locationName: entry.locationName ? String(entry.locationName).trim() : undefined,
        }))
        .filter((entry) => entry.customerId)
    : []

  if (fromAssignments.length > 0) {
    const dedupe = new Set<string>()
    return fromAssignments.filter((entry) => {
      const key = `${entry.customerId}:${entry.locationId ?? ''}`
      if (dedupe.has(key)) return false
      dedupe.add(key)
      return true
    })
  }

  const fromLegacy = Array.isArray(docData.customerIds)
    ? (docData.customerIds as unknown[])
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean)
    : []

  return [...new Set(fromLegacy)].map((customerId) => ({ customerId }))
}

function alignToWeekday(date: Date, dayOfWeek: number): Date {
  const next = new Date(date)
  const diff = (dayOfWeek - next.getDay() + 7) % 7
  next.setDate(next.getDate() + diff)
  return next
}

function advanceDate(current: Date, frequency: RecurringRunFrequency, dayOfWeek: number): Date {
  const next = new Date(current)
  if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7)
    return next
  }
  if (frequency === 'biweekly') {
    next.setDate(next.getDate() + 14)
    return next
  }
  next.setMonth(next.getMonth() + 1)
  return alignToWeekday(next, dayOfWeek)
}

function resolveLocation(
  customer: CustomerRecord,
  assignment: RecurringRunAssignment,
): { locationId?: string; locationName?: string } {
  const locations = Array.isArray(customer.locations) ? customer.locations : []
  if (locations.length === 0) {
    return {
      ...(assignment.locationId ? { locationId: assignment.locationId } : {}),
      ...(assignment.locationName ? { locationName: assignment.locationName } : {}),
    }
  }

  const byAssigned = assignment.locationId
    ? locations.find((location) => location.id === assignment.locationId)
    : undefined
  const byDefault = customer.defaultLocationId
    ? locations.find((location) => location.id === customer.defaultLocationId)
    : undefined
  const chosen = byAssigned ?? byDefault ?? locations[0]

  return {
    locationId: chosen.id,
    locationName: chosen.name ?? assignment.locationName,
  }
}

async function loadRouteScheduleLineItems(customerId: string): Promise<RouteScheduleLineItem[]> {
  const scheduleSnap = await db.doc(`customers/${customerId}/routeSchedule/current`).get()
  if (!scheduleSnap.exists) return []

  const schedule = scheduleSnap.data() as { lineItems?: Array<Record<string, unknown>> } | undefined
  const lineItems = Array.isArray(schedule?.lineItems) ? schedule.lineItems : []

  return lineItems
    .map((item) => ({
      productId: String(item.productId ?? '').trim(),
      qty: Number(item.qty ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
    }))
    .filter((item) => item.productId.length > 0 && item.qty > 0)
}

export const generateRecurringRuns = onSchedule(
  {
    schedule: '5 5 * * *',
    timeZone: 'America/New_York',
    memory: '512MiB',
  },
  async () => {
    const now = new Date()
    const cutoff = new Date(now)
    cutoff.setHours(23, 59, 59, 999)
    const cutoffTs = Timestamp.fromDate(cutoff)

    logger.info(`generateRecurringRuns: start cutoff=${cutoff.toISOString()}`)

    const activeTemplatesSnap = await db
      .collection('recurringRuns')
      .where('isActive', '==', true)
      .get()

    let templatesProcessed = 0
    let runsCreated = 0
    let stopsCreated = 0
    let assignmentsConflicted = 0
    let templatesSkipped = 0

    const customerDateAssignmentMap = new Map<string, string>()

    const templates = activeTemplatesSnap.docs
      .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
      .filter((entry) => {
        const nextRunDate = entry.data.nextRunDate as FirebaseFirestore.Timestamp | undefined
        return !!nextRunDate && nextRunDate.toDate() <= cutoffTs.toDate()
      })
      .sort((a, b) => String(a.data.name ?? '').localeCompare(String(b.data.name ?? '')))

    for (const template of templates) {
      templatesProcessed += 1

      const templateName = String(template.data.name ?? '').trim() || `Recurring ${template.id.slice(0, 6)}`
      const driverId = String(template.data.driverId ?? '').trim()
      const frequency = String(template.data.frequency ?? 'weekly') as RecurringRunFrequency
      const dayOfWeek = Number(template.data.dayOfWeek ?? 0)
      const nextRunDateTs = template.data.nextRunDate as FirebaseFirestore.Timestamp | undefined
      const dueDate = nextRunDateTs?.toDate()

      if (!dueDate) {
        logger.warn(`generateRecurringRuns: template=${template.id} missing nextRunDate, skipping`)
        templatesSkipped += 1
        continue
      }

      const recurringOccurrence = toDateKey(dueDate)
      const existingRunsSnap = await db
        .collection('runs')
        .where('recurringTemplateId', '==', template.id)
        .get()

      const duplicate = existingRunsSnap.docs.some((docSnap) => {
        const occurrence = String(docSnap.data().recurringOccurrence ?? '')
        return occurrence === recurringOccurrence
      })

      if (duplicate) {
        const advanced = advanceDate(dueDate, frequency, dayOfWeek)
        await db.collection('recurringRuns').doc(template.id).update({
          nextRunDate: Timestamp.fromDate(advanced),
          updatedAt: FieldValue.serverTimestamp(),
        })
        logger.info(`generateRecurringRuns: template=${template.id} duplicate occurrence ${recurringOccurrence}, advanced nextRunDate`)
        templatesSkipped += 1
        continue
      }

      const assignments = normalizeAssignments(template.data)
      if (assignments.length === 0) {
        const advanced = advanceDate(dueDate, frequency, dayOfWeek)
        await db.collection('recurringRuns').doc(template.id).update({
          nextRunDate: Timestamp.fromDate(advanced),
          updatedAt: FieldValue.serverTimestamp(),
        })
        logger.warn(`generateRecurringRuns: template=${template.id} has no assignments, advanced schedule without creating run`)
        templatesSkipped += 1
        continue
      }

      const selectedAssignments: RecurringRunAssignment[] = []
      for (const assignment of assignments) {
        const conflictKey = `${recurringOccurrence}:${assignment.customerId}`
        const existingTemplateName = customerDateAssignmentMap.get(conflictKey)
        if (existingTemplateName) {
          assignmentsConflicted += 1
          logger.warn(
            `generateRecurringRuns: conflict customer=${assignment.customerId} occurrence=${recurringOccurrence}; keeping ${existingTemplateName}, skipping ${templateName}`,
          )
          continue
        }
        customerDateAssignmentMap.set(conflictKey, templateName)
        selectedAssignments.push(assignment)
      }

      if (selectedAssignments.length === 0) {
        const advanced = advanceDate(dueDate, frequency, dayOfWeek)
        await db.collection('recurringRuns').doc(template.id).update({
          nextRunDate: Timestamp.fromDate(advanced),
          updatedAt: FieldValue.serverTimestamp(),
        })
        logger.warn(`generateRecurringRuns: template=${template.id} all assignments conflicted, advanced schedule`)
        templatesSkipped += 1
        continue
      }

      const scheduledDate = new Date(dueDate)
      scheduledDate.setHours(8, 0, 0, 0)
      const scheduledTs = Timestamp.fromDate(scheduledDate)

      const runRef = db.collection('runs').doc()
      const runNumber = `RRUN-${recurringOccurrence.replace(/-/g, '')}-${template.id.slice(0, 4).toUpperCase()}`

      const batch = db.batch()
      const stopIds: string[] = []
      const runGroupId = `RRUN-GRP-${template.id.slice(0, 8)}-${recurringOccurrence}`

      batch.set(runRef, {
        runNumber,
        driverId: driverId || 'unassigned',
        scheduledDate: scheduledTs,
        status: 'scheduled',
        stopIds: [],
        notes: templateName,
        recurringTemplateId: template.id,
        recurringOccurrence,
        source: 'recurring-template',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      for (let index = 0; index < selectedAssignments.length; index += 1) {
        const assignment = selectedAssignments[index]
        const customerId = assignment.customerId

        const [customerSnap, routeItems] = await Promise.all([
          db.collection('customers').doc(customerId).get(),
          loadRouteScheduleLineItems(customerId),
        ])

        if (!customerSnap.exists) {
          logger.warn(`generateRecurringRuns: customer ${customerId} not found, skipping assignment`)
          continue
        }

        const customer = customerSnap.data() as CustomerRecord
        const location = resolveLocation(customer, assignment)

        const primaryLine = routeItems[0]
        const subtotal = routeItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)

        const orderRef = db.collection('orders').doc()
        batch.set(orderRef, {
          customerId,
          companyId: customerId,
          ...(location.locationId ? { locationId: location.locationId } : {}),
          ...(location.locationName ? { locationName: location.locationName } : {}),
          productId: primaryLine?.productId ?? 'recurring-route-visit',
          quantity: primaryLine?.qty ?? 1,
          unitPrice: primaryLine?.unitPrice ?? 0,
          subtotal,
          deliveryFee: 0,
          total: subtotal,
          deliveryTier: 'standard',
          upchargePercent: 0,
          status: 'scheduled',
          orderType: 'route',
          groupId: runGroupId,
          quotedLineItems: routeItems.map((item) => ({
            productId: item.productId,
            description: item.productId,
            quantity: item.qty,
            unitPrice: item.unitPrice,
            amount: item.qty * item.unitPrice,
          })),
          notes: `Auto-generated from recurring route template: ${templateName}`,
          fromRecurringRunTemplate: true,
          recurringTemplateId: template.id,
          recurringOccurrence,
          requestedAt: FieldValue.serverTimestamp(),
          scheduledAt: scheduledTs,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })

        const stopRef = db.collection(`runs/${runRef.id}/stops`).doc()
        stopIds.push(stopRef.id)
        batch.set(stopRef, {
          runId: runRef.id,
          order: stopIds.length,
          orderId: orderRef.id,
          customerId,
          companyId: customerId,
          ...(location.locationId ? { locationId: location.locationId } : {}),
          ...(location.locationName ? { locationName: location.locationName } : {}),
          ...(customer.deliveryContactName ? { contactOnSite: customer.deliveryContactName } : {}),
          status: 'pending',
        })
      }

      if (stopIds.length === 0) {
        const advanced = advanceDate(dueDate, frequency, dayOfWeek)
        await db.collection('recurringRuns').doc(template.id).update({
          nextRunDate: Timestamp.fromDate(advanced),
          updatedAt: FieldValue.serverTimestamp(),
        })
        logger.warn(`generateRecurringRuns: template=${template.id} no valid stops created, advanced schedule`)
        templatesSkipped += 1
        continue
      }

      batch.update(runRef, {
        stopIds,
        updatedAt: FieldValue.serverTimestamp(),
      })

      const nextDate = advanceDate(dueDate, frequency, dayOfWeek)
      batch.update(db.collection('recurringRuns').doc(template.id), {
        nextRunDate: Timestamp.fromDate(nextDate),
        lastRunGeneratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      await batch.commit()
      runsCreated += 1
      stopsCreated += stopIds.length

      logger.info(
        `generateRecurringRuns: created run ${runRef.id} from template=${template.id} occurrence=${recurringOccurrence} stops=${stopIds.length}`,
      )
    }

    logger.info(
      `generateRecurringRuns: done templatesProcessed=${templatesProcessed} runsCreated=${runsCreated} stopsCreated=${stopsCreated} conflicts=${assignmentsConflicted} skipped=${templatesSkipped}`,
    )
  },
)
