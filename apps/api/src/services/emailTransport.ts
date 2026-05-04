import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { getFirmEmailSettings, type FirmEmailSettings } from '../db/firmEmailSettings.js';

/**
 * Per-firm SMTP email send. Transport is created on demand (no pooling yet).
 *
 * Inbound (IMAP/POP3) polling will land in a separate module.
 *
 * Phase 22: platform-default SMTP fallback. If a firm has no FirmEmailSettings
 * row, we fall back to env-configured SMTP creds (SMTP_HOST/PORT/USER/PASS/FROM).
 * Pre-pilot accommodation until the per-firm SMTP UI lands (roadmap GA #4).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

type TransportFactory = (opts: TransportOptions) => Transporter;

let _testFactory: TransportFactory | null = null;

/** TEST HOOK: override nodemailer.createTransport for tests. Reset with null. */
export function __setTestTransportFactory(factory: TransportFactory | null): void {
  _testFactory = factory;
}

function makeTransport(settings: FirmEmailSettings): Transporter {
  const opts: TransportOptions = {
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: { user: settings.smtpUsername, pass: settings.smtpPassword },
  } as TransportOptions;
  if (_testFactory) return _testFactory(opts);
  return nodemailer.createTransport(opts);
}

/**
 * Build platform-default SMTP settings from environment variables.
 * Returns null if any required env var is missing.
 *
 * Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * Optional: SMTP_SECURE ("true"/"false"; defaults to true when port=465),
 *           SMTP_FROM_NAME (display name on the From header).
 */
export function platformDefaultEmailSettings(): FirmEmailSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM?.trim();
  if (!host || !portRaw || !user || !pass || !fromEmail) return null;
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) return null;
  const secure =
    process.env.SMTP_SECURE === 'true' ? true :
    process.env.SMTP_SECURE === 'false' ? false :
    port === 465;
  return {
    firmId: '__platform_default__',
    fromEmail,
    fromName: process.env.SMTP_FROM_NAME?.trim() || null,
    smtpHost: host,
    smtpPort: port,
    smtpSecure: secure,
    smtpUsername: user,
    smtpPassword: pass,
    inboundProtocol: 'NONE',
    inboundHost: null,
    inboundPort: null,
    inboundSecure: null,
    inboundUsername: null,
    inboundPassword: null,
    inboundFolder: null,
    testedAt: null,
    lastTestResult: null,
    createdAt: '__platform_default__',
    updatedAt: '__platform_default__',
  };
}

export async function sendEmailForFirm(firmId: string, input: SendEmailInput) {
  let settings = await getFirmEmailSettings(firmId);
  let usedFallback = false;
  if (!settings) {
    settings = platformDefaultEmailSettings();
    usedFallback = settings != null;
  }
  if (!settings) {
    throw new Error(
      `No email settings configured for firm ${firmId} and no platform-default SMTP env vars set (SMTP_HOST/PORT/USER/PASS/FROM)`,
    );
  }
  if (usedFallback) {
    // Single-line breadcrumb so ops can confirm fallback is engaged.
    console.warn(
      `[emailTransport] firm ${firmId} has no FirmEmailSettings; using platform-default SMTP`,
    );
  }

  const transport = makeTransport(settings);
  const from = settings.fromName
    ? { name: settings.fromName, address: settings.fromEmail }
    : settings.fromEmail;

  return transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
    headers: input.headers,
  });
}

/**
 * Verify SMTP credentials without sending a message. Used by the "Test connection"
 * endpoint in firm settings. Returns { ok, error? }.
 */
export async function testFirmSmtpConnection(settings: {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const opts: TransportOptions = {
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: { user: settings.smtpUsername, pass: settings.smtpPassword },
  } as TransportOptions;
  const transport = _testFactory ? _testFactory(opts) : nodemailer.createTransport(opts);
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
