/**
 * functions/src/inquiries.ts
 *
 * submitWelcomeInquiry — public callable backing the contact form on the
 * /welcome landing page. No authentication required (the page is public).
 *
 * Sends an email notification to johna.charles@ohiogassupply.com via the
 * existing Resend-backed mail helper (see ./email/sendEmail.ts), and keeps a
 * copy in the `welcomeInquiries` Firestore collection for follow-up/records.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, FieldValue } from './admin'
import { sendEmail } from './email/sendEmail'

const INQUIRY_RECIPIENT = 'johna.charles@ohiogassupply.com'

interface WelcomeInquiryInput {
  name:    string
  email:   string
  company?: string
  phone?:   string
  message: string
  /** Honeypot field — real visitors never fill this in; bots often do. */
  website?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const submitWelcomeInquiry = onCall(async (request) => {
  const data = request.data as Partial<WelcomeInquiryInput>

  // Honeypot tripped — pretend success, do nothing further.
  if (data.website) {
    return { success: true }
  }

  const name    = (data.name ?? '').trim()
  const email   = (data.email ?? '').trim()
  const company = (data.company ?? '').trim()
  const phone   = (data.phone ?? '').trim()
  const message = (data.message ?? '').trim()

  if (!name || !email || !message) {
    throw new HttpsError('invalid-argument', 'Name, email, and message are required.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.')
  }
  if (message.length > 4000) {
    throw new HttpsError('invalid-argument', 'Message is too long.')
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.6">
      <h2 style="margin:0 0 16px">New inquiry — app.ohiogassupply.com/welcome</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;font-weight:600;width:110px">Name</td><td style="padding:6px 0">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600">Email</td><td style="padding:6px 0">${escapeHtml(email)}</td></tr>
        ${company ? `<tr><td style="padding:6px 0;font-weight:600">Company</td><td style="padding:6px 0">${escapeHtml(company)}</td></tr>` : ''}
        ${phone ? `<tr><td style="padding:6px 0;font-weight:600">Phone</td><td style="padding:6px 0">${escapeHtml(phone)}</td></tr>` : ''}
      </table>
      <p style="margin:18px 0 6px;font-weight:600">Message</p>
      <p style="white-space:pre-wrap;margin:0">${escapeHtml(message)}</p>
    </div>
  `

  try {
    await sendEmail({
      to:      INQUIRY_RECIPIENT,
      subject: `New inquiry from ${name} — OGS Welcome Page`,
      html,
      replyTo: email,
    })
  } catch (err) {
    console.error('[submitWelcomeInquiry] email send failed —', err)
    throw new HttpsError('internal', 'Could not send your message right now. Please try again shortly.')
  }

  // Best-effort record — never block the response on a Firestore write failure.
  try {
    await db.collection('welcomeInquiries').add({
      name,
      email,
      company: company || null,
      phone:   phone || null,
      message,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.warn('[submitWelcomeInquiry] welcomeInquiries write failed —', err)
  }

  return { success: true }
})
