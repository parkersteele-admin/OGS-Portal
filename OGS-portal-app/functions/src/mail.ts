/**
 * functions/src/mail.ts
 *
 * Re-exports the canonical email helpers from functions/src/email/sendEmail.ts.
 *
 * All existing callers (stripeWebhook, processAutopay, etc.) import from
 * '../mail' or './mail' — keeping this shim means zero changes to call sites.
 *
 * For new code, prefer importing directly from './email/sendEmail' and using
 * sendTemplateEmail() with a template ID from './email/templates'.
 */

export { sendEmail, sendTemplateEmail } from './email/sendEmail'
export type { MailOptions } from './email/sendEmail'

export function autopayReceiptHtml(params: {
  customerName:  string
  invoiceNumber: string
  amount:        string
}): string {
  return `
  <h2>Autopay Receipt – OGS Portal</h2>
  <p>Hi ${params.customerName},</p>
  <p>A payment of <strong>${params.amount}</strong> was automatically collected for invoice
  <strong>#${params.invoiceNumber}</strong>.</p>
  <p>Thank you for using autopay.</p>
  <p>— The OGS Portal Team</p>
  `
}
