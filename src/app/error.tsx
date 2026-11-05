'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

export default function ErrorPage({ reset, retry }: { reset?: () => void; retry?: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="mx-auto max-w-xl px-4 py-12">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold capitalize">We Couldn’t Load This Page</h1>
    <p className="mt-3 capitalize">Your Connection Or The Community Service May Be Temporarily Unavailable.</p>
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <button type="button" onClick={() => { const recover = retry ?? reset; if (recover) recover(); else window.location.reload(); }} className="min-h-11 rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white">Try Again</button>
      <Link href="/us/en" className="inline-flex min-h-11 items-center font-semibold text-teal-800 underline">Back To Questions</Link>
    </div>
  </main>;
}
