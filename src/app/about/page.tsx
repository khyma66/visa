import type { Metadata } from 'next';
import Link from 'next/link';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';

const title = 'About VisaThreads';
const description = 'VisaThreads is an independent U.S. visa community. Learn how to use member experiences, official-resource guides and corrections responsibly.';
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }): Promise<Metadata> {
  return publicPageMetadata('/about', title, description, await searchParams);
}

export default function AboutPage() {
  return <main className="page-shell">
    <article className="mx-auto max-w-3xl space-y-7 text-base leading-7 text-slate-700">
      <header>
        <p className="mb-2 text-sm font-semibold text-blue-700">Your visa journey, together</p>
        <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">About VisaThreads</h1>
        <p className="mt-4">VisaThreads is an independent community for questions and shared experiences about U.S. visas. It brings related discussions together so you can learn what other people encountered and ask a more informed next question.</p>
      </header>
      <section>
        <h2 className="text-thread-title font-semibold text-slate-950">Understand what you are reading</h2>
        <p className="mt-3">Member posts and archived discussions are personal accounts. They can be incomplete, mistaken or out of date. A reported approval or timeline is not a verified result or a prediction for another application. Public usernames do not guarantee anonymity.</p>
        <p className="mt-3">Our <Link href="/guides" className="text-blue-700 underline">resource guides</Link> provide checklists and links to official information. Their editorial reference-check dates identify when those references were checked; they do not mean an attorney reviewed the guide or that an agency endorsed it.</p>
      </section>
      <section>
        <h2 className="text-thread-title font-semibold text-slate-950">Use the community alongside official sources</h2>
        <p className="mt-3">VisaThreads is not a government service, law firm or legal representative. Use official agency instructions for application requirements, and a qualified professional for advice about your own circumstances. Keep visa applications, immigration status and work authorization separate when comparing cases.</p>
        <p className="mt-3">Where an AI-assisted feature is available, treat its output as a starting point. Follow its source links and check whether the source actually addresses your question. It cannot establish eligibility or replace a decision by the responsible authority.</p>
      </section>
      <section>
        <h2 className="text-thread-title font-semibold text-slate-950">Corrections, privacy and support</h2>
        <p className="mt-3">If a guide has an incorrect statement or broken reference, send the page link and the specific correction through our <Link href="/contact" className="text-blue-700 underline">support contact</Link>. Include an official source when possible. For removal or privacy concerns, use that same contact rather than posting identity documents publicly.</p>
        <p className="mt-3">Read the <Link href="/community-safety" className="text-blue-700 underline">community safety guidance</Link>, <Link href="/privacy" className="text-blue-700 underline">privacy notice</Link> and <Link href="/terms" className="text-blue-700 underline">community rules</Link> before contributing.</p>
      </section>
      <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-6">
        <Link href="/guides" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Find a Visa Guide</Link>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Browse the Community</Link>
      </div>
    </article>
  </main>;
}
