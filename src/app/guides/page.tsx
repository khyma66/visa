import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, ChevronRight } from 'lucide-react';
import { GUIDE_REFERENCE_CHECKED_LABEL, GUIDE_REFERENCE_CHECKED_ON, VISA_GUIDES, guideCommunityHref } from '@/lib/visa-guides';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';

const title = 'U.S. Visa Guides and Official Resources';
const description = 'Focused H-1B, F-1 and OPT, and B1/B2 checklists to help you find official instructions and ask clearer questions in the VisaThreads community.';
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParameters> }): Promise<Metadata> {
  return publicPageMetadata('/guides', title, description, await searchParams);
}

export default function GuidesPage() {
  return <main className="page-shell">
    <div className="mx-auto max-w-4xl">
      <header className="border-b border-slate-200 pb-6">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700"><BookOpen size={17} aria-hidden="true" />Start with the right information</p>
        <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">U.S. Visa Guides</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">Make sense of your next question. These short guides connect official instructions with practical checklists and relevant community discussions.</p>
      </header>
      <div className="divide-y divide-slate-200">
        {VISA_GUIDES.map((guide) => <article key={guide.slug} className="py-7">
          <p className="mb-2 text-sm font-semibold text-blue-700">{guide.visaType}</p>
          <h2 className="text-thread-title font-semibold leading-snug"><Link href={`/guides/${guide.slug}`} className="text-slate-950 hover:text-blue-700 hover:underline">{guide.title}</Link></h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">{guide.description}</p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            <Link href={`/guides/${guide.slug}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">Read the guide<ChevronRight size={16} aria-hidden="true" /></Link>
            <Link href={guideCommunityHref(guide)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-700 hover:text-blue-700 hover:underline">Browse related questions<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
        </article>)}
      </div>
      <section aria-labelledby="guide-scope" className="mt-2 rounded-xl border border-blue-100 bg-blue-50/60 p-5 text-sm leading-6 text-slate-700">
        <h2 id="guide-scope" className="font-semibold text-slate-950">What these guides can help with</h2>
        <p className="mt-2">Find the right official resource, organize your facts and prepare a useful question. The guides do not determine eligibility, predict decisions or replace individual legal advice. Community accounts are personal experiences, not official instructions.</p>
        <p className="mt-2">Editorial reference check: <time dateTime={GUIDE_REFERENCE_CHECKED_ON}>{GUIDE_REFERENCE_CHECKED_LABEL}</time>. This is not a legal review. Check the latest agency instructions before acting.</p>
        <Link href="/about" className="mt-3 inline-block font-semibold text-blue-700 underline">How VisaThreads handles sources and corrections</Link>
      </section>
    </div>
  </main>;
}
