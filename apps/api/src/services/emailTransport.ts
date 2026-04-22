import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { getFirmEmailSettings, type FirmEmailSettings } from '../db/firmEmailSettings.js';

/**
 * Per-firm SMTP email send. Transport is created on demand (no pooling yet).
 *
 * Inbound (IMAP/POP3) polling will land in a separate module.
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

export async function sendEmailForFirm(firmId: string, input: SendEmailInput) {
  const settings = await getFirmEmailSettings(firmId);
  if (!settings) {
    throw new Error(`No email settings configured for firm ${firmId}`);
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
