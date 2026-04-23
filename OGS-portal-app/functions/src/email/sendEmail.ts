/**
 * functions/src/email/sendEmail.ts
 *
 * SendGrid transactional email helpers for OGS Portal.
 *
 * Two sending modes:
 *
 *  sendEmail(opts)
 *    Sends a raw HTML email.  This is the backwards-compatible path used by
 *    all existing callers (stripeWebhook, processAutopay, etc.).
 *    Sender: noreply@ohiogassupply.com
 *    Reply-to: support@ohiogassupply.com
 *
 *  sendTemplateEmail(to, templateId, dynamicData)
 *    Sends a SendGrid Dynamic Template email.  Use for all new email flows.
 *    Template subject lines are defined in the SendGrid dashboard.
 *
 * Both functions:
 *  - Require the SENDGRID_API_KEY secret (set at the function level)
 *  - Write a record to the Firestore `emailLogs` collection for audit / debug
 *  - Never re-throw on log write failure (email delivery is the primary goal)
 */

import sgMail from '@sendgrid/mail'
import { db, FieldValue } from '../admin'

const FROM_ADDRESS   = 'noreply@ohiogassupply.com'
const FROM_NAME      = 'Ohio Gas Supply'
const REPLY_TO       = 'support@ohiogassupply.com'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MailAttachment {
  /** Base64-encoded file content */
  content:  string
  filename: string
  type:     string
}

export interface MailOptions {
  to:           string
  subject:      string
  html:         string
  from?:        string
  replyTo?:     string
  attachments?: MailAttachment[]
}

// ── Internal: log to Firestore ─────────────────────────────────────────────────

async function logEmail(entry: {
  to:         string
  subject?:   string
  templateId?: string
  status:     'sent' | 'failed'
  error?:     string
}): Promise<void> {
  try {
    await db.collection('emailLogs').add({
      ...entry,
      sentAt:    FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    // Best-effort — never block email delivery on a log write failure
    console.warn('sendEmail: emailLogs write failed —', err)
  }
}

// ── Internal: initialise SDK ───────────────────────────────────────────────────

function initSg(): void {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey || apiKey === '') {
    throw new Error('SendGrid API key not configured.')
  }
  sgMail.setApiKey(apiKey)
}

// ── sendEmail — raw HTML (backwards-compatible) ────────────────────────────────

/**
 * Sends a transactional email using a raw HTML body.
 * Maintains API compatibility with the previous nodemailer-based implementation.
 */
export async function sendEmail(opts: MailOptions): Promise<void> {
  try {
    initSg()
  } catch (initErr) {
    const message = initErr instanceof Error ? initErr.message : String(initErr)
    console.error(`sendEmail: SDK initialization failed — ${message}`)
    await logEmail({ to: opts.to, subject: opts.subject, status: 'failed', error: message })
    throw initErr
  }

  const fromEmail = opts.from ?? FROM_ADDRESS
  console.log('Sending from:', fromEmail)

  const msg: Parameters<typeof sgMail.send>[0] = {
    to:      opts.to,
    from:    { email: fromEmail, name: FROM_NAME },
    replyTo: opts.replyTo ?? REPLY_TO,
    subject: opts.subject,
    html:    opts.html,
    ...(opts.attachments && opts.attachments.length > 0 ? { attachments: opts.attachments } : {}),
  }

  try {
    const result = await sgMail.send(msg)
    console.log('SendGrid send success:', JSON.stringify(result[0]?.statusCode))
    console.log(`[sendEmail] Successfully sent email to ${opts.to}`)
    await logEmail({ to: opts.to, subject: opts.subject, status: 'sent' })
  } catch (err: any) {
    const sendgridError = err?.response?.body ?? err?.message ?? err
    console.error('SendGrid send error:', sendgridError)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sendEmail] Failed to send to ${opts.to} — ${message}`)
    await logEmail({ to: opts.to, subject: opts.subject, status: 'failed', error: typeof sendgridError === 'string' ? sendgridError : JSON.stringify(sendgridError) })
    throw err
  }
}

// ── sendTemplateEmail — SendGrid Dynamic Templates ─────────────────────────────

/**
 * Sends a SendGrid Dynamic Template email.
 *
 * @param to           Recipient email address
 * @param templateId   SendGrid template ID (d-xxxx…) from templates.ts
 * @param dynamicData  Key/value pairs injected into the template via Handlebars
 *
 * @example
 *   await sendTemplateEmail('alice@example.com', TEMPLATE_PAYMENT_RECEIVED, {
 *     customerName:  'Alice Nguyen',
 *     amount:        '$284.00',
 *     invoiceNumber: 'INV-0042',
 *     receiptLink:   'https://app.ohiogassupply.com/portal/invoices/abc123/pay',
 *   })
 */
export async function sendTemplateEmail(
  to:          string,
  templateId:  string,
  dynamicData: Record<string, unknown>,
): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey || apiKey === '') {
    const message = 'SendGrid API key not configured.'
    console.error(`[sendTemplateEmail] ${message}`)
    await logEmail({ to, templateId, status: 'failed', error: message })
    throw new Error(message)
  }
  sgMail.setApiKey(apiKey)

  console.log('Sending from:', FROM_ADDRESS)

  const msg = {
    to,
    from:             { email: FROM_ADDRESS, name: FROM_NAME },
    replyTo:          REPLY_TO,
    templateId,
    dynamicTemplateData: dynamicData,
  }

  try {
    const result = await sgMail.send(msg)
    console.log('SendGrid send success:', JSON.stringify(result[0]?.statusCode))
    await logEmail({ to, templateId, status: 'sent' })
  } catch (err: any) {
    console.error('SendGrid send error:', err?.response?.body ?? err?.message ?? err)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`sendTemplateEmail [${templateId}]: failed to ${to} — ${message}`)
    await logEmail({ to, templateId, status: 'failed', error: message })
    throw err
  }
}
