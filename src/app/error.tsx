'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-2xl font-black">We couldn’t load this page</h1><p className="mt-3">Your connection or the community service may be temporarily unavailable.</p><button onClick={reset} className="mt-5 rounded bg-blue-700 px-4 py-3 font-bold text-white">Try again</button></main>;
}
