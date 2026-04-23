import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface FirmBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}

/**
 * Firm Settings — Branding slice (Phase 5A / Day 3).
 *
 * Two colors + logo URL + display name + support email. Deliberately
 * minimal: no theme editor, no typography options, no dark-mode toggle.
 * Logo uploads arrive in Day 4; for now a URL input is sufficient.
 */
export function SettingsPage() {
  const [branding, setBranding] = useState<FirmBranding | null>(null);
  const [form, setForm] = useState<{
    displayName: string;
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    supportEmail: string;
  }>({
    displayName: '',
    logoUrl: '',
    primaryColor: '#4f46e5',
    secondaryColor: '#818cf8',
    supportEmail: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/firm/branding');
      const b: FirmBranding = data.data;
      setBranding(b);
      setForm({
        displayName: b.displayName ?? '',
        logoUrl: b.logoUrl ?? '',
        primaryColor: b.primaryColor,
        secondaryColor: b.secondaryColor,
        supportEmail: b.supportEmail ?? '',
      });
    } catch {
      setError('Could not load branding.');
    } finally {
      setLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch('/firm/branding', {
        displayName: form.displayName.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        supportEmail: form.supportEmail.trim() || null,
      });
      setBranding(data.data);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 400) setError('One of the fields is invalid. Colors must be 6-digit hex (e.g. #4f46e5).');
      else setError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <Link to="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">← Dashboard</Link>
            <h1 className="text-xl font-semibold text-slate-900 mt-1">Firm Settings</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 grid lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-slate-900">Branding</h2>
              <p className="text-sm text-slate-500 mt-1">
                Your clients see this on their portal, not ours. Keep it brief.
              </p>
            </div>

            <form onSubmit={save} className="space-y-5">
              <Field label="Display name" hint="Shown in the portal header and outbound emails.">
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Acme Advisory"
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </Field>

              <Field label="Logo URL" hint="Paste a public URL for now. File upload ships next.">
                <input
                  type="url"
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                  placeholder="https://cdn.example.com/logo.png"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Primary color">
                  <ColorInput
                    value={form.primaryColor}
                    onChange={(v) => setForm({ ...form, primaryColor: v })}
                  />
                </Field>
                <Field label="Secondary color">
                  <ColorInput
                    value={form.secondaryColor}
                    onChange={(v) => setForm({ ...form, secondaryColor: v })}
                  />
                </Field>
              </div>

              <Field label="Support email" hint="Shown to clients who need help signing in.">
                <input
                  type="email"
                  value={form.supportEmail}
                  onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                  placeholder="support@acme.example"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </Field>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  {error && <span className="text-rose-600">{error}</span>}
                  {!error && savedAt && <>Saved at {savedAt}</>}
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-brand-600 text-white text-sm font-medium px-5 py-2 hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sticky top-6">
            <h3 className="text-xs font-semibold text-slate-500 tracking-wide uppercase mb-3">
              Portal preview
            </h3>
            <PortalHeaderPreview
              displayName={form.displayName || branding?.displayName || 'Your Firm'}
              logoUrl={form.logoUrl || branding?.logoUrl || null}
              primaryColor={form.primaryColor}
              secondaryColor={form.secondaryColor}
              supportEmail={form.supportEmail || branding?.supportEmail || null}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-10 rounded-lg border border-slate-300 cursor-pointer bg-white"
        aria-label="Color picker"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={7}
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        placeholder="#4f46e5"
      />
    </div>
  );
}

function PortalHeaderPreview({
  displayName,
  logoUrl,
  primaryColor,
  secondaryColor,
  supportEmail,
}: {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}) {
  const gradient = `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`;
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <div
        className="h-20 flex items-center px-4 gap-3"
        style={{ background: gradient }}
      >
        {logoUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={logoUrl}
            className="h-8 w-8 rounded-lg bg-white/30 ring-1 ring-white/40 object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-white/30 ring-1 ring-white/40 flex items-center justify-center text-white font-bold">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-white font-semibold text-sm drop-shadow-sm truncate">{displayName}</span>
      </div>
      <div className="p-4 bg-white text-xs text-slate-600 space-y-1.5">
        <p className="font-medium text-slate-900">Hi Alex,</p>
        <p>Welcome to your project portal.</p>
        {supportEmail && (
          <p className="text-slate-400 text-[11px]">
            Questions? Email <a href={`mailto:${supportEmail}`} style={{ color: primaryColor }} className="underline">{supportEmail}</a>
          </p>
        )}
      </div>
    </div>
  );
}
