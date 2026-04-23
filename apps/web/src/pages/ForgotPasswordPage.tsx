import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Forgot-password entry. Always shows the same success state regardless of
 * whether the email maps to an existing account — matches the enumeration-
 * safe /auth/request-reset response on the server. The UI tells the user
 * "if that address is on file, a link has been sent" rather than "email
 * not found," so an attacker can't probe for registered addresses.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const validateEmail = (value: string): boolean => {
    if (!value) { setEmailError('Email is required'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setEmailError('Please enter a valid email'); return false; }
    setEmailError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) return;
    setLoading(true);
    setServerError('');
    try {
      await authApi.requestReset(email.trim());
      setSubmitted(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
      setServerError(msg ?? 'Something went wrong. Please try again in a moment.');
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
          <h1 className="text-2xl font-bold text-white">Reset your password</h1>
          <p className="mt-1 text-brand-200 text-sm">We'll email you a reset link</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          {submitted ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-green-50">
                <Mail className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Check your inbox</h2>
                <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                  If <span className="font-medium text-gray-700">{email}</span> is on file, a password reset link is on its way. The link expires in 60 minutes.
                </p>
              </div>
              <p className="text-xs text-gray-400">
                Didn't receive it? Check your spam folder, or try again in a minute.
              </p>
              <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) validateEmail(e.target.value); }}
                onBlur={() => validateEmail(email)}
                placeholder="you@firm.com"
                autoFocus
                required
                error={emailError || serverError || undefined}
              />
              <Button type="submit" loading={loading} className="w-full" size="lg">
                Send reset link
              </Button>
              <div className="text-center">
                <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
                  <ArrowLeft className="h-3 w-3" />
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
