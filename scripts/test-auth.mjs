import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/auth-flow.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const flow = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('auth return destinations cannot redirect offsite or back into login', () => {
  for (const value of [null, '', '//evil.example', '/\\evil.example', 'https://evil.example', '/%2fevil.example', '/\nevil.example', '/login', '/login?next=/', '/account/recovery']) assert.equal(flow.safeAuthNext(value), '/');
  for (const value of ['/messages', '/ask', '/questions/123', '/?tag=h1b']) assert.equal(flow.safeAuthNext(value), value);
  const callback = new URL(flow.authCallbackUrl('https://visaflow.example', '//evil.example'));
  assert.equal(callback.origin, 'https://visaflow.example');
  assert.equal(callback.pathname, '/login');
  assert.equal(callback.searchParams.get('auth'), 'callback');
  assert.equal(callback.searchParams.get('next'), '/');
});

test('email request and verification use passwordless APIs with no password', async () => {
  const calls = [];
  const client = { auth: {
    signInWithOtp: async args => { calls.push(args); return { error: null }; },
    verifyOtp: async args => { calls.push(args); return { data: { session: { user: {} } }, error: null }; },
  } };
  await flow.requestEmailCode(client, ' test@example.invalid ', 'https://visaflow.example/login');
  assert.deepEqual(calls[0], { email: 'test@example.invalid', options: { shouldCreateUser: false, emailRedirectTo: 'https://visaflow.example/login' } });
  await flow.verifyEmailCode(client, ' test@example.invalid ', ' 123456 ');
  assert.deepEqual(calls[1], { email: 'test@example.invalid', token: '123456', type: 'email' });
  for (const code of ['', '12345', '12345678901', 'abcdef']) await assert.rejects(() => flow.verifyEmailCode(client, 'test@example.invalid', code), e => e.code === 'invalid_code');
  assert.equal(calls.length, 2);
  await assert.rejects(() => flow.verifyEmailCode({ auth: { verifyOtp: async () => ({ data: { session: null }, error: null }) } }, 'a@b.invalid', '123456'), /Session missing/);
});

test('legacy email-code signup requires private first and last names', async () => {
  const calls=[];
  const client={auth:{signInWithOtp:async input=>{calls.push(input);return {error:null};}}};
  await flow.requestEmailCode(client,'new@example.invalid','https://visathreads.com/login',true,{firstName:'  Ada  ',lastName:'  Lovelace  ',role:'admin'});
  assert.deepEqual(calls[0],{
    email:'new@example.invalid',
    options:{shouldCreateUser:true,emailRedirectTo:'https://visathreads.com/login',data:{first_name:'Ada',last_name:'Lovelace'}},
  });
  await flow.requestEmailCode(client,'new@example.invalid','https://visathreads.com/login',true,{firstName:'  李  ',lastName:'  王  '});
  assert.deepEqual(calls[1].options.data,{first_name:'李',last_name:'王'});
  await flow.requestEmailCode(client,'existing@example.invalid','https://visathreads.com/login',false,{firstName:'Unrelated',lastName:'Name'});
  assert.equal(calls[2].options.shouldCreateUser,false);
  assert(!Object.hasOwn(calls[2].options,'data'),'Signing in must not update a member’s private name');
  for(const firstName of ['Anne-Marie','O’Connor','Mary Jane','محمد','E\u0301lodie']) {
    await flow.requestEmailCode(client,'new@example.invalid','https://visathreads.com/login',true,{firstName,lastName:'Tester'});
    assert.equal(calls.at(-1).options.data.first_name,firstName.normalize('NFC'));
  }
});

test('email signup validates names before any network request without applying name requirements to login', async () => {
  let calls=0;
  const client={auth:{signInWithOtp:async()=>{calls++;return {error:null};}}};
  for(const names of [undefined,{firstName:''},{firstName:'   '},{firstName:'123'},{firstName:'123John'},{firstName:'alice@example.test'},{firstName:'@John'},{firstName:'-John'},{firstName:'<John>'},{firstName:'😀John'},{firstName:'x'.repeat(81)},{firstName:'A\u0000da'}]) {
    await assert.rejects(()=>flow.requestEmailCode(client,'new@example.invalid','https://visathreads.com/login',true,names),error=>error.code==='invalid_first_name');
  }
  for(const lastName of ['', '  ', '123', 'x'.repeat(81),'Lo\u0000ve']) {
    await assert.rejects(()=>flow.requestEmailCode(client,'new@example.invalid','https://visathreads.com/login',true,{firstName:'Ada',lastName}),error=>error.code==='invalid_last_name');
  }
  assert.equal(calls,0);
  await flow.requestEmailCode(client,'existing@example.invalid','https://visathreads.com/login');
  assert.equal(calls,1);
  assert.match(flow.authErrorMessage({code:'invalid_first_name'}),/first name/);
  assert.match(flow.authErrorMessage({code:'invalid_last_name'}),/last name/);
});

test('password signup sends credentials to Supabase Auth and waits for confirmation when required', async () => {
  const calls=[];
  const client={auth:{signUp:async input=>{calls.push(input);return {data:{user:{id:'new-user'},session:null},error:null};}}};
  const signedIn=await flow.registerWithPassword(client,'  ada@example.invalid  ','correct-horse-battery-staple','https://visathreads.com/login?auth=callback',{firstName:' Ada ',lastName:' Lovelace '},'captcha-fixture');
  assert.equal(signedIn,false);
  assert.deepEqual(calls[0],{email:'ada@example.invalid',password:'correct-horse-battery-staple',options:{emailRedirectTo:'https://visathreads.com/login?auth=callback',data:{first_name:'Ada',last_name:'Lovelace'},captchaToken:'captcha-fixture'}});
  for(const [password,names] of [['short',{firstName:'Ada',lastName:'Lovelace'}],['correct-horse-battery-staple',{firstName:'Ada',lastName:''}]]) {
    await assert.rejects(()=>flow.registerWithPassword(client,'ada@example.invalid',password,'https://visathreads.com/login',names),error=>['invalid_password','invalid_last_name'].includes(error.code));
  }
  assert.equal(calls.length,1,'Invalid signup never reaches Supabase');
  const immediate={auth:{signUp:async()=>({data:{user:{id:'new-user'},session:{access_token:'fixture'}},error:null})}};
  assert.equal(await flow.registerWithPassword(immediate,'ada@example.invalid','correct-horse-battery-staple','https://visathreads.com/login',{firstName:'Ada',lastName:'Lovelace'}),true);
  await assert.rejects(()=>flow.registerWithPassword({auth:{signUp:async()=>({data:{user:null,session:null},error:null})}},'ada@example.invalid','correct-horse-battery-staple','https://visathreads.com/login',{firstName:'Ada',lastName:'Lovelace'}),/not confirmed/);
});

test('phone request and verification use sms otp APIs', async () => {
  const calls = [];
  const client = { auth: {
    signInWithOtp: async args => { calls.push(args); return { error: null }; },
    verifyOtp: async args => { calls.push(args); return { data: { session: { user: {} } }, error: null }; },
  } };
  await flow.requestPhoneCode(client, ' +1 (555) 123-4567 ', { google: false, phone: true });
  assert.deepEqual(calls[0], { phone: '+15551234567', options: { shouldCreateUser: false } });
  await flow.verifyPhoneCode(client, '+15551234567', ' 123456 ');
  assert.deepEqual(calls[1], { phone: '+15551234567', token: '123456', type: 'sms' });
  await flow.requestPhoneCode(client, '+15551234567', { google: false, phone: true }, true);
  assert.deepEqual(calls[2], { phone: '+15551234567', options: { shouldCreateUser: true } });
  await assert.rejects(() => flow.requestPhoneCode(client, '+15551234567', { google: false, phone: false }), e => e.code === 'phone_provider_disabled');
  for (const phone of ['', '5551234567', '+0123', '+1555']) assert.throws(() => flow.normalizePhone(phone));
  for (const code of ['', '12345', '12345678901', 'abcdef']) await assert.rejects(() => flow.verifyPhoneCode(client, '+15551234567', code), e => e.code === 'invalid_code');
});

test('disabled and unapproved social providers never initiate OAuth', async () => {
  const calls = [];
  const client = { auth: { signInWithOAuth: async args => { calls.push(args); return { error: null }; } } };
  await assert.rejects(() => flow.startSocialSignIn(client, 'google', { google: false, apple: false }, 'https://visaflow.example/login'));
  await assert.rejects(() => flow.startSocialSignIn(client, 'github', { github: true }, 'https://visaflow.example/login'));
  assert.equal(calls.length, 0);
  await assert.rejects(() => flow.startSocialSignIn(client, 'apple', { google: true, apple: true }, 'https://visaflow.example/login'));
  await flow.startSocialSignIn(client, 'google', { google: true }, 'https://visaflow.example/login');
  assert.deepEqual(calls.map(c => c.provider), ['google']);
  assert(calls.every(c => c.options.redirectTo === 'https://visaflow.example/login'));
  assert(calls.every(c => c.options.queryParams?.prompt === 'select_account'), 'Google must ask which account to use even when a browser already has a Google session');
});

test('friendly errors never echo raw backend messages', () => {
  assert.match(flow.authErrorMessage({ status: 429 }), /Too many attempts/);
  assert.match(flow.authErrorMessage({ code: 'otp_expired' }), /expired/);
  assert.match(flow.authErrorMessage({ code: 'provider_disabled' }), /not available/);
  assert(!flow.authErrorMessage(new Error('Supabase private raw details')).includes('Supabase'));
});

test('code request, verification and password failures describe the actual step without account enumeration', () => {
  const request = { action: 'request-code', createAccount: false, channel: 'email' };
  const signup = { ...request, createAccount: true };
  const verify = { action: 'verify-code' };
  const failure = flow.authErrorMessage({ code: 'user_not_found' }, request);
  assert.match(failure, /couldn’t send a sign-in code/);
  assert.match(failure, /Choose Create account/);
  assert.doesNotMatch(failure, /invalid|expired|not found|does not exist|password/i);
  for (const code of ['invalid_credentials', 'email_exists', 'phone_exists', 'user_already_exists', 'signup_disabled', 'otp_disabled']) {
    assert.equal(flow.authErrorMessage({ code }, request), failure, 'A request must not confirm whether contact details have an account');
  }
  assert.match(flow.authErrorMessage({ code: 'invalid_credentials' }, signup), /Already a member\? Choose Log in/);
  assert.match(flow.authErrorMessage({ code: 'signup_disabled' }, signup), /New account registration is not available/);
  assert.doesNotMatch(flow.authErrorMessage({ code: 'signup_disabled' }, signup), /code.*invalid|code.*expired/);
  assert.match(flow.authErrorMessage({ code: 'otp_disabled' }, verify), /Code sign-in is not available/);
  assert.doesNotMatch(flow.authErrorMessage({ code: 'otp_disabled' }, verify), /invalid|expired/);
  assert.match(flow.authErrorMessage({ code: 'invalid_credentials' }, verify), /couldn’t verify that code/);
  assert.match(flow.authErrorMessage({ code: 'otp_expired' }, verify), /latest code/);
  assert.equal(flow.authErrorMessage({ code: 'otp_expired' }, request), failure);
  assert.doesNotMatch(flow.authErrorMessage({ code: 'invalid_credentials' }, { action: 'password' }), /expired/);
});

test('delivery, service, provider and security failures remain actionable without raw server details', () => {
  const request = { action: 'request-code', channel: 'email' };
  assert.match(flow.authErrorMessage({ code: 'sms_send_failed' }, request), /text message could not be sent/);
  assert.match(flow.authErrorMessage({ code: 'email_address_not_authorized' }, request), /Email delivery is not available/);
  assert.match(flow.authErrorMessage({ code: 'email_provider_disabled' }, request), /Email sign-in is not available/);
  assert.match(flow.authErrorMessage({ code: 'email_address_invalid' }, request), /valid email/);
  for (const context of [request, { action: 'verify-code' }, { action: 'sign-out' }]) {
    const message = flow.authErrorMessage(new Error('private backend detail user@example.invalid'), context);
    assert.doesNotMatch(message, /private backend|user@example/);
    assert.match(message, /connection/);
    assert.match(flow.authErrorMessage({ status: 429 }, context), /Too many attempts/);
    assert.match(flow.authErrorMessage({ code: 'captcha_failed' }, context), /security check/);
  }
});

test('code template and screen keep branding and security boundaries', async () => {
  const form = await readFile(new URL('../src/components/AuthForm.tsx', import.meta.url), 'utf8');
  const template = await readFile(new URL('../supabase/templates/sign-in-code.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/lib/supabase/client.ts', import.meta.url), 'utf8');
  assert(form.includes("'current-password'"));
  assert(!form.includes('Continue with Apple'));
  assert(!form.includes('Discuss visa experiences with a public pseudonym.'));
  assert(form.includes('autoComplete="one-time-code"'));
  assert(form.includes('Phone number'));
  assert(form.includes('Continue with Google'));
  assert(form.includes('role="alert"'));
  assert(form.includes('setCooldown(60)'));
  assert(form.includes('safeAuthNext'));
  assert(template.includes('{{ .Token }}'));
  assert(template.includes('VisaThreads'));
  assert(!template.includes('VisaFlow'));
  assert(!template.includes('ConfirmationURL'));
  assert(client.includes("flowType: 'pkce'"));
});

test('password login normalizes email and requires a real session', async () => {
  let supplied;
  await flow.signInWithPassword({ auth: { signInWithPassword: async args => { supplied = args; return { data: { session: {} }, error: null }; } } }, ' user@example.invalid ', 'test-only-password');
  assert.equal(supplied.email, 'user@example.invalid');
  await assert.rejects(() => flow.signInWithPassword({ auth: { signInWithPassword: async () => ({ data: { session: null }, error: null }) } }, 'user@example.invalid', 'test-only-password'), /Session missing/);
  for (const email of ['', 'foo', 'a@b', 'a b@example.invalid']) assert.throws(() => flow.normalizeEmail(email));
});

test('password setup requires server-confirmed email and validates length', async () => {
  let updates = 0;
  const client = { auth: { getUser: async () => ({ data: { user: { email_confirmed_at: '2026-10-02' } }, error: null }), updateUser: async () => { updates++; return { data: { user: {} }, error: null }; } } };
  for (const value of ['short', 'x'.repeat(129)]) await assert.rejects(() => flow.setVerifiedPassword(client, value), e => e.code === 'invalid_password');
  await flow.setVerifiedPassword(client, 'test-only-password');
  assert.equal(updates, 1);
  client.auth.getUser = async () => ({ data: { user: {} }, error: null });
  await assert.rejects(() => flow.setVerifiedPassword(client, 'test-only-password'), e => e.code === 'email_not_confirmed');
  assert.equal(updates, 1);
});

test('normalized traversal cannot loop back into auth pages', () => {
  for (const path of ['/a/../login', '/a/../signup', '/a/../account/recovery', '/signup#x']) assert.equal(flow.safeAuthNext(path), '/');
});

test('optional CAPTCHA passes fresh tokens to every supported Auth request and fails before network if missing', async () => {
  const previous = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const calls = [];
  const record = name => async (...args) => { calls.push({ name, args }); return { error: null, data: { session: {} } }; };
  const client = { auth: { signInWithOtp: record('otp'), verifyOtp: record('verify'), signInWithPassword: record('password'), signUp: async (...args) => { calls.push({name:'signup',args}); return {data:{user:{id:'fixture'},session:null},error:null}; }, resetPasswordForEmail: record('recovery') } };
  try {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'configured-public-fixture';
    const requests = [
      token => flow.requestEmailCode(client, 'member@example.invalid', 'https://visathreads.com/login', false, undefined, token),
      token => flow.requestPhoneCode(client, '+15551234567', { phone: true }, false, token),
      token => flow.signInWithPassword(client, 'member@example.invalid', 'fixture-only', token),
      token => flow.registerWithPassword(client, 'new@example.invalid', 'correct-horse-battery-staple', 'https://visathreads.com/login', {firstName:'Ada',lastName:'Lovelace'}, token),
      token => flow.verifyEmailCode(client, 'member@example.invalid', '123456', token),
      token => flow.verifyPhoneCode(client, '+15551234567', '123456', token),
      token => flow.requestPasswordRecovery(client, 'member@example.invalid', 'https://visathreads.com/account/update-password', token),
    ];
    for (const request of requests) await assert.rejects(() => request(), e => e.code === 'captcha_required');
    assert.equal(calls.length, 0);
    for (const [index, request] of requests.entries()) await request('one-use-fixture-'+index);
    for (const [index, call] of calls.entries()) assert.equal((call.name === 'recovery' ? call.args[1] : call.args[0].options).captchaToken, 'one-use-fixture-'+index);
    for (const token of ['x'.repeat(2049), 'token\ninvalid']) assert.throws(() => flow.authCaptchaOptions(token), e => e.code === 'captcha_failed');
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    assert.deepEqual(flow.authCaptchaOptions(), {});
    assert.match(flow.authErrorMessage({code:'captcha_required'}), /security check/);
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previous; }
});
