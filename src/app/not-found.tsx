import Link from 'next/link';
export default function NotFound() {
  return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-2xl font-black">Page not found</h1><p className="mt-3">This page may have been removed or its address may be incorrect.</p><Link href="/" className="mt-5 inline-block font-bold text-blue-700 underline">Back to questions</Link></main>;
}
