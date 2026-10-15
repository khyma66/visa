import Link from 'next/link';

export const metadata = { title: 'Feedback Privacy', robots: { index: false, follow: false } };
export default function FeedbackPrivacyPage() {
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-7">
    <h1 className="text-2xl font-bold">Feedback Privacy</h1><p>Feedback-specific notice · October 14, 2026</p>
    <p>Sending feedback is optional. We store your message, category, account identifier, submission time and—if you choose—a broad website section. We use these to review problems and suggestions, prevent spam and track improvements. The form does not capture full page addresses, searches, screenshots, browser logs or private conversations.</p>
    <p>Access to submissions and review notes is restricted by application permissions. Authorized infrastructure administrators and service providers may access stored data to operate the service. Feedback is not end-to-end encrypted.</p>
    <p>Do not include passwords, immigration case identifiers, identity documents, financial information or other people’s personal details. For account help, privacy requests or urgent security concerns, use the <Link href="/contact" className="text-blue-700 underline">contact page</Link> instead.</p>
    <p>Feedback is retained for review until the operator removes it. There is not yet an automatic deletion schedule. You can request access or deletion through the contact channel; include the feedback reference if available. Backup and legal-preservation handling are described in the <Link href="/privacy" className="text-blue-700 underline">preview privacy notice</Link>.</p>
    <p>Feedback is not currently sent to an AI provider. Future AI-assisted triage requires a separate privacy and access review before activation. Approving an improvement plan does not automatically publish code or deploy a change.</p>
    <Link href="/feedback" className="text-blue-700 underline">Back to Feedback</Link>
  </main>;
}
