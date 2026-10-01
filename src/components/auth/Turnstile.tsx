'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

type TurnstileApi = {
  render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; theme: string }) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

export default function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  callback.current = onToken;
  useEffect(() => {
    if (!container.current || !window.turnstile) return;
    const widget = window.turnstile.render(container.current, {
      sitekey: siteKey, theme: 'light', callback: token => callback.current(token),
      'expired-callback': () => callback.current(''),
      'error-callback': () => { callback.current(''); setFailed(true); },
    });
    return () => { window.turnstile?.remove(widget); };
  }, [loaded, siteKey]);
  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setLoaded(true)} onError={() => setFailed(true)} />
    <div ref={container} />
    {failed && <p role="alert" className="text-sm text-red-700">The security check could not load. Refresh the page to try again.</p>}
  </>;
}
