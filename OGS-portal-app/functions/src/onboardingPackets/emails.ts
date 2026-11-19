/**
 * functions/src/onboardingPackets/emails.ts
 *
 * HTML email bodies for the onboarding packet flow.
 */

export const APP_ORIGIN = 'https://app.ohiogassupply.com'

export function packetUrl(token: string): string {
  return `${APP_ORIGIN}/onboard/${token}`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function shell(inner: string): string {
  return `
  <div style="background:#f4f4f5;padding:24px 0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;">
      <div style="background:#0a0a0a;padding:18px 28px;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.2px;">
        Ohio Gas Supply
      </div>
      <div style="padding:28px;color:#18181b;font-size:14px;line-height:1.6;">
        ${inner}
      </div>
    </div>
  </div>`
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${href}" style="background:#FF6B1A;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">${label}</a></p>`
}

function messageHtml(message: string): string {
  return escapeHtml(message.trim()).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')
}

export function packetInviteEmail(opts: {
  personalMessage: string
  url: string
  expiresAt: Date
  repName: string
  isReminder?: boolean
}): string {
  const expires = opts.expiresAt.toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'long' })
  return shell(`
    ${opts.isReminder ? '<p style="color:#71717a;font-size:13px;margin-top:0;">Friendly reminder — your account setup documents are still waiting for your signature.</p>' : ''}
    <p>${messageHtml(opts.personalMessage)}</p>
    ${button(opts.url, 'Review &amp; sign documents')}
    <p style="margin:0 0 6px;font-weight:600;">Included in your onboarding packet:</p>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li>Product Supply Agreement</li>
      <li>ACH / Credit Card Payment Authorization — product deliveries are billed upon delivery; monthly rentals are billed on the 1st of each month in arrears.</li>
      <li>W-9 — attached for your records</li>
    </ul>
    <p style="font-size:13px;color:#71717a;">Everything is completed and signed online — no printing or scanning. This secure link is unique to you and expires on ${expires}. Please don't forward it.</p>
    <p style="font-size:13px;color:#71717a;">Questions? Just reply to this email${opts.repName ? ` or contact ${escapeHtml(opts.repName)}` : ''}.</p>
  `)
}

export function customerSignedEmail(opts: { signerName: string; joinUrl: string | null }): string {
  return shell(`
    <p>Hi ${escapeHtml(opts.signerName.split(' ')[0] || 'there')},</p>
    <p>Thanks — we've received your signed onboarding documents. Copies of your Product Supply Agreement and Payment Authorization are attached for your records. You'll receive the fully executed agreement once Ohio Gas Supply countersigns.</p>
    ${opts.joinUrl ? `<p>Next, set up your customer portal login so you can place orders, track deliveries and view invoices:</p>${button(opts.joinUrl, 'Create your portal account')}` : ''}
    <p>We'll be in touch shortly to confirm your site visit and first delivery.</p>
  `)
}

export function internalSignedEmail(opts: {
  customerName: string
  signerName: string
  signerTitle: string
  paymentMethod: 'ach' | 'card'
  cageChoice: string
  siteVisitNotes: string
  recordUrl: string
}): string {
  return shell(`
    <p><strong>${escapeHtml(opts.customerName)}</strong> completed their onboarding packet.</p>
    <table style="font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:3px 16px 3px 0;color:#71717a;">Signed by</td><td>${escapeHtml(opts.signerName)}, ${escapeHtml(opts.signerTitle)}</td></tr>
      <tr><td style="padding:3px 16px 3px 0;color:#71717a;">Payment method</td><td>${opts.paymentMethod === 'ach' ? 'ACH bank debit' : 'Credit card (send QuickBooks payment link)'}</td></tr>
      <tr><td style="padding:3px 16px 3px 0;color:#71717a;">Cage</td><td>${escapeHtml(opts.cageChoice)}</td></tr>
      ${opts.siteVisitNotes ? `<tr><td style="padding:3px 16px 3px 0;color:#71717a;vertical-align:top;">Site visit</td><td>${escapeHtml(opts.siteVisitNotes)}</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;"><strong>To do:</strong> countersign the agreement${opts.paymentMethod === 'ach' ? ' and enter the bank details in QuickBooks' : ''}.</p>
    ${button(opts.recordUrl, 'Open customer record')}
  `)
}

export function countersignedEmail(opts: { signerName: string }): string {
  return shell(`
    <p>Hi ${escapeHtml(opts.signerName.split(' ')[0] || 'there')},</p>
    <p>Your Product Supply Agreement with Ohio Gas Supply is now fully executed. The signed copy is attached for your records.</p>
    <p>Welcome aboard — we look forward to working with you.</p>
  `)
}
