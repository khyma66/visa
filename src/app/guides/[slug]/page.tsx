import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import { GUIDE_REFERENCE_CHECKED_LABEL, GUIDE_REFERENCE_CHECKED_ON, VISA_GUIDES, guideCommunityHref, visaGuide } from '@/lib/visa-guides';
import { publicPageMetadata, type SearchParameters } from '@/lib/search-metadata';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParameters> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = visaGuide(slug);
  return guide
    ? publicPageMetadata(`/guides/${guide.slug}`, guide.title, guide.description, await searchParams)
    : publicPageMetadata(`/guides/${encodeURIComponent(slug)}`, 'Guide not found', 'This VisaThreads guide could not be found.', await searchParams, false);
}

export function generateStaticParams() {
  return VISA_GUIDES.map(({ slug }) => ({ slug }));
}

export default async function VisaGuidePage({ params }: Props) {
  const guide = visaGuide((await params).slug);
  if (!guide) notFound();

  return <main className="page-shell">
    <article className="mx-auto max-w-3xl">
      <Link href="/guides" className="mb-5 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"><ChevronLeft size={16} aria-hidden="true" />All Visa Guides</Link>
      <header className="border-b border-slate-200 pb-6">
        <p className="mb-2 text-sm font-semibold text-blue-700">{guide.visaType} · Resource Guide</p>
        <h1 className="text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">{guide.title}</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">{guide.introduction}</p>
        <p className="mt-4 text-sm leading-6 text-slate-500">Editorial reference check: <time dateTime={GUIDE_REFERENCE_CHECKED_ON}>{GUIDE_REFERENCE_CHECKED_LABEL}</time>. Not a legal review; confirm current instructions with the relevant agency.</p>
      </header>

      <section aria-labelledby="key-distinction" className="my-7 rounded-xl border border-blue-100 bg-blue-50/60 p-5">
        <h2 id="key-distinction" className="text-thread-title font-semibold text-slate-950">First, keep these separate</h2>
        <p className="mt-2 text-base leading-7 text-slate-700">{guide.distinction}</p>
        <a href={guide.references.find(({ title }) => title === 'What the Visa Expiration Date Means')?.url} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 underline">Official visa-validity explanation<ArrowUpRight size={14} aria-hidden="true" /></a>
      </section>

      <section aria-labelledby="preparation-checklist">
        <h2 id="preparation-checklist" className="text-thread-title font-semibold text-slate-950">Your preparation checklist</h2>
        <ol className="mt-4 space-y-6">
          {guide.steps.map((step, index) => <li key={step.title} className="flex gap-3 sm:gap-4">
            <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{index + 1}</span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-7 text-slate-950"><span className="sr-only">Step {index + 1}: </span>{step.title}</h3>
              <p className="mt-1 text-base leading-7 text-slate-700">{step.body}</p>
              {step.source !== undefined && <a href={guide.references[step.source].url} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 underline">{guide.references[step.source].title}<ArrowUpRight size={14} aria-hidden="true" /></a>}
            </div>
          </li>)}
        </ol>
      </section>

      <section aria-labelledby="questions-to-ask" className="my-8 border-y border-slate-200 py-6">
        <h2 id="questions-to-ask" className="text-thread-title font-semibold text-slate-950">Questions worth asking</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-slate-700">{guide.questions.map((question) => <li key={question}>{question}</li>)}</ul>
      </section>

      <section aria-labelledby="read-experiences">
        <h2 id="read-experiences" className="text-thread-title font-semibold text-slate-950">Use community experiences well</h2>
        <p className="mt-3 text-base leading-7 text-slate-700">{guide.communityContext}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={guideCommunityHref(guide)} className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Browse {guide.visaType} Questions</Link>
          <Link href={guideCommunityHref(guide, true)} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Read Related Experiences</Link>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-500">Do not share identity documents, receipt numbers or verification codes. This guide and community replies cannot establish your eligibility or work authorization.</p>
      </section>

      <section aria-labelledby="official-references" className="mt-8 border-t border-slate-200 pt-6">
        <h2 id="official-references" className="text-thread-title font-semibold text-slate-950">Official references</h2>
        <ul className="mt-4 space-y-4">{guide.references.map((reference) => <li key={reference.url}>
          <a href={reference.url} className="inline-flex items-center gap-1 text-base font-semibold text-blue-700 underline">{reference.title}<ArrowUpRight size={15} aria-hidden="true" /></a>
          <p className="mt-1 text-sm leading-6 text-slate-600">{reference.publisher} · {reference.purpose}</p>
        </li>)}</ul>
        {guide.furtherReading && <div className="mt-6">
          <h3 className="text-base font-semibold text-slate-950">Additional agency starting points</h3>
          <ul className="mt-3 space-y-3">{guide.furtherReading.map((reference) => <li key={reference.url}>
            <a href={reference.url} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 underline">{reference.title}<ArrowUpRight size={14} aria-hidden="true" /></a>
            <p className="mt-1 text-sm leading-6 text-slate-600">{reference.publisher} · {reference.purpose}</p>
          </li>)}</ul>
        </div>}
        <p className="mt-6 text-sm leading-6 text-slate-500">VisaThreads is an independent community, not a government service or law firm. The reference-check date describes this editorial check, not an agency update date or a guarantee that rules remain unchanged. <Link href="/contact" className="text-blue-700 underline">Report a correction</Link>.</p>
      </section>
    </article>
  </main>;
}
