import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Password reset redemption page. Reads ?token=... from the URL,
 * collects a new password + confirmation, POSTs to /auth/reset-password.
 * On success → redirect to /login with a flash so the user knows to sign
 * in with the new password.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [serverError, setServerError] = useState('');

  // If the URL is missing the token entirely we can't proceed — show a
  // helpful error rather than rendering the form.
  const missingToken = token.trim().length === 0;

  useEffect(() => {
    // Auto-bounce to /login a few seconds after success so the user sees the
    // confirmation briefly but isn't stuck on a dead-end page.
    if (!done) return;
    const t = setTimeout(() => navigate('/login'), 3500);
    return () => clearTimeout(t);
  }, [done, navigate]);

  const validatePassword = (value: string): boolean => {
    if (value.length < 8) { setPasswordError('Password must be at least 8 characters'); return false; }
    setPasswordError('');
    return true;
  };

  const validateConfirm = (value: string, pwd: string): boolean => {
    if (value !== pwd) { setConfirmError('Passwords do not match'); return false; }
    setConfirmError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok1 = validatePassword(password);
    const ok2 = validateConfirm(confirm, password);
    if (!ok1 || !ok2) return;
    setLoading(true);
    setServerError('');
    try {
      await authApi.resetPassword({ token, password });
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
      setServerError(msg ?? 'That reset link is invalid or has expired. Request a new one to continue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-white/10 mb-4">
            <span className="text-white font-bold text-xl">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Set a new password</h1>
          <p className="mt-1 text-brand-200 text-sm">Pick something strong — minimum 8 characters</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          {missingToken ? (
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-50">
                <ShieldAlert className="h-5 w-5 text-amber-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Link is incomplete</h2>
              <p className="text-sm text-gray-500">
                The reset link is missing its token. Request a new one to continue.
              </p>
              <Link to="/forgot-password" className="inline-block text-sm text-brand-600 hover:text-brand-700 font-medium">
                Request a new link
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-green-50">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Password updated</h2>
              <p className="text-sm text-gray-500">You'll be redirected to sign in with your new password…</p>
              <Link to="/login" className="inline-block text-sm text-brand-600 hover:text-brand-700 font-medium">
                Go to sign in now →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                id="password"
                label="New password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (passwordError) validatePassword(e.target.value); }}
                onBlur={() => validatePassword(password)}
                placeholder="••••••••"
                autoFocus
                required
                error={passwordError || undefined}
              />
              <Input
                id="confirm"
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); if (confirmError) validateConfirm(e.target.value, password); }}
                onBlur={() => validateConfirm(confirm, password)}
                placeholder="••••••••"
                required
                error={confirmError || serverError || undefined}
              />
              <Button type="submit" loading={loading} className="w-full" size="lg">
                Update password
              </Button>
              <div className="text-center">
                <Link to="/login" className="text-xs text-gray-500 hover:text-gray-700">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
