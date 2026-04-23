/**
 * Minimal in-process metrics registry (Phase 20).
 *
 * Keeps the dependency surface tiny — we don't need prom-client for the
 * pilot's single Render instance. All counters live in a Map keyed by
 * (name + sorted-label-string) and expose Prometheus's text exposition
 * format via renderMetrics(). When we grow to >1 process we'll swap
 * this module for prom-client + push gateway; the public API
 * (incrementCounter, renderMetrics) stays the same.
 *
 * NOT thread-safe across processes. Each replica has its own counters.
 */
export type CounterLabels = Record<string, string>;

interface CounterDef {
  name: string;
  help: string;
}

const COUNTER_DEFS: Record<string, CounterDef> = {
  http_requests_total: {
    name: 'http_requests_total',
    help: 'Count of HTTP requests by method and status class (2xx / 4xx / 5xx).',
  },
  auth_login_total: {
    name: 'auth_login_total',
    help: 'Consultant sign-in attempts, labeled outcome=ok|invalid|rate_limited.',
  },
  auth_register_total: {
    name: 'auth_register_total',
    help: 'New firm registrations, labeled outcome=ok|conflict|rate_limited.',
  },
  auth_password_reset_requested_total: {
    name: 'auth_password_reset_requested_total',
    help: 'POST /auth/request-reset attempts — one increment per call, regardless of whether the email is registered.',
  },
  auth_password_reset_completed_total: {
    name: 'auth_password_reset_completed_total',
    help: 'Successful password rotations via the reset link (token redeemed).',
  },
  auth_password_changed_total: {
    name: 'auth_password_changed_total',
    help: 'In-session password rotations via the Settings change-password flow.',
  },
  auth_email_verification_requested_total: {
    name: 'auth_email_verification_requested_total',
    help: 'POST /auth/request-email-verification (resend) calls, labeled outcome=ok|already_verified|rate_limited|unauth.',
  },
  auth_email_verification_completed_total: {
    name: 'auth_email_verification_completed_total',
    help: 'Successful email verifications (token redeemed, User.emailVerifiedAt flipped).',
  },
};

// Store: metricName -> labelKey -> count
const counters: Map<string, Map<string, number>> = new Map();

function labelKey(labels: CounterLabels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}="${escapeLabelValue(labels[k] ?? '')}"`).join(',');
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function incrementCounter(name: keyof typeof COUNTER_DEFS, labels: CounterLabels = {}, by = 1): void {
  const key = labelKey(labels);
  let byLabel = counters.get(name);
  if (!byLabel) {
    byLabel = new Map();
    counters.set(name, byLabel);
  }
  byLabel.set(key, (byLabel.get(key) ?? 0) + by);
}

/** Prometheus text exposition format.
 *  https://prometheus.io/docs/instrumenting/exposition_formats/ */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const def of Object.values(COUNTER_DEFS)) {
    lines.push(`# HELP ${def.name} ${def.help}`);
    lines.push(`# TYPE ${def.name} counter`);
    const byLabel = counters.get(def.name);
    if (!byLabel || byLabel.size === 0) {
      // Print a zero default so scrapers can see the metric exists even
      // before it has any observations.
      lines.push(`${def.name} 0`);
      continue;
    }
    for (const [key, value] of byLabel.entries()) {
      lines.push(key ? `${def.name}{${key}} ${value}` : `${def.name} ${value}`);
    }
  }
  // Trailing newline — some scrapers are strict about this.
  return `${lines.join('\n')}\n`;
}

/** Test-only helper: wipe counters between tests. Not exported from index. */
export function __resetMetricsForTests(): void {
  counters.clear();
}
