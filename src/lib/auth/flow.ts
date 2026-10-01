import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthApi = Pick<SupabaseClient['auth'], 'signInWithPassword' | 'signInWithOtp' | 'verifyOtp' | 'signInWithOAuth' | 'exchangeCodeForSession' | 'getUser' | 'updateUser' | 'resetPasswordForEmail' | 'signOut'>;

export class AuthFlowError extends Error {}

/** Never allow user-controlled return locations to leave this origin. */
export function safeReturnPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return fallback;
  let decoded = value;
  try {
    for (let i = 0; i < 3; i++) {
      if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback;
    const url = new URL(value, 'https://visaflow.invalid');
    if (url.origin !== 'https://visaflow.invalid') return fallback;
    if (/^\/(?:auth|login|signup|reset-password)(?:\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function callbackUrl(origin: string, next: string | null, recovery = false): string {
  const base = new URL(origin);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new AuthFlowError('Sign in requires a secure connection.');
  }
  const url = new URL('/auth/callback', base.origin);
  url.searchParams.set('next', safeReturnPath(next));
  if (recovery) url.searchParams.set('recovery', '1');
  return url.toString();
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthFlowError) return error.message;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit'].includes(code)) return 'Too many attempts. Wait a minute and try again.';
  if (code === 'captcha_failed') return 'Complete the security check and try again.';
  if (['otp_expired', 'otp_disabled'].includes(code)) return 'That code is invalid or expired. Request a new code.';
  if (code === 'weak_password') return 'Choose a stronger, unique password with at least 12 characters.';
  if (code === 'same_password') return 'Choose a password you have not used for this account.';
  if (code === 'email_not_confirmed') return 'Verify your email before logging in.';
  return 'We could not complete that request. Check your details and try again.';
}

export function normalizeEmail(value: string): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthFlowError('Enter a valid email address.');
  return email;
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) throw new AuthFlowError('Use a password between 12 and 128 characters.');
}

export async function login(api: AuthApi, email: string, password: string, captchaToken?: string) {
  const { data, error } = await api.signInWithPassword({ email: normalizeEmail(email), password, options: { captchaToken } });
  if (error) throw error;
  if (!data.session || !data.user) throw new AuthFlowError('Login did not create a session. Try again.');
  return data.user;
}

export async function requestSignupCode(api: AuthApi, email: string, captchaToken?: string) {
  const { error } = await api.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: true, captchaToken } });
  if (error) throw error;
}

export async function verifySignupCode(api: AuthApi, email: string, token: string) {
  if (!/^\d{6}$/.test(token)) throw new AuthFlowError('Enter the six-digit code from your email.');
  const { data, error } = await api.verifyOtp({ email: normalizeEmail(email), token, type: 'email' });
  if (error) throw error;
  if (!data.session || !data.user?.email_confirmed_at) throw new AuthFlowError('Email verification did not complete. Request a new code.');
  return data.user;
}

export async function finishSignup(api: AuthApi, password: string) {
  validatePassword(password);
  const { data: current, error: currentError } = await api.getUser();
  if (currentError || !current.user?.email_confirmed_at) throw new AuthFlowError('Verify your email before completing your account.');
  // The database creates the public pseudonym. Metadata is not a profile write API.
  const { data, error } = await api.updateUser({ password });
  if (error) throw error;
  if (!data.user) throw new AuthFlowError('Your account could not be completed. Try again.');
  return data.user;
}

export async function googleLogin(api: AuthApi, origin: string, next: string | null) {
  const { error } = await api.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(origin, next) } });
  if (error) throw error;
}

export async function exchangeCallback(api: AuthApi, url: URL): Promise<string> {
  if (url.searchParams.has('error')) throw new AuthFlowError('Sign in was cancelled or unsuccessful. Try again.');
  const code = url.searchParams.get('code');
  if (!code || code.length > 2048) throw new AuthFlowError('This sign-in link is missing or expired. Start again.');
  const { data, error } = await api.exchangeCodeForSession(code);
  if (error || !data.session || !data.user) throw new AuthFlowError('This sign-in link is invalid or expired. Start again in this browser.');
  return url.searchParams.get('recovery') === '1' ? '/reset-password?update=1' : safeReturnPath(url.searchParams.get('next'));
}

export async function requestPasswordReset(api: AuthApi, email: string, origin: string, captchaToken?: string) {
  const { error } = await api.resetPasswordForEmail(normalizeEmail(email), { redirectTo: callbackUrl(origin, '/', true), captchaToken });
  if (error) throw error;
}

export async function updatePassword(api: AuthApi, password: string) {
  validatePassword(password);
  const { data: current, error: currentError } = await api.getUser();
  if (currentError || !current.user) throw new AuthFlowError('Your session expired. Request another password reset email.');
  const { data, error } = await api.updateUser({ password });
  if (error) throw error;
  if (!data.user) throw new AuthFlowError('Your password was not changed. Try again.');
}

export async function logout(api: AuthApi) {
  const { error } = await api.signOut({ scope: 'local' });
  if (error) throw new AuthFlowError('Log out could not finish. Try again.');
}
