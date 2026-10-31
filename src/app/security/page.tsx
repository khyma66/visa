import Link from 'next/link';
import { publicPageMetadata } from '@/lib/search-metadata';

export function generateMetadata() {
  return publicPageMetadata('/security', 'Security at VisaThreads',
    'How to report a suspected security vulnerability to VisaThreads privately and responsibly.');
}

export default function SecurityPage() {
  return <main className="mx-auto max-w-3xl space-y-7 px-4 py-12 leading-7">
    <h1 className="text-3xl font-black">Security at VisaThreads</h1>
    <p>We welcome responsible reports that help protect VisaThreads members and their information. Please report suspected vulnerabilities privately so we can review them before details are shared publicly.</p>
    <section className="space-y-2">
      <h2 className="text-xl font-bold">Report a vulnerability</h2>
      <p>Email <a className="break-all text-blue-700 underline" href="mailto:varunchinna5966@gmail.com?subject=VisaThreads%20security%20report">varunchinna5966@gmail.com</a> with “VisaThreads security report” in the subject. Include the affected URL or feature, what you observed, steps that reproduce it, and the potential impact. Send only the minimum data needed to explain the issue.</p>
      <p>Do not send passwords, authentication codes, identity documents, access tokens, database exports, or personal information belonging to other people. If sensitive information appears in your evidence, redact it before sending.</p>
    </section>
    <section className="space-y-2">
      <h2 className="text-xl font-bold">Responsible testing</h2>
      <p>Use only accounts and data you control. Stop if you access another person’s information or could affect site availability. Do not use denial-of-service testing, social engineering, automated account creation, spam, destructive actions, malware, physical attacks, or third-party systems.</p>
      <p>Do not retain, copy, change, or publicly disclose information you were not authorized to access. This page does not grant permission to violate law, disrupt the service, or access another person’s account or data.</p>
    </section>
    <section className="space-y-2">
      <h2 className="text-xl font-bold">What happens after a report</h2>
      <p>We will review reports in good faith and may ask for clarification. Response and remediation times depend on severity and available evidence; we do not promise a particular timeline or monetary reward. Please allow a reasonable opportunity to investigate and address a confirmed issue before considering disclosure.</p>
      <p>For account support, privacy requests, content reports, or copyright concerns, use <Link href="/contact" className="text-blue-700 underline">Reporting and Privacy Requests</Link> instead.</p>
    </section>
  </main>;
}
