'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';

type Domain = { domain: string; reason: string };
export function SpamDomainControls() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.resolve(getSupabase().rpc('community_spam_domains').abortSignal(AbortSignal.timeout(8000))).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('Domain controls are unavailable. Try refreshing the page.');
      else setDomains(data ?? []);
    }).catch(() => { if (active) setError('Domain controls are unavailable. Try refreshing the page.'); });
    return () => { active = false; };
  }, []);
  async function change(action: 'block' | 'unblock', target: string) {
    setBusy(true); setError('');
    try {
      const { data, error } = await getSupabase().rpc('community_spam_domains', { action, domain_name: target, explanation: reason.trim() });
      if (error) throw new Error(error.message);
      setDomains(data ?? []);
      if (action === 'block') { setDomain(''); setReason(''); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update blocked websites.'); }
    finally { setBusy(false); }
  }
  return <section className="my-6 rounded-xl border border-orange-200 bg-orange-50 p-5">
    <h2 className="font-bold">Blocked scam websites</h2>
    <p className="mt-2 text-sm text-slate-700">Block a website only after checking the evidence. Its subdomains will also be blocked in new posts, replies and edits. Existing posts still need individual review.</p>
    <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void change('block', domain); }}>
      <label className="block text-sm font-semibold">Website domain<input required maxLength={253} value={domain} onChange={event => setDomain(event.target.value)} placeholder="example.com" autoCapitalize="none" autoCorrect="off" disabled={busy} className="mt-1 block w-full rounded border bg-white p-2" /></label>
      <label className="block text-sm font-semibold">Evidence / reason<input required minLength={5} maxLength={300} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} className="mt-1 block w-full rounded border bg-white p-2" /></label>
      <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Block website</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}
    <ul className="mt-4 space-y-3">{domains.map(item => <li key={item.domain} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white p-3 text-sm"><div className="min-w-0 break-words"><b>{item.domain}</b><p>{item.reason}</p></div><button disabled={busy} onClick={() => void change('unblock',item.domain)} className="rounded border px-3 py-2">Unblock</button></li>)}</ul>
  </section>;
}
