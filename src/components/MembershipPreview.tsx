'use client';

import { useState } from 'react';
import { MEMBERSHIP_PLANS, inlineAdPositions, researchItem, type ResearchItem } from '@/lib/membership';
import { AdvertisementSlot } from './AdvertisementSlot';

const control = 'min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm';
export function MembershipPreview() {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [adPreview, setAdPreview] = useState(false);
  function add(event: React.FormEvent) {
    event.preventDefault();
    const item = researchItem(title, url);
    if (!item) { setNotice('Add a title and an HTTPS link from VisaThreads, USCIS, or travel.state.gov.'); return; }
    if (items.length >= 50) { setNotice('This preview supports up to 50 research links.'); return; }
    if (items.some(existing => existing.url === item.url)) { setNotice('That link is already in your list.'); return; }
    setItems(previous => [...previous, item]); setTitle(''); setUrl(''); setNotice('Link added for this session.');
  }
  function download() {
    const blob = new Blob([JSON.stringify({ format: 'visathreads-research-v1', items }, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = objectUrl; link.download = 'visathreads-research.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setNotice('Research list exported. Keep the downloaded file private.');
  }
  return <main className="page-shell space-y-8">
    <header className="max-w-3xl space-y-3"><p className="font-semibold text-blue-700">Membership design preview</p><h1 className="text-3xl font-semibold">Build your visa research workspace</h1><p className="text-slate-600">Proposed plans for review—not available for purchase. No prices, charges, subscriptions, or paid access are enabled.</p></header>
    <section aria-label="Proposed membership plans" className="grid gap-4 lg:grid-cols-3">{MEMBERSHIP_PLANS.map(plan => <article key={plan.id} className="rounded-xl border border-slate-200 p-6"><h2 className="text-xl font-semibold">{plan.name}</h2><p className="mt-2 text-sm text-slate-600">{plan.description}</p><ul className="my-5 list-disc space-y-2 pl-5 text-sm">{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul><p className="text-sm font-semibold text-blue-700">{plan.id === 'free' ? 'Core community remains free' : 'Proposed · Not for sale'}</p></article>)}</section>
    <section className="max-w-3xl space-y-4 rounded-xl border border-slate-200 p-6"><h2 className="text-xl font-semibold">Try the research-list prototype</h2><p className="text-sm text-slate-600">Organize official resources, mark them reviewed, and export your list. This prototype stays in memory and clears when you reload or leave. Nothing is uploaded. Do not enter personal case information.</p>
      <form onSubmit={add} className="grid gap-3"><label className="grid gap-1 text-sm">Resource title<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} className={control} /></label><label className="grid gap-1 text-sm">Resource URL<input required type="url" maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} className={control} /></label><button className={`${control} bg-blue-700 font-semibold text-white`}>Add resource</button></form>
      <p role="status" className="text-sm text-slate-600">{notice}</p>
      <ul className="divide-y divide-slate-200">{items.map(item => <li key={item.url} className="flex items-center gap-3 py-3"><input type="checkbox" aria-label={`Mark ${item.title} reviewed`} checked={item.checked} onChange={() => setItems(previous => previous.map(row => row.url === item.url ? { ...row, checked: !row.checked } : row))} /><a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-sm text-blue-700 underline">{item.title}</a><button className={control} aria-label={`Remove ${item.title}`} onClick={() => setItems(previous => previous.filter(row => row.url !== item.url))}>Remove</button></li>)}</ul>
      <button disabled={!items.length} onClick={download} className={`${control} disabled:opacity-50`}>Export research list</button>
    </section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Advertising layout preview</h2><p className="max-w-3xl text-sm text-slate-600">A sidebar unit and at most two units in a 20-post feed. No placements in sign-in, messages, private communities, account settings, or sensitive case pages. Premium and Pro are proposed as ad-free.</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={adPreview} onChange={event => setAdPreview(event.target.checked)} />Show sample ad spaces</label>
      {adPreview && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"><div>{Array.from({ length: 20 }, (_, index) => <div key={index}><div className="border-b border-slate-200 p-4 text-sm text-slate-500">Sample discussion {index + 1} · Layout example, not member content</div>{inlineAdPositions(20).includes(index + 1) && <AdvertisementSlot placement="feed" preview />}</div>)}</div><div><AdvertisementSlot placement="sidebar" preview /></div></div>}
    </section>
    <p className="text-sm text-slate-600">Paid membership would provide convenience and organization—not immigration advice, verified outcomes, preferential moderation, or guaranteed visa approval.</p>
  </main>;
}
