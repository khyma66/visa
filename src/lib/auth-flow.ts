import type { SupabaseClient } from '@supabase/supabase-js';

export type SocialProvider = 'google';
export type AuthMethods = { google: boolean; phone: boolean };
export type SignupNames = { firstName: string; lastName?: string };
export type AuthErrorContext = {
  action?: 'request-code' | 'verify-code' | 'password' | 'oauth' | 'sign-out';
  createAccount?: boolean;
  channel?: 'email' | 'phone';
};

export function safeAuthNext(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\s%\u0000-\u001f\u007f]/.test(value)) return '/';
  const normalized = new URL(value, 'https://visaflow.invalid');
  if (normalized.origin !== 'https://visaflow.invalid' || /^\/(login|signup|account\/recovery)([/?#]|$)/.test(normalized.pathname)) return '/';
  return normalized.pathname + normalized.search + normalized.hash;
}

export function authCallbackUrl(origin: string, next: string | null): string {
  const url = new URL('/login', origin);
  url.searchParams.set('auth', 'callback');
  url.searchParams.set('next', safeAuthNext(next));
  return url.toString();
}

export function authErrorMessage(reason: unknown, context: AuthErrorContext = {}): string {
  const error = reason as { code?: string; status?: number } | null;
  const requestFailure = context.createAccount
    ? 'We couldn’t send your verification code. Check your details and try again. Already a member? Choose Log in.'
    : 'We couldn’t send a sign-in code. Check your details. New to VisaThreads? Choose Create account first.';
  if (error?.code === 'policy_required') return 'Please review the policies and confirm your eligibility first.';
  if (error?.status === 429 || ['over_email_send_rate_limit', 'over_sms_send_rate_limit', 'over_request_rate_limit'].includes(error?.code ?? '')) return 'Too many attempts. Please wait a few minutes before trying again.';
  if (error?.code === 'otp_disabled') return 'Code sign-in is not available right now. Try another sign-in option.';
  if (error?.code === 'otp_expired') return context.action === 'request-code' ? requestFailure : 'That code has expired or could not be verified. Use the latest code, or request a new one.';
  if (error?.code === 'invalid_code') return 'Enter the 6–10 digit sign-in code.';
  if (error?.code === 'invalid_phone') return 'Enter a valid phone number with country code, like +15551234567.';
  if (error?.code === 'phone_provider_disabled') return 'Phone code sign-in is not available yet. Please use email.';
  if (error?.code === 'provider_disabled') return 'This sign-in option is not available yet. Please use email.';
  if (['invalid_email', 'email_address_invalid'].includes(error?.code ?? '')) return 'Enter a valid email address.';
  if (error?.code === 'invalid_first_name') return 'Enter your first name, starting with a letter and using up to 80 characters. Email addresses are not accepted here.';
  if (error?.code === 'invalid_last_name') return 'Use up to 80 characters for your last name, or leave it blank.';
  // Auth can intentionally hide whether an account exists. Do not turn a failed
  // request into an account lookup or claim that an unsent code was incorrect.
  if (['invalid_credentials', 'user_not_found', 'user_already_exists', 'email_exists', 'phone_exists'].includes(error?.code ?? '')) {
    if (context.action === 'request-code') return requestFailure;
    if (context.action === 'verify-code') return 'We couldn’t verify that code. Check the contact details and enter the latest code, or request a new one.';
    return 'We couldn’t sign you in with those details. Try again or use an email code. New here? Choose Create account.';
  }
  if (error?.code === 'signup_disabled') return context.action === 'request-code' && !context.createAccount
    ? requestFailure
    : 'New account registration is not available right now. Existing members can log in.';
  if (error?.code === 'email_provider_disabled') return 'Email sign-in is not available right now. Try another sign-in option.';
  if (error?.code === 'sms_send_failed') return 'Your text message could not be sent. Check the phone number or use email instead.';
  if (error?.code === 'email_address_not_authorized') return 'Email delivery is not available for this address right now. Try another sign-in option.';
  if (error?.code === 'email_not_confirmed') return 'Verify your email before signing in.';
  if (['weak_password', 'invalid_password'].includes(error?.code ?? '')) return 'Use a unique password between 12 and 128 characters.';
  if (['captcha_failed', 'captcha_required'].includes(error?.code ?? '')) return 'Complete the security check and try again.';
  if (context.action === 'request-code') return context.channel === 'phone'
    ? 'Your text message could not be sent. Check your connection and try again.'
    : 'Your verification email could not be sent. Check your connection and try again.';
  if (context.action === 'verify-code') return 'We couldn’t finish verifying your code. Check your connection and try again.';
  if (context.action === 'sign-out') return 'We couldn’t sign you out. Check your connection and try again.';
  return 'We couldn’t complete sign-in. Check your connection and try again.';
}

function signupNameData(names?: SignupNames) {
  const first_name = (names?.firstName ?? '').trim().normalize('NFC');
  const last_name = (names?.lastName ?? '').trim().normalize('NFC');
  if (!/^\p{L}/u.test(first_name) || first_name.includes('@') || [...first_name].length > 80 || /[\u0000-\u001f\u007f]/.test(first_name)) throw { code: 'invalid_first_name' };
  if ([...last_name].length > 80 || /[\u0000-\u001f\u007f]/.test(last_name)) throw { code: 'invalid_last_name' };
  return { first_name, last_name };
}

export async function requestEmailCode(client: SupabaseClient, email: string, redirectTo: string, createAccount = false, names?: SignupNames, captchaToken?: string) {
  // Full names stay in private auth metadata. Public profiles expose only the
  // server-derived avatar initial, and login never rewrites name metadata.
  const data = createAccount ? signupNameData(names) : undefined;
  const { error } = await client.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: createAccount, emailRedirectTo: redirectTo, ...(data ? { data } : {}), ...authCaptchaOptions(captchaToken) } });
  if (error) throw error;
}

export async function verifyEmailCode(client: SupabaseClient, email: string, token: string, captchaToken?: string) {
  if (!/^\d{6,10}$/.test(token.trim())) throw { code: 'invalid_code' };
  const captcha = authCaptchaOptions(captchaToken);
  const { data, error } = await client.auth.verifyOtp({ email: normalizeEmail(email), token: token.trim(), type: 'email', ...(captcha.captchaToken ? { options: captcha } : {}) });
  if (error) throw error;
  if (!data.session) throw new Error('Session missing');
}

export async function requestPhoneCode(client: SupabaseClient, phone: string, methods: AuthMethods, createAccount = false, captchaToken?: string) {
  if (!methods.phone) throw { code: 'phone_provider_disabled' };
  const { error } = await client.auth.signInWithOtp({ phone: normalizePhone(phone), options: { shouldCreateUser: createAccount, ...authCaptchaOptions(captchaToken) } });
  if (error) throw error;
}

export async function verifyPhoneCode(client: SupabaseClient, phone: string, token: string, captchaToken?: string) {
  if (!/^\d{6,10}$/.test(token.trim())) throw { code: 'invalid_code' };
  const captcha = authCaptchaOptions(captchaToken);
  const { data, error } = await client.auth.verifyOtp({ phone: normalizePhone(phone), token: token.trim(), type: 'sms', ...(captcha.captchaToken ? { options: captcha } : {}) });
  if (error) throw error;
  if (!data.session) throw new Error('Session missing');
}

export async function startSocialSignIn(client: SupabaseClient, provider: SocialProvider, methods: AuthMethods, redirectTo: string) {
  if (provider !== 'google' || !methods[provider]) throw { code: 'provider_disabled' };
  const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo, queryParams: { prompt: 'select_account' } } });
  if (error) throw error;
}

export function normalizeEmail(value: string): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw { code: 'invalid_email' };
  return email;
}

export function normalizePhone(value: string): string {
  const phone = value.trim().replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw { code: 'invalid_phone' };
  return phone;
}

export async function signInWithPassword(client: SupabaseClient, email: string, password: string, captchaToken?: string) {
  const { data, error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password, options: authCaptchaOptions(captchaToken) });
  if (error) throw error;
  if (!data.session) throw new Error('Session missing');
}

export async function setVerifiedPassword(client: SupabaseClient, password: string) {
  if (password.length < 12 || password.length > 128) throw { code: 'invalid_password' };
  // Verify against the auth server, not a client-edited session or metadata.
  const { data: current, error: currentError } = await client.auth.getUser();
  if (currentError || !current.user?.email_confirmed_at) throw { code: 'email_not_confirmed' };
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  if (!data.user) throw new Error('User missing');
}

/** Client-side completeness check only; Supabase must enforce CAPTCHA server-side. */
export function authCaptchaOptions(token?: string): { captchaToken?: string } {
  const value = token?.trim();
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && !value) throw { code: 'captcha_required' };
  if (value && (value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value))) throw { code: 'captcha_failed' };
  return value ? { captchaToken: value } : {};
}

export async function requestPasswordRecovery(client: SupabaseClient, email: string, redirectTo: string, captchaToken?: string) {
  const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo, ...authCaptchaOptions(captchaToken) });
  if (error) throw error;
}
