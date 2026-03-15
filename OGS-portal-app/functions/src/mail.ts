/**
 * functions/src/mail.ts
 *
 * Thin nodemailer wrapper pre-configured for SendGrid SMTP.
 * Import `sendEmail` in handlers that need to send transactional email.
 */

import nodemailer from 'nodemailer'
import { SENDGRID_API_KEY, requireSecret } from './config'

export interface MailOptions {
  to:       string
  subject:  string
  html:     string
  from?:    string
  replyTo?: string
}

/**
 * Creates a nodemailer transporter authenticated with the SendGrid SMTP relay.
 * The transporter is created fresh each invocation so it always picks up the
 * latest secret value (important after secret rotation).
 */
function createTransporter() {
  const apiKey = requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')
  return nodemailer.createTransport({
    host:   'smtp.sendgrid.net',
    port:   587,
    secure: false, // STARTTLS
    auth:   { user: 'apikey', pass: apiKey },
  })
}

/** Send a single transactional email via SendGrid SMTP. */
export async function sendEmail(opts: MailOptions): Promise<void> {
  const transporter = createTransporter()
  await transporter.sendMail({
    from:    opts.from    ?? 'noreply@ogsportal.com',
    replyTo: opts.replyTo ?? 'support@ogsportal.com',
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
  })
}

// ── Template helpers ─────────────────────────────────────────────────────────

export function orderConfirmationHtml(params: {
  customerName: string
  orderNumber:  string
  gallons:      number
  scheduledAt:  string
}): string {
  return `
  <h2>Order Confirmed – OGS Portal</h2>
  <p>Hi ${params.customerName},</p>
  <p>Your gas delivery order <strong>#${params.orderNumber}</strong> has been confirmed.</p>
  <ul>
    <li><strong>Gallons:</strong> ${params.gallons}</li>
    <li><strong>Scheduled:</strong> ${params.scheduledAt}</li>
  </ul>
  <p>You will receive a notification when your driver is on the way.</p>
  <p>— The OGS Portal Team</p>
  `
}

export function lowLevelAlertHtml(params: {
  customerName: string
  tankSerial:   string
  levelPct:     number
}): string {
  return `
  <h2>Low Tank Level Alert – OGS Portal</h2>
  <p>Hi ${params.customerName},</p>
  <p>Tank <strong>${params.tankSerial}</strong> is at <strong>${params.levelPct}%</strong> capacity.</p>
  <p>Please <a href="https://app.ogsportal.com/portal/order">schedule a delivery</a> at your earliest convenience.</p>
  <p>— The OGS Portal Team</p>
  `
}

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
