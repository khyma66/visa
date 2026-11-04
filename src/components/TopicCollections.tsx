'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const TOPICS = [
  { tag: 'h1b', title: 'H1BWorkVisas', description: 'Petitions, employer changes, and extensions.' },
  { tag: 'h4', title: 'H4Dependents', description: 'Family status, applications, and renewals.' },
  { tag: 'f1', title: 'F1StudentLife', description: 'Student status and the transition to work.' },
  { tag: 'ead', title: 'EmploymentAuthorization', description: 'EAD applications and work authorization.' },
  { tag: 'stamping', title: 'VisaStamping', description: 'Appointments, interviews, and passport return.' },
  { tag: 'timeline', title: 'ApplicationTimelines', description: 'Community-reported processing experiences.' },
];
export function topicCollections(value: unknown) {
  const tags = value && typeof value === 'object' && 'tags' in value ? value.tags : null;
  if (!Array.isArray(tags) || tags.length > 200) throw new Error('Invalid topics');
  return TOPICS.flatMap(topic => {
    const row = tags.find(row => row && row.tag === topic.tag);
    return row && Number.isSafeInteger(row.count) && row.count > 0
      ? [{ ...topic, count: row.count as number, href: `/?tag=${topic.tag}` }] : [];
  });
}

export function TopicCollectionCards({ topics }: { topics: ReturnType<typeof topicCollections> }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{topics.map(topic => <Link key={topic.tag} href={topic.href} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:bg-blue-50/40">
    <span className="text-xs font-semibold text-blue-700">{topic.count.toLocaleString('en-US')} existing discussions</span>
    <h3 className="mt-2 break-words text-thread-title font-semibold text-slate-950 group-hover:text-blue-800">{topic.title}</h3>
    <p className="mt-1 text-base leading-6 text-slate-600">{topic.description}</p>
    <span className="mt-3 block text-sm font-semibold text-blue-700 capitalize">Browse Discussions →</span>
  </Link>)}</div>;
}

export function TopicCollections() {
  const [topics, setTopics] = useState<ReturnType<typeof topicCollections> | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setError(false); setTopics(null);
    const timer = setTimeout(() => controller.abort(), 10_000);
    void fetch('/api/tags', { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) throw new Error('Topics unavailable');
      const rows = topicCollections(await response.json());
      if (active) setTopics(rows);
    }).catch(() => { if (active) setError(true); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [retry]);
  return <section aria-labelledby="topic-collections" className="mt-6 rounded-xl bg-slate-50 p-4 sm:p-5">
    <h2 id="topic-collections" className="text-thread-title font-semibold text-slate-950 capitalize">Browse U.S. Visa Topics</h2>
    <p className="mt-1 text-base leading-6 text-slate-600 capitalize">Start with real discussions already here. These topic collections are separate from member-created communities below.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-slate-600 capitalize">Topic counts are temporarily unavailable. <button onClick={() => setRetry(value => value + 1)} className="font-semibold text-blue-700 underline capitalize">Retry</button> or <Link href="/tags" className="font-semibold text-blue-700 underline capitalize">browse all tags</Link>.</p>
      : topics ? <>{topics.length ? <TopicCollectionCards topics={topics} /> : <p className="mt-3 text-sm text-slate-600 capitalize">No topic collections are available yet. <Link href="/" className="text-blue-700 underline capitalize">Browse recent discussions</Link>.</p>}</>
      : <p role="status" className="mt-4 text-sm text-slate-500 capitalize">Loading topic collections…</p>}
  </section>;
}
