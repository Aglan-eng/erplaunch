import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('consultant@test.ofoq.app');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);

  const validateEmail = (value: string) => {
    if (!value) { setEmailError('Email is required'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setEmailError('Please enter a valid email'); return false; }
    setEmailError('');
    return true;
  };

  const validatePassword = (value: string) => {
    if (!value) { setPasswordError('Password is required'); return false; }
    if (value.length < 6) { setPasswordError('Password must be at least 6 characters'); return false; }
    setPasswordError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailValid = validateEmail(email);
    const passwordValid = validatePassword(password);
    if (!emailValid || !passwordValid) return;

    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch {
      setError('Invalid email or password');
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
          <h1 className="text-2xl font-bold text-white">ERPLaunch</h1>
          <p className="mt-1 text-brand-200 text-sm">AI-native implementation platform</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <GoogleSignInButton />
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (emailError) validateEmail(e.target.value); }}
              onBlur={() => validateEmail(email)}
              placeholder="consultant@firm.com"
              required
              error={emailError || undefined}
            />
            <Input
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (passwordError) validatePassword(e.target.value); }}
              onBlur={() => validatePassword(password)}
              placeholder="••••••••"
              required
              error={passwordError || error || undefined}
            />
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign in
            </Button>

            <div className="text-right">
              <Link to="/forgot-password" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                Forgot your password?
              </Link>
            </div>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            New to ERPLaunch?{' '}
            <Link to="/signup" className="text-brand-600 hover:text-brand-700 font-medium">
              Create a firm
            </Link>
          </p>

          {import.meta.env.DEV && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Demo: consultant@test.ofoq.app / password123
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

