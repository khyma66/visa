'use client';

import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string; theme: 'auto'; size: 'flexible'; 'response-field': false;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => boolean;
    'timeout-callback': () => void;
  }) => string;
  remove: (widget: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

let pending: Promise<TurnstileApi> | undefined;
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;
  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
    if (nonce) script.nonce = nonce;
    const fail = () => {
      window.clearTimeout(timer); script.remove();
      reject(new Error('Security check unavailable'));
    };
    const timer = window.setTimeout(fail, 15000);
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile); else fail();
    };
    document.head.appendChild(script);
  }).catch(error => { pending = undefined; throw error; });
  return pending;
}

/** Tokens stay in component memory and are sent only to Supabase Auth. */
export function TurnstileCheck({ siteKey, resetKey, onToken }: {
  siteKey: string; resetKey: number; onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!siteKey || !container.current) return;
    let active = true;
    let api: TurnstileApi | undefined;
    let widget: string | undefined;
    onTokenRef.current(''); setFailed(false);
    const invalidate = () => { if (active) onTokenRef.current(''); };
    const fail = () => { if (active) { invalidate(); setFailed(true); } return true; };
    void loadTurnstile().then(loaded => {
      if (!active || !container.current) return;
      api = loaded;
      widget = api.render(container.current, {
        sitekey: siteKey, theme: 'auto', size: 'flexible', 'response-field': false,
        callback: token => { if (active) { setFailed(false); onTokenRef.current(token); } },
        'expired-callback': invalidate, 'error-callback': fail, 'timeout-callback': fail,
      });
    }).catch(fail);
    return () => {
      active = false;
      if (widget !== undefined) api?.remove(widget);
    };
  }, [siteKey, resetKey, retry]);
  if (!siteKey) return null;
  return <div className="space-y-2">
    <div ref={container} aria-label="Security check" />
    {failed && <p role="alert" className="text-sm text-rose-700">The security check couldn’t load. <button type="button" className="underline" onClick={() => { onTokenRef.current(''); setRetry(value => value + 1); }}>Retry security check</button></p>}
  </div>;
}
