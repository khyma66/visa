import Link from 'next/link';

/** Shared footer guidance, kept out of reading and writing flows. */
export function SafetyNotice(_props?: { kind?: 'publishing' | 'advice' }) {
  return <section aria-label="Community safety reminders" className="max-w-5xl space-y-1">
    <p><b className="font-semibold text-slate-700">Stay safe.</b> Never share passwords, verification codes, passport or case IDs, or private documents. Questions and replies are public; public usernames do not guarantee anonymity.</p>
    <p>Messages are not end-to-end encrypted: recipients can copy them, moderators may review reported messages, and administrators can access stored data. VisaThreads is a peer community, not a government service or legal adviser.{' '}<Link href="/community-safety" className="font-semibold text-teal-700 underline">Safety and community rules</Link></p>
  </section>;
}
