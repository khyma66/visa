import Link from 'next/link';

/** Shared footer guidance, kept out of reading and writing flows. */
export function SafetyNotice(_props?: { kind?: 'publishing' | 'advice' }) {
  return <section aria-label="Community Safety reminders" className="max-w-5xl space-y-1">
    <p>Keep passwords, verification codes and personal documents private. Community discussions are not legal advice.</p>
    <details className="group">
      <summary className="w-fit cursor-pointer font-semibold text-slate-700">Privacy and messaging safety</summary>
      <div className="mt-2 max-w-3xl space-y-1">
        <p>Never share passport or case IDs. Questions and replies are public; public usernames do not guarantee anonymity.</p>
        <p>Messages are not end-to-end encrypted: recipients can copy them, moderators may review reported messages, and administrators can access stored data. VisaThreads is not a government service or legal adviser.{' '}<Link href="/community-safety" className="font-semibold text-blue-700 underline">Safety and community rules</Link></p>
      </div>
    </details>
  </section>;
}
