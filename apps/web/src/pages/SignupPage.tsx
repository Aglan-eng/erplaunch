import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';

/**
 * Self-serve firm signup. Creates a Firm + an admin User in one request
 * and auto-signs in on success. Email is not verified in pilot scope
 * (see ADR 0002-portal-auth-model for why we accept the tradeoff).
 */
export function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [firmName, setFirmName] = useState('');
  const [firmSlug, setFirmSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function slugifyFirmName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function onFirmNameChange(v: string) {
    setFirmName(v);
    if (!slugTouched) setFirmSlug(slugifyFirmName(v));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (firmName.trim().length < 2) errs.firmName = 'Firm name must be at least 2 characters.';
    if (!/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(firmSlug)) {
      errs.firmSlug = 'Lowercase letters, numbers, and single dashes. 3-40 chars.';
    }
    if (adminName.trim().length < 2) errs.adminName = 'Your name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errs.adminEmail = 'Enter a valid email.';
    if (password.length < 8) errs.password = 'Password must be at least 8 characters.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setError('');
    setLoading(true);
    try {
      await register({ firmName: firmName.trim(), firmSlug, adminName: adminName.trim(), adminEmail, password });
      navigate('/inbox');
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { error?: { code?: string; message?: string } } } }).response;
      const code = r?.data?.error?.code;
      if (r?.status === 409 && code === 'SLUG_TAKEN') {
        setFieldErrors({ firmSlug: 'That slug is taken. Try a different one.' });
      } else if (r?.status === 409 && code === 'EMAIL_TAKEN') {
        setFieldErrors({ adminEmail: 'An account with that email already exists. Try signing in instead.' });
      } else if (r?.status === 400 && code === 'SLUG_RESERVED') {
        setFieldErrors({ firmSlug: 'That slug is reserved. Pick another.' });
      } else if (r?.status === 429) {
        setError('Too many signup attempts. Wait a minute and try again.');
      } else if (r?.status === 400) {
        setError(r?.data?.error?.message ?? 'Please check the fields above.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-white/10 mb-4">
            <span className="text-white font-bold text-xl">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Create your firm</h1>
          <p className="mt-1 text-brand-200 text-sm">
            Two minutes. No credit card. You'll be signed in and ready to run your first engagement.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <GoogleSignInButton label="Sign up with Google" dividerLabel="or sign up with email" />
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Input
              id="firmName"
              label="Firm name"
              value={firmName}
              onChange={(e) => onFirmNameChange(e.target.value)}
              placeholder="Acme Advisory"
              required
              error={fieldErrors.firmName}
            />
            <div>
              <Input
                id="firmSlug"
                label="Firm slug"
                value={firmSlug}
                onChange={(e) => { setFirmSlug(e.target.value.toLowerCase()); setSlugTouched(true); }}
                placeholder="acme-advisory"
                required
                error={fieldErrors.firmSlug}
              />
              <p className="mt-1 text-xs text-gray-400">
                Lowercase, dashes only. Used in URLs and API identifiers.
              </p>
            </div>
            <Input
              id="adminName"
              label="Your name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Jordan Chen"
              required
              error={fieldErrors.adminName}
            />
            <Input
              id="adminEmail"
              label="Work email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="jordan@acme.example"
              required
              error={fieldErrors.adminEmail}
            />
            <Input
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              error={fieldErrors.password}
            />

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Create firm and sign in
            </Button>

            <p className="text-[11px] text-gray-400 text-center">
              By creating a firm you agree to use ERPLaunch on pilot terms —
              stable enough for one engagement, not SLA-backed yet.
            </p>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              Already have a firm?{' '}
              <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
