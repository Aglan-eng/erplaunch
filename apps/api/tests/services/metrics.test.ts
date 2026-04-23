import { describe, it, expect, beforeEach } from 'vitest';
import { incrementCounter, renderMetrics, __resetMetricsForTests } from '../../src/services/metrics.js';

beforeEach(() => {
  __resetMetricsForTests();
});

describe('metrics: incrementCounter + renderMetrics', () => {
  it('emits a zero default for every registered counter when nothing has been observed', () => {
    const out = renderMetrics();
    // Every counter appears with zero even without any incrementCounter calls.
    expect(out).toContain('http_requests_total 0');
    expect(out).toContain('auth_login_total 0');
    expect(out).toContain('auth_password_reset_requested_total 0');
    expect(out).toContain('auth_email_verification_completed_total 0');
  });

  it('emits HELP and TYPE lines in Prometheus text format', () => {
    const out = renderMetrics();
    // Basic compliance with prometheus exposition format
    expect(out).toMatch(/^# HELP http_requests_total /m);
    expect(out).toMatch(/^# TYPE http_requests_total counter$/m);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('aggregates unlabeled increments into a single line', () => {
    incrementCounter('auth_password_reset_completed_total');
    incrementCounter('auth_password_reset_completed_total');
    incrementCounter('auth_password_reset_completed_total');
    const out = renderMetrics();
    expect(out).toContain('auth_password_reset_completed_total 3');
  });

  it('keeps labeled series independent', () => {
    incrementCounter('auth_login_total', { outcome: 'ok' });
    incrementCounter('auth_login_total', { outcome: 'ok' });
    incrementCounter('auth_login_total', { outcome: 'invalid' });
    const out = renderMetrics();
    expect(out).toContain('auth_login_total{outcome="ok"} 2');
    expect(out).toContain('auth_login_total{outcome="invalid"} 1');
  });

  it('sorts label keys deterministically so two call sites with the same labels collapse', () => {
    incrementCounter('http_requests_total', { method: 'GET', status_class: '2xx' });
    // Same logical labels, different JS-literal key order — should collapse.
    incrementCounter('http_requests_total', { status_class: '2xx', method: 'GET' });
    const out = renderMetrics();
    // Only one line for this (method, status_class) combination.
    const matches = out.match(/http_requests_total\{method="GET",status_class="2xx"\} 2/);
    expect(matches).not.toBeNull();
  });

  it('escapes special characters in label values', () => {
    incrementCounter('http_requests_total', { method: 'GET', status_class: 'weird"quote' });
    const out = renderMetrics();
    expect(out).toContain('status_class="weird\\"quote"');
  });
});
