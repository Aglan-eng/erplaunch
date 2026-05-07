/**
 * Phase 41.4 — coverage for the Resend failure classifier.
 *
 * The classifier maps the raw Resend HTTP error to a structured
 * EmailSendError code. Pinned here so a future Resend message wording
 * change doesn't silently fall through to the generic PROVIDER_ERROR
 * branch and break the Settings → Email Domain CTA in the SPA.
 */
import { describe, it, expect } from 'vitest';
import { __testing, EmailSendError } from '../src/services/email.js';

const { classifyResendFailure } = __testing;

describe('classifyResendFailure', () => {
  it('classifies the free-tier "only send testing emails" 403 as DOMAIN_NOT_VERIFIED', () => {
    const err = classifyResendFailure(
      403,
      'You can only send testing emails to your own email address (admin@adnodes.com).',
    );
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.code).toBe('DOMAIN_NOT_VERIFIED');
  });

  it('classifies a 403 mentioning "verify your domain" as DOMAIN_NOT_VERIFIED', () => {
    const err = classifyResendFailure(403, 'Please verify your domain before sending production traffic.');
    expect(err.code).toBe('DOMAIN_NOT_VERIFIED');
  });

  it('classifies a 422 as INVALID_RECIPIENT', () => {
    const err = classifyResendFailure(422, 'invalid `to` email address');
    expect(err.code).toBe('INVALID_RECIPIENT');
  });

  it('classifies a 400 mentioning email as INVALID_RECIPIENT', () => {
    const err = classifyResendFailure(400, 'email field is required');
    expect(err.code).toBe('INVALID_RECIPIENT');
  });

  it('classifies a 429 as RATE_LIMITED', () => {
    const err = classifyResendFailure(429, 'too many requests');
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('falls through to PROVIDER_ERROR for unrecognised failures', () => {
    const err = classifyResendFailure(500, 'internal server error');
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.message).toContain('500');
  });

  it('preserves the status + body on the error for telemetry', () => {
    const err = classifyResendFailure(403, "domain isn't verified");
    expect(err.status).toBe(403);
    expect(err.providerBody).toContain('verified');
  });
});
