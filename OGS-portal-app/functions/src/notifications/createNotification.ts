/**
 * functions/src/notifications/createNotification.ts
 *
 * Shared helper used by all Cloud Function triggers that need to write
 * an in-app notification to Firestore.
 *
 * Usage:
 *   import { createNotification } from '../notifications/createNotification'
 *
 *   // User-targeted notification
 *   await createNotification({
 *     userId:   customerId,
 *     type:     'payment_received',
 *     title:    'Payment Received',
 *     body:     `$${amount} received for invoice #${invoiceNumber}`,
 *     entityId: invoiceId,
 *     link:     `/portal/invoices/${invoiceId}`,
 *   })
 *
 *   // Role-broadcast notification (e.g. all dispatch users)
 *   await createNotification({
 *     userId:   null,
 *     role:     'dispatch',
 *     type:     'payment_failed',
 *     title:    'Payment Failed',
 *     body:     `Invoice #${invoiceNumber} payment failed: ${reason}`,
 *     entityId: invoiceId,
 *     priority: 'high',
 *   })
 */

import { db, FieldValue } from '../admin'

export type NotificationType =
  | 'rush_order'
  | 'delivery_complete'
  | 'payment_received'
  | 'payment_failed'
  | 'low_tank'
  | 'overdue_invoice'
  | 'cert_expiry'
  | string

export interface CreateNotificationParams {
  /** Target user ID. Pass null for role-broadcast notifications. */
  userId:    string | null
  /** Target role string for broadcast notifications, e.g. 'dispatch'. */
  role?:     string
  type:      NotificationType
  title:     string
  body:      string
  /** Deep link shown in the notification panel, e.g. '/portal/invoices/abc'. */
  link?:     string
  /** Related Firestore document ID. */
  entityId?: string
  priority?: 'normal' | 'high' | 'urgent'
}

/**
 * Writes a notification document to Firestore.
 * Never throws — errors are logged and swallowed so that notification failures
 * never block the primary business logic in the calling trigger.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<void> {
  try {
    await db.collection('notifications').add({
      userId:    params.userId   ?? null,
      role:      params.role     ?? null,
      type:      params.type,
      title:     params.title,
      body:      params.body,
      link:      params.link     ?? null,
      entityId:  params.entityId ?? null,
      priority:  params.priority ?? 'normal' as const,
      read:      false,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error(
      `createNotification [${params.type}]: failed —`,
      err,
      '\nparams:', JSON.stringify({ ...params, body: params.body.slice(0, 80) }),
    )
  }
}
