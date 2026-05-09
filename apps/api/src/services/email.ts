/**
 * Email service — uses Resend REST API if RESEND_API_KEY is set,
 * otherwise logs to console (dev-friendly fallback).
 *
 * To enable real email delivery:
 *   1. Sign up at https://resend.com (free tier: 100 emails/day)
 *   2. Add RESEND_API_KEY=re_xxxx to your .env
 *   3. Optionally set EMAIL_FROM=noreply@yourdomain.com
 *
 * Phase 41.4 — surface unverified-domain failures as a structured
 * error so the route layer can return a code the SPA recognises and
 * render the "Visit Settings → Email Domain" prompt. Without this
 * the Resend free-tier restriction (only sends to the account-owner
 * email until DNS is verified) was completely silent and signups
 * for new firms looked like they'd worked when they hadn't.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_FROM     = process.env.EMAIL_FROM ?? 'OFOQ Accelerator <onboarding@resend.dev>';
const APP_URL        = process.env.APP_URL ?? 'http://localhost:5173';

export type EmailSendErrorCode =
  | 'DOMAIN_NOT_VERIFIED'
  | 'INVALID_RECIPIENT'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR';

export class EmailSendError extends Error {
  constructor(
    public readonly code: EmailSendErrorCode,
    message: string,
    public readonly status?: number,
    public readonly providerBody?: string,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/**
 * Translate a Resend 4xx body into a structured EmailSendError. The
 * pattern-matching is deliberately tolerant — Resend's free-tier
 * 403 message has shifted between "You can only send testing emails…"
 * and "domain is not verified" over time, so we look for both.
 */
function classifyResendFailure(status: number, body: string): EmailSendError {
  const lower = body.toLowerCase();
  if (
    status === 403 &&
    (lower.includes('domain') || lower.includes('only send testing emails') || lower.includes('verify your domain'))
  ) {
    return new EmailSendError(
      'DOMAIN_NOT_VERIFIED',
      "Resend rejected the send because the firm's email domain hasn't been verified yet.",
      status,
      body,
    );
  }
  if (status === 422 || (status === 400 && lower.includes('email'))) {
    return new EmailSendError(
      'INVALID_RECIPIENT',
      'Resend rejected the recipient address.',
      status,
      body,
    );
  }
  if (status === 429) {
    return new EmailSendError(
      'RATE_LIMITED',
      'Resend rate-limited the send.',
      status,
      body,
    );
  }
  return new EmailSendError(
    'PROVIDER_ERROR',
    `Resend API error ${status}: ${body}`,
    status,
    body,
  );
}

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) {
    // Dev fallback — print to console
    console.log('\n──────────────────────────────────────────────');
    console.log('[EMAIL] To:', payload.to);
    console.log('[EMAIL] Subject:', payload.subject);
    // Strip HTML tags for readable console output
    const text = payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('[EMAIL] Body (stripped):', text.substring(0, 300));
    console.log('──────────────────────────────────────────────\n');
    return;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw classifyResendFailure(resp.status, body);
  }
}

// Internal — exposed for unit tests so we can pin the 403 → DOMAIN_NOT_VERIFIED
// classification without reaching for the network.
export const __testing = { classifyResendFailure };

// ─── Templates ────────────────────────────────────────────────────────────────

export interface InviteEmailData {
  memberName: string;
  memberRole: string;
  clientName: string;
  portalUrl: string;
  customMessage?: string;
}

export async function sendPortalInvite(to: string, data: InviteEmailData): Promise<void> {
  const { memberName, memberRole, clientName, portalUrl, customMessage } = data;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; }
    .accent { height: 4px; background: linear-gradient(90deg, #6366f1, #818cf8, #60a5fa); }
    .header { padding: 32px 36px 24px; }
    .logo { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; font-weight: 900; font-size: 16px; margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; color: #111827; }
    .subtitle { margin: 0; font-size: 14px; color: #6b7280; }
    .body { padding: 0 36px 28px; }
    .greeting { font-size: 14px; color: #374151; margin-bottom: 16px; }
    .callout { background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
    .callout p { margin: 0 0 6px; font-size: 13px; color: #5b21b6; }
    .callout .project { font-size: 16px; font-weight: 800; color: #4c1d95; margin: 0; }
    .btn { display: block; width: fit-content; margin: 24px auto; padding: 13px 32px; background: #4f46e5; color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; }
    .tip { font-size: 12px; color: #9ca3af; text-align: center; margin-bottom: 8px; }
    .link-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; font-family: monospace; font-size: 11px; color: #6b7280; word-break: break-all; text-align: center; }
    .custom-msg { background: #fafafa; border-left: 3px solid #818cf8; border-radius: 0 8px 8px 0; padding: 14px 18px; margin: 16px 0; font-size: 13px; color: #4b5563; font-style: italic; }
    .footer { padding: 20px 36px; border-top: 1px solid #f3f4f6; background: #f9fafb; }
    .footer p { margin: 0; font-size: 11px; color: #9ca3af; text-align: center; }
    .features { margin: 20px 0; display: grid; gap: 10px; }
    .feature { display: flex; align-items: flex-start; gap: 10px; }
    .feature-icon { flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px; background: #ede9fe; display: flex; align-items: center; justify-content: center; font-size: 13px; }
    .feature-text { font-size: 13px; color: #374151; }
    .feature-text strong { display: block; font-weight: 600; color: #111827; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="accent"></div>
    <div class="header">
      <div class="logo">O</div>
      <h1>Your project portal is ready</h1>
      <p class="subtitle">NetSuite Implementation — Client Portal Access</p>
    </div>
    <div class="body">
      <p class="greeting">Hi <strong>${memberName}</strong> (${memberRole}),</p>
      <p class="greeting">You have been invited to access the project portal for your NetSuite implementation. This is your personalised link to stay up to date with all project activity.</p>

      <div class="callout">
        <p>You're invited to:</p>
        <p class="project">${clientName}</p>
      </div>

      ${customMessage ? `<div class="custom-msg">${customMessage}</div>` : ''}

      <div class="features">
        <div class="feature">
          <div class="feature-icon">📊</div>
          <div class="feature-text"><strong>Project Progress</strong>Track stage, timeline, and milestones</div>
        </div>
        <div class="feature">
          <div class="feature-icon">📋</div>
          <div class="feature-text"><strong>Action Items & Todos</strong>See what's needed from your team</div>
        </div>
        <div class="feature">
          <div class="feature-icon">📁</div>
          <div class="feature-text"><strong>Data Collection</strong>Upload required documents and files</div>
        </div>
        <div class="feature">
          <div class="feature-icon">⚠️</div>
          <div class="feature-text"><strong>Risks & Issues</strong>Stay informed on project health</div>
        </div>
      </div>

      <a class="btn" href="${portalUrl}">Open My Project Portal →</a>

      <p class="tip">Or copy this link into your browser:</p>
      <div class="link-box">${portalUrl}</div>
    </div>
    <div class="footer">
      <p>This link is unique to you — please do not share it. Powered by <strong>OFOQ Accelerator</strong>.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await sendEmail({
    to,
    subject: `You're invited to the ${clientName} project portal`,
    html,
  });
}

// ─── Password reset email (Phase 16) ─────────────────────────────────────────

export interface PasswordResetEmailData {
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
  ipHint?: string; // e.g. "a 197.xx.xx.xx address" — optional audit hint
}

export async function sendPasswordResetEmail(to: string, data: PasswordResetEmailData): Promise<void> {
  const { userName, resetUrl, expiresInMinutes, ipHint } = data;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; }
    .accent { height: 4px; background: linear-gradient(90deg, #6366f1, #818cf8, #60a5fa); }
    .header { padding: 32px 36px 20px; }
    .logo { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; font-weight: 900; font-size: 16px; margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; color: #111827; }
    .subtitle { margin: 0; font-size: 14px; color: #6b7280; }
    .body { padding: 0 36px 28px; font-size: 14px; color: #374151; line-height: 1.55; }
    .btn { display: inline-block; margin: 20px 0; padding: 12px 22px; background: #4f46e5; color: #fff !important; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700; }
    .link-box { margin-top: 6px; padding: 10px 12px; background: #f3f4f6; border-radius: 8px; font-size: 12px; color: #374151; word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .meta { margin-top: 22px; padding: 12px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; font-size: 12px; color: #92400e; }
    .footer { padding: 16px 36px 28px; font-size: 12px; color: #9ca3af; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="accent"></div>
    <div class="header">
      <div class="logo">E</div>
      <h1>Reset your ERPLaunch password</h1>
      <p class="subtitle">We received a request to reset the password on your account.</p>
    </div>
    <div class="body">
      <p>Hi ${escapeHtml(userName)},</p>
      <p>Click the button below to set a new password. The link is valid for <strong>${expiresInMinutes} minutes</strong> and can be used only once.</p>
      <p><a class="btn" href="${resetUrl}">Reset password →</a></p>
      <p style="font-size: 12px; color: #6b7280;">Or paste this into your browser:</p>
      <div class="link-box">${resetUrl}</div>
      <div class="meta">
        If you didn't request this, you can safely ignore the email — your password stays unchanged${ipHint ? ` (request originated from ${escapeHtml(ipHint)})` : ''}.
      </div>
    </div>
    <div class="footer">
      Sent by ERPLaunch. Never share this link — anyone who has it can set a new password on your account.
    </div>
  </div>
</body>
</html>`.trim();

  await sendEmail({
    to,
    subject: 'Reset your ERPLaunch password',
    html,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ─── Email verification email (Phase 19) ─────────────────────────────────────

export interface EmailVerificationEmailData {
  userName: string;
  verifyUrl: string;
  expiresInHours: number;
}

export async function sendEmailVerificationEmail(to: string, data: EmailVerificationEmailData): Promise<void> {
  const { userName, verifyUrl, expiresInHours } = data;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; }
    .accent { height: 4px; background: linear-gradient(90deg, #10b981, #34d399, #6ee7b7); }
    .header { padding: 32px 36px 20px; }
    .logo { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-weight: 900; font-size: 16px; margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; color: #111827; }
    .subtitle { margin: 0; font-size: 14px; color: #6b7280; }
    .body { padding: 0 36px 28px; font-size: 14px; color: #374151; line-height: 1.55; }
    .btn { display: inline-block; margin: 20px 0; padding: 12px 22px; background: #10b981; color: #fff !important; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700; }
    .link-box { margin-top: 6px; padding: 10px 12px; background: #f3f4f6; border-radius: 8px; font-size: 12px; color: #374151; word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .footer { padding: 16px 36px 28px; font-size: 12px; color: #9ca3af; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="accent"></div>
    <div class="header">
      <div class="logo">E</div>
      <h1>Verify your ERPLaunch email</h1>
      <p class="subtitle">One click and you're set.</p>
    </div>
    <div class="body">
      <p>Hi ${escapeHtml(userName)},</p>
      <p>Please confirm this is your email so we can deliver portal invites, reset links, and project updates reliably. The link expires in <strong>${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}</strong>.</p>
      <p><a class="btn" href="${verifyUrl}">Verify my email →</a></p>
      <p style="font-size: 12px; color: #6b7280;">Or paste this into your browser:</p>
      <div class="link-box">${verifyUrl}</div>
    </div>
    <div class="footer">
      Didn't create an ERPLaunch account? You can safely ignore this email — no verification will happen without the link above.
    </div>
  </div>
</body>
</html>`.trim();

  await sendEmail({
    to,
    subject: 'Verify your ERPLaunch email',
    html,
  });
}

// ─── Closeout handoff notification (Phase 45.3) ──────────────────────────────

export interface CloseoutHandoffEmailData {
  /** Recipient's display name — used in the greeting. */
  recipientName: string;
  /** Client / engagement name — appears in subject + body. */
  clientName: string;
  /** Direct deep-link to the auto-created HANDOFF thread so the
   *  recipient can jump straight in. */
  threadUrl: string;
}

/**
 * Notify a SUPPORT_LEAD (firm-level) or ACCOUNT_MANAGER (engagement-level)
 * that an engagement just entered CLOSEOUT and that the handoff package
 * is being prepared. Plain, transactional template — this is an internal
 * notification, not a marketing email.
 */
export async function sendCloseoutHandoffEmail(
  to: string,
  data: CloseoutHandoffEmailData,
): Promise<void> {
  const { recipientName, clientName, threadUrl } = data;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; }
    .accent { height: 4px; background: linear-gradient(90deg, #10b981, #34d399); }
    .header { padding: 28px 32px 16px; }
    .label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #059669; text-transform: uppercase; margin-bottom: 6px; }
    h1 { margin: 0; font-size: 19px; font-weight: 800; color: #111827; line-height: 1.35; }
    .body { padding: 0 32px 24px; font-size: 14px; color: #374151; line-height: 1.6; }
    .callout { margin: 18px 0; padding: 14px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; font-size: 13px; color: #065f46; }
    .btn { display: inline-block; margin: 16px 0 4px; padding: 11px 22px; background: #059669; color: #fff !important; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700; }
    .footer { padding: 14px 32px 22px; font-size: 12px; color: #9ca3af; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="accent"></div>
    <div class="header">
      <p class="label">Closeout handoff</p>
      <h1>${escapeHtml(clientName)} entered Closeout</h1>
    </div>
    <div class="body">
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>The implementation team has just moved <strong>${escapeHtml(clientName)}</strong> into Closeout. The handoff package is being prepared and a cross-team thread has been opened so you can coordinate the transition.</p>
      <div class="callout">
        Once the handoff package finishes generating, please review the System Catalog, AAI Map / Account Mapping, Integrations runbooks, Support Escalation Matrix, SLA Terms, Production Readiness checklist, and Knowledge Transfer slides — then accept the handover when you're ready.
      </div>
      <a class="btn" href="${threadUrl}">Open Handoff thread →</a>
    </div>
    <div class="footer">
      You're receiving this because you hold a role (SUPPORT_LEAD or ACCOUNT_MANAGER) that is responsible for SLA continuity on this engagement.
    </div>
  </div>
</body>
</html>`.trim();

  await sendEmail({
    to,
    subject: `Handoff: ${clientName} entered Closeout`,
    html,
  });
}

// ─── Discovery Lite completion notification (Phase 46.8.2) ──────────────────

export interface DiscoveryLiteCompletedEmailData {
  recipientName: string;
  clientName: string;
  engagementId: string;
}

/**
 * Notify the assigned sales rep (or SALES_MANAGER fallback) that the
 * prospect's contact submitted Discovery Lite via the self-serve
 * portal link. Plain transactional template — internal email,
 * not marketing.
 */
export async function sendDiscoveryLiteCompletedEmail(
  to: string,
  data: DiscoveryLiteCompletedEmailData,
): Promise<void> {
  const { recipientName, clientName, engagementId } = data;
  const link = `${APP_URL}/sales/prospects/${engagementId}/discovery-lite`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="height:4px;background:linear-gradient(90deg,#7c3aed,#a78bfa,#c4b5fd);"></div>
    <div style="padding:28px 32px 16px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6d28d9;text-transform:uppercase;margin:0 0 6px;">Discovery Lite</p>
      <h1 style="margin:0;font-size:19px;font-weight:800;color:#111827;line-height:1.35;">${escapeHtml(clientName)} just submitted their Discovery Lite</h1>
    </div>
    <div style="padding:0 32px 24px;font-size:14px;color:#374151;line-height:1.6;">
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>The prospect's contact filled out the self-serve Discovery Lite questionnaire for <strong>${escapeHtml(clientName)}</strong>. Their answers are ready for you to review and use as the basis for the proposal.</p>
      <a href="${link}" style="display:inline-block;margin:16px 0 4px;padding:11px 22px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">Review answers →</a>
    </div>
    <div style="padding:14px 32px 22px;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;">
      You're receiving this because you're the assigned sales rep on this prospect.
    </div>
  </div>
</body></html>`.trim();

  await sendEmail({
    to,
    subject: `Discovery Lite submitted: ${clientName}`,
    html,
  });
}

export { APP_URL };
