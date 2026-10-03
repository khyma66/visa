import Link from 'next/link';

export const metadata = { title: 'Reporting and privacy requests' };

export default function ContactPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 leading-7">
    <h1 className="text-3xl font-bold">Reporting and privacy requests</h1>
    <p className="rounded border border-amber-200 bg-amber-50 p-4"><b>Preview limitation:</b> a monitored operator support/privacy mailbox, public takedown intake and appeals process have not been configured. This page does not submit a request. General public launch must wait until these channels work and reviewers are assigned.</p>
    <section><h2 className="text-xl font-bold">Member content and unwanted messages</h2><p>Signed-in members can use Report on member questions, answers and received messages. In messages, Block prevents further messages in that conversation. Report only the relevant content; do not add extra identity documents. Reporting a private message shares that message with an authorized moderator.</p></section>
    <section><h2 className="text-xl font-bold">Imported content, copyright and privacy</h2><p>The current in-app Report feature does not remove original imported posts or source comments. Before launch the operator must provide a request channel usable without an account, verify requests safely, review the source rights, and support removal from the archive and future refreshes. Do not publish your removal request or personal documents as a new public question.</p></section>
    <section><h2 className="text-xl font-bold">Safety emergencies</h2><p>VisaFlow is not an emergency service. For imminent danger in the U.S., call 911; elsewhere use your local emergency number. Do not download or forward suspected child sexual abuse material. You can report suspected child exploitation to <a className="text-teal-700 underline" href="https://report.cybertip.org/">NCMEC’s CyberTipline</a>. This external reporting option does not replace the operator’s own legal duties.</p></section>
    <section><h2 className="text-xl font-bold">Scams and professional help</h2><p>Check the <a className="text-teal-700 underline" href="https://www.uscis.gov/avoid-scams">USCIS scam-prevention resources</a>. Verify an attorney’s license or a representative’s authorization independently. Never trust a direct message promising guaranteed approval.</p></section>
    <Link href="/community-safety" className="text-teal-700 underline">Back to community safety</Link>
  </main>;
}
