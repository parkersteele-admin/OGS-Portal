import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from '../admin'

export type OrderStatus =
  | 'pending'
  | 'scheduled'
  | 'assigned'
  | 'in-transit'
  | 'delivered'
  | 'ready_to_invoice'
  | 'invoice_sent'
  | 'invoiced'
  | 'paid'
  | 'cancelled'
  | 'archived'

export async function appendStatusHistory(
  db: Firestore,
  orderId: string,
  status: OrderStatus,
  changedByUid: string,
  changedByName: string,
  note?: string,
): Promise<void> {
  await db.collection('orders').doc(orderId).update({
    statusHistory: FieldValue.arrayUnion({
      status,
      changedAt: FieldValue.serverTimestamp(),
      changedBy: changedByUid,
      changedByName,
      ...(note ? { note } : {}),
    }),
  })
}
