import Link from 'next/link';

export const metadata = { title: 'Optional contact phone | VisaThreads' };

export default function ContactPhoneNotice() {
  return <main className="page-shell max-w-3xl space-y-5 py-10 leading-7">
    <h1 className="text-2xl font-bold text-slate-950">Optional contact phone</h1>
    <p>This notice applies only if you choose to provide a contact phone number. You can use VisaThreads without adding one.</p>
    <p>We store it with your private account authentication details as optional contact information. It is not included in public community profiles, posts or sharing links. Infrastructure administrators can access stored account records.</p>
    <p>Providing it does not verify the number, enable SMS sign-in, or authorize marketing messages. We do not currently use this contact field for automated texts or eligibility decisions.</p>
    <p>You can change or clear it in Profile or Settings. Clearing it removes the current contact value; it does not guarantee immediate erasure from provider backups or security records.</p>
    <p>The existing <Link href="/privacy" className="text-teal-700 underline">privacy notice</Link> explains providers, security limitations and privacy requests. This optional field does not change your account permissions or subscription.</p>
  </main>;
}
