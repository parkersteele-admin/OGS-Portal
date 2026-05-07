/**
 * functions/src/email/sendEmail.ts
 *
 * Resend transactional email helpers for OGS Portal.
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
 *    Sends a templated transactional email via Resend.
 *    Preserves the existing API so current callers require no changes.
 *
 * Both functions:
 *  - Require the RESEND_API_KEY secret (set at the function level)
 *  - Write a record to the Firestore `emailLogs` collection for audit / debug
 *  - Never re-throw on log write failure (email delivery is the primary goal)
 */

import { Resend } from 'resend'
import { db, FieldValue } from '../admin'

const FROM_ADDRESS   = 'noreply@ohiogassupply.com'
const FROM_NAME      = 'Ohio Gas Supply'
const REPLY_TO       = 'support@ohiogassupply.com'
let resendClient: Resend | null = null

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

function getResendClient(): Resend {
  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('Resend API key not configured.')
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey)
  }

  return resendClient
}

function formatFromAddress(email: string): string {
  return `${FROM_NAME} <${email}>`
}

function renderTemplateFallbackHtml(templateId: string, dynamicData: Record<string, unknown>): string {
  const rows = Object.entries(dynamicData)
    .map(([key, value]) => `<tr><td style="padding:6px 0;font-weight:600">${key}</td><td style="padding:6px 0">${String(value)}</td></tr>`)
    .join('')

  return `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222;line-height:1.5">
  <h2 style="margin:0 0 12px">${FROM_NAME}</h2>
  <p style="margin:0 0 18px">Template event: <strong>${templateId}</strong></p>
  <table style="width:100%;border-collapse:collapse">${rows}</table>
</div>`
}

function subjectForTemplate(templateId: string): string {
  if (templateId.includes('ORDER_CONFIRMATION')) return 'Order confirmed - OGS Portal'
  if (templateId.includes('DELIVERY_CONFIRMATION')) return 'Your gas was delivered - OGS Portal'
  if (templateId.includes('INVOICE_ISSUED')) return 'Invoice from Ohio Gas Supply'
  if (templateId.includes('PAYMENT_RECEIVED')) return 'Payment received - OGS Portal'
  if (templateId.includes('PAYMENT_FAILED')) return 'Payment issue - action required'
  if (templateId.includes('LOW_TANK_ALERT')) return 'Low tank alert - Ohio Gas Supply'
  return 'Ohio Gas Supply notification'
}

// ── sendEmail — raw HTML (backwards-compatible) ────────────────────────────────

/**
 * Sends a transactional email using a raw HTML body.
 * Maintains API compatibility with the previous nodemailer-based implementation.
 */
export async function sendEmail(opts: MailOptions): Promise<void> {
  let client: Resend
  try {
    client = getResendClient()
  } catch (initErr) {
    const message = initErr instanceof Error ? initErr.message : String(initErr)
    console.error(`sendEmail: SDK initialization failed — ${message}`)
    await logEmail({ to: opts.to, subject: opts.subject, status: 'failed', error: message })
    throw initErr
  }

  const fromEmail = opts.from ?? FROM_ADDRESS
  console.log('Sending from:', fromEmail)

  try {
    const { data, error } = await client.emails.send({
      to: opts.to,
      from: formatFromAddress(fromEmail),
      replyTo: opts.replyTo ?? REPLY_TO,
      subject: opts.subject,
      html: opts.html,
      ...(opts.attachments && opts.attachments.length > 0
        ? {
            attachments: opts.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.type,
            })),
          }
        : {}),
    })

    if (error) {
      throw new Error(typeof error.message === 'string' ? error.message : JSON.stringify(error))
    }

    console.log('Resend send success:', JSON.stringify(data?.id ?? data))
    console.log(`[sendEmail] Successfully sent email to ${opts.to}`)
    await logEmail({ to: opts.to, subject: opts.subject, status: 'sent' })
  } catch (err: any) {
    const resendError = err?.response?.body ?? err?.message ?? err
    console.error('Resend send error:', resendError)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sendEmail] Failed to send to ${opts.to} — ${message}`)
    await logEmail({ to: opts.to, subject: opts.subject, status: 'failed', error: typeof resendError === 'string' ? resendError : JSON.stringify(resendError) })
    throw err
  }
}

// ── sendTemplateEmail — Resend-backed template shim ───────────────────────────

/**
 * Sends a templated transactional email.
 *
 * @param to           Recipient email address
 * @param templateId   Template identifier from templates.ts
 * @param dynamicData  Key/value pairs injected into fallback HTML body
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
  let client: Resend
  try {
    client = getResendClient()
  } catch (initErr) {
    const message = initErr instanceof Error ? initErr.message : String(initErr)
    console.error(`[sendTemplateEmail] ${message}`)
    await logEmail({ to, templateId, status: 'failed', error: message })
    throw initErr
  }

  console.log('Sending from:', FROM_ADDRESS)
  const subject = subjectForTemplate(templateId)
  const html = renderTemplateFallbackHtml(templateId, dynamicData)

  try {
    const { data, error } = await client.emails.send({
      to,
      from: formatFromAddress(FROM_ADDRESS),
      replyTo: REPLY_TO,
      subject,
      html,
    })

    if (error) {
      throw new Error(typeof error.message === 'string' ? error.message : JSON.stringify(error))
    }

    console.log('Resend send success:', JSON.stringify(data?.id ?? data))
    await logEmail({ to, templateId, status: 'sent' })
  } catch (err: any) {
    console.error('Resend send error:', err?.response?.body ?? err?.message ?? err)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`sendTemplateEmail [${templateId}]: failed to ${to} — ${message}`)
    await logEmail({ to, templateId, status: 'failed', error: message })
    throw err
  }
}
