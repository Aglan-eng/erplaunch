import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ExternalLink, Check, Copy, AlertTriangle, ShieldCheck } from 'lucide-react';

/**
 * Phase 41.4 — Settings → Email Domain.
 *
 * Pairs with the EmailVerificationBanner's "domain not verified" CTA.
 * Walks the firm admin through the Resend setup so transactional
 * emails (verification, password resets, portal invites) actually
 * land instead of getting silently 403'd to the Resend dashboard.
 *
 * The DNS records below are the canonical Resend pattern (TXT for
 * domain verification + DKIM CNAMEs + an SPF include). Each row has
 * a copy button so the admin can paste them straight into their DNS
 * provider without retyping. We don't pre-render real DKIM selectors
 * — those come from Resend's per-domain provisioning — so the values
 * are placeholders the admin replaces with the values from their
 * resend.com/domains page.
 *
 * No backend hookup yet: this page is purely informational. Once the
 * Resend "domain verification status" API is wired through, we'll
 * surface the live status (pending / verified / failed) here too.
 */

interface DnsRecord {
  type: 'TXT' | 'CNAME' | 'MX';
  hostHint: string;
  value: string;
  purpose: string;
}

const RESEND_RECORDS: DnsRecord[] = [
  {
    type: 'TXT',
    hostHint: '@ (root) or send.<your-domain>',
    value: 'resend-verify=<token from resend.com/domains>',
    purpose: 'Proves you own the domain. Resend rejects sends until this resolves.',
  },
  {
    type: 'CNAME',
    hostHint: 'resend._domainkey.<your-domain>',
    value: 'resend._domainkey.resend.com',
    purpose: 'DKIM — signs your messages so receiving servers trust them.',
  },
  {
    type: 'TXT',
    hostHint: '@ (root)',
    value: 'v=spf1 include:amazonses.com ~all',
    purpose: 'SPF — declares Resend (via SES) as an authorised sender for this domain.',
  },
  {
    type: 'TXT',
    hostHint: '_dmarc.<your-domain>',
    value: 'v=DMARC1; p=none; rua=mailto:dmarc-reports@<your-domain>',
    purpose: 'DMARC — alignment policy. Start with p=none, tighten to p=quarantine after a clean week.',
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // Older browsers / non-https contexts fall through silently;
          // the value is still visible for the admin to copy manually.
        }
      }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 transition-colors flex-shrink-0"
      data-testid="email-domain-copy"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}

export function EmailDomainPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link to="/settings" className="text-sm text-slate-500 hover:text-slate-700">
            ← Settings
          </Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1 flex items-center gap-2">
            <Mail className="h-5 w-5 text-brand-600" />
            Email Domain
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Verify your firm's domain so portal invites, password resets, and verification emails actually reach your clients.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Why this matters */}
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-amber-900">
                Why your verification email isn't sending
              </h2>
              <p className="text-xs text-amber-800/90 mt-1 leading-relaxed">
                ERPLaunch sends transactional email through Resend. On a free Resend account,
                outbound delivery is restricted to the account-owner's address until your firm's
                domain is verified — every other recipient gets silently rejected with a 403.
                Adding the four DNS records below lifts the restriction within ~30 minutes.
              </p>
            </div>
          </div>
        </section>

        {/* Step-by-step */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Step by step</h2>
          <ol className="space-y-3 text-sm text-slate-700 list-decimal list-inside marker:text-slate-400">
            <li>
              Sign in to{' '}
              <a
                href="https://resend.com/domains"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2 inline-flex items-center gap-0.5"
              >
                resend.com/domains
                <ExternalLink className="h-3 w-3" />
              </a>{' '}
              and click <strong>Add Domain</strong>.
            </li>
            <li>
              Enter your firm's email domain (e.g. <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">acme.com</code>) and copy the per-domain
              <strong> verification token</strong> + <strong>DKIM selector</strong> Resend gives you.
            </li>
            <li>
              In your DNS provider (Cloudflare / Route 53 / GoDaddy / wherever your zone lives), add the four records below. Replace the placeholder
              tokens with the real values from Resend.
            </li>
            <li>
              Wait ~30 minutes for DNS to propagate, then click <strong>Verify</strong> on the Resend
              domain page. Once it flips to green, the next email ERPLaunch sends from this firm
              will actually go out.
            </li>
          </ol>
        </section>

        {/* DNS records */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">DNS records</h2>
          <p className="text-xs text-slate-500 mb-4">
            Each row goes in your DNS zone exactly as written. The host column shows the typical
            placement; some DNS providers want the full FQDN, others just the subdomain — match
            whichever convention your provider uses.
          </p>
          <div className="space-y-3">
            {RESEND_RECORDS.map((r, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                data-testid={`email-domain-record-${r.type.toLowerCase()}-${i}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 flex-shrink-0">
                    {r.type}
                  </span>
                  <p className="text-xs text-slate-600 flex-1 leading-relaxed">{r.purpose}</p>
                </div>
                <div className="grid grid-cols-[80px_1fr_auto] gap-2 text-xs items-center">
                  <span className="text-slate-500 font-semibold">Host</span>
                  <code className="bg-white border border-slate-200 rounded px-2 py-1 font-mono text-[11px] truncate">
                    {r.hostHint}
                  </code>
                  <CopyButton value={r.hostHint} />

                  <span className="text-slate-500 font-semibold">Value</span>
                  <code className="bg-white border border-slate-200 rounded px-2 py-1 font-mono text-[11px] truncate">
                    {r.value}
                  </code>
                  <CopyButton value={r.value} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sanity check */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Once it's verified
          </h2>
          <ul className="space-y-1.5 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span>Email verification, password reset, and portal invite flows go to any recipient.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span>Outbound mail is signed with DKIM and authorised by SPF — Gmail / Outlook stop flagging it as suspicious.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span>The amber banner on your dashboard goes away on the next page load.</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
