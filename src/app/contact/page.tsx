import Link from 'next/link';
import { publicPageMetadata } from '@/lib/search-metadata';

export function generateMetadata() { return publicPageMetadata('/contact', 'Help & Contact', 'Contact VisaThreads about account support, community reports, or privacy requests.'); }

export default function ContactPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 leading-7">
    <h1 className="text-3xl font-bold">Help & contact</h1>
    <p className="text-slate-600">Have a question or need help with VisaThreads? Choose the address that best fits your request. Each email link opens your email app.</p>
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {[
        { title: 'General support', email: 'support@visathreads.com', description: 'Questions about the website, account access, community reports, or feedback.', href: 'mailto:support@visathreads.com' },
        { title: 'Privacy requests', email: 'privacy@visathreads.com', description: 'Questions about your personal information, access, corrections, deletion, or privacy appeals.', href: 'mailto:privacy@visathreads.com?subject=VisaThreads%20privacy%20request' },
        { title: 'Security reports', email: 'security@visathreads.com', description: 'Report a suspected vulnerability or a security issue privately.', href: 'mailto:security@visathreads.com?subject=VisaThreads%20security%20report' },
      ].map(contact => <section key={contact.email} className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">{contact.title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{contact.description}</p>
        <a href={contact.href} className="mt-2 inline-flex min-h-11 items-center break-all rounded text-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">{contact.email}</a>
      </section>)}
    </div>
    <p className="text-sm text-slate-600">Include the relevant page link and a brief description. Do not send passports, passwords, verification codes, payment details, or other sensitive documents. Support is handled by email and is not an emergency service.</p>
    <nav aria-label="Help topics" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
      <Link href="/privacy-choices" className="underline underline-offset-4">Your privacy choices</Link>
      <Link href="/security" className="underline underline-offset-4">Security reporting policy</Link>
      <Link href="/community-safety" className="underline underline-offset-4">Community safety</Link>
    </nav>
    <section><h2 className="text-xl font-bold">Member content and unwanted messages</h2><p>Signed-in members can use Report on member questions, answers and received messages. In messages, Block prevents further messages in that conversation. Report only the relevant content; do not add extra identity documents. Reporting a private message shares that message with an authorized moderator.</p></section>
    <section><h2 className="text-xl font-bold">Previously published content, copyright and privacy</h2><p>The current in-app Report feature does not remove original posts or source comments. Email support@visathreads.com without creating an account, using “Content removal” or “Copyright request” in the subject. Identify the page, the affected material, your relationship to it and how to reply. Do not publish your request or documents as a public question. Removal and future-import suppression still require operator review and an operationally tested process.</p><p>For copyright claims, describe the work and allegedly infringing material, provide contact information, and include the statements of good-faith belief, accuracy and authority and a signature required for a formal notice. A designated DMCA agent has not yet been confirmed; this temporary support contact is not represented as a registered agent.</p></section>
    <section><h2 className="text-xl font-bold">Intimate content shared without consent</h2><p>Use “Urgent intimate-content removal” in the email subject. Include a link or other information locating the material, a way to contact you, your physical or electronic signature, and a statement that you reasonably believe the identified intimate image was published without your consent, with any other relevant information. An authorized representative may contact us. Do not attach, download or forward the image, especially if a child is involved. The operator must maintain the legally required removal and duplicate-review process; staffing and response tracking remain launch requirements.</p></section>
    <section><h2 className="text-xl font-bold">Safety emergencies</h2><p>VisaThreads is not an emergency service. For imminent danger in the U.S., call 911; elsewhere use your local emergency number. Do not download or forward suspected child sexual abuse material. You can report suspected child exploitation to <a className="text-blue-700 underline" href="https://report.cybertip.org/">NCMEC’s CyberTipline</a>. This external reporting option does not replace the operator’s own legal duties.</p></section>
    <section><h2 className="text-xl font-bold">Scams and professional help</h2><p>Check the <a className="text-blue-700 underline" href="https://www.uscis.gov/avoid-scams">USCIS scam-prevention resources</a>. Verify an attorney’s license or a representative’s authorization independently. Never trust a direct message promising guaranteed approval.</p></section>
    <section><h2 className="text-xl font-bold">Security vulnerabilities</h2><p>Do not include exploit details in a public post or feedback submission. Read our <Link href="/security" className="text-blue-700 underline">security reporting policy</Link> and report the issue privately.</p></section>
    <Link href="/community-safety" className="text-blue-700 underline">Back to community safety</Link>
  </main>;
}
