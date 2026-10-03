import Link from 'next/link';

export const metadata = { title: 'Preview community rules' };

export default function TermsPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 leading-7">
    <h1 className="text-3xl font-bold">Preview community rules</h1>
    <p className="rounded border border-amber-200 bg-amber-50 p-4">These are current safety rules, not finalized production Terms of Service. Operator details, age eligibility, content-license terms, disputes and an appeals contact require review before public launch. No acceptance of a future agreement is implied by this page.</p>
    <section><h2 className="text-xl font-bold">Share experiences responsibly</h2><p>VisaFlow is an independent peer community, not a government website, law firm or verified legal referral service. Do not present guesses as official rules. Cite official sources and dates when possible; accepted answers and topic matches are not legal verification.</p></section>
    <section><h2 className="text-xl font-bold">Do not harm other members</h2><p>No harassment, threats, impersonation, doxxing, scams, sexual exploitation, nonconsensual intimate content, forged documents or instructions to falsify applications. Do not request passports, account credentials, verification codes or payments for guaranteed visa outcomes. Do not evade blocks, suspensions or posting limits.</p></section>
    <section><h2 className="text-xl font-bold">Respect content ownership</h2><p>Publish only material you created or have permission or another lawful basis to share. Do not copy private-group conversations or other people’s identifying documents. Public availability, an API subscription and a source credit do not by themselves grant republication rights. No license to third-party imported material is granted by this website.</p></section>
    <section><h2 className="text-xl font-bold">Recommendations and promotions</h2><p>Disclose employment, payment, referral fees or other material connections when recommending services. Do not publish unsolicited advertisements, fake reviews or misleading claims of professional qualifications. An imported promotional label is a classification, not VisaFlow’s endorsement.</p></section>
    <section><h2 className="text-xl font-bold">Reports and moderation</h2><p>Use Report on supported member content or Block in a conversation. Moderation tools can remove reported content and suspend accounts. A report does not guarantee immediate review or emergency assistance. Appeals, copyright notices and non-member requests need the operator’s dedicated process, which is not yet configured in this preview.</p></section>
    <p><Link href="/privacy" className="text-teal-700 underline">Preview privacy notice</Link>{' · '}<Link href="/contact" className="text-teal-700 underline">Reporting and request-channel status</Link></p>
  </main>;
}
