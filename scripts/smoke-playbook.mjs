const ORIGIN = 'https://visathreads.com';
export const PLAYBOOK_GUIDE_CHECKS = [
  { slug: 'h1b-petition-visa-status', title: 'H-1B: separate your petition, visa and status questions', source: 'https://travel.state.gov/content/travel/en/us-visas/employment/temporary-worker-visas.html' },
  { slug: 'f1-opt-planning-questions', title: 'F-1 and OPT: a planning checklist for your DSO conversation', source: 'https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html' },
  { slug: 'b1-b2-visitor-visa-preparation', title: 'B1/B2: organize your visitor-visa questions before applying', source: 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html' },
];

function requireCheck(condition, check) {
  // Do not put source content, titles or owner-record values into release logs.
  if (!condition) throw new Error(`Playbook ${check} verification failed.`);
}
function decodeHtml(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27|#x[0-9a-f]+|#\d+);/gi, entity => {
    const known = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'" };
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
    const point = Number.parseInt(entity.slice(entity[2].toLowerCase() === 'x' ? 3 : 2, -1), entity[2].toLowerCase() === 'x' ? 16 : 10);
    return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(([, name, double, single]) => [name.toLowerCase(), decodeHtml(double ?? single)]));
}
function visible(html) {
  return decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function checkMetadata(html, path, title, label) {
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag)).filter(tag => tag.rel === 'canonical');
  requireCheck(canonicals.length === 1 && canonicals[0].href === new URL(path, ORIGIN).href, `${label}-canonical`);
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(([, value]) => decodeHtml(value));
  requireCheck(titles.length === 1 && titles[0] === `${title} · VisaThreads`, `${label}-title`);
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag)).find(tag => tag.name === 'robots');
  requireCheck(robots && /\bnoindex\b/.test(robots.content ?? ''), `${label}-preview-noindex`);
}
function hasLink(html, href) {
  return [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) => attributes(tag).href === href);
}

/** Seven extra public requests per complete rollout round. All use its existing
 * bounded provenance-aware probe; no accounts, sessions, writes or private reads. */
export async function verifyPlaybookPages(probe, feed) {
  async function page(label, path) {
    const response = await probe.request(`playbook:${label}`, path);
    requireCheck(response.headers.get('content-type')?.includes('text/html'), `${label}-html`);
    requireCheck(response.headers.get('cache-control')?.includes('no-store'), `${label}-uncached`);
    requireCheck(response.headers.get('x-robots-tag')?.includes('noindex'), `${label}-preview-header`);
    const html = await response.text();
    requireCheck(html.length < 2_000_000 && !html.includes('sb_secret_'), `${label}-document`);
    return html;
  }
  const index = await page('guides', '/guides?sort=unanswered');
  checkMetadata(index, '/guides', 'U.S. Visa Guides and Official Resources', 'guides');
  requireCheck(visible(index).includes('U.S. Visa Guides'), 'guides-visible-heading');
  for (const guide of PLAYBOOK_GUIDE_CHECKS) {
    requireCheck(hasLink(index, `/guides/${guide.slug}`), 'guides-navigation');
    const html = await page(`guide-${guide.slug}`, `/guides/${guide.slug}`);
    checkMetadata(html, `/guides/${guide.slug}`, guide.title, 'guide');
    const text = visible(html);
    requireCheck(text.includes(guide.title) && text.includes('Your preparation checklist') && text.includes('Official references'), 'guide-visible-content');
    requireCheck(hasLink(html, guide.source) && hasLink(html, '/contact'), 'guide-source-and-correction');
  }
  const about = await page('about', '/about');
  checkMetadata(about, '/about', 'About VisaThreads', 'about');
  requireCheck(visible(about).includes('independent community') && hasLink(about, '/guides') && hasLink(about, '/contact'), 'about-scope-and-links');

  const owner = await page('owner-launch-shell', '/admin/launch');
  const shell = visible(owner);
  requireCheck(shell.includes('Private to the designated owner') && /Checking your account|Owner sign-in required/.test(shell), 'owner-signed-out-shell');
  requireCheck(!/id=["']task-|\bSave task\b|\bNew experiment\b|\bRevision \d+/.test(owner), 'owner-no-record-controls');
  requireCheck(!/\\?"(?:tasks|experiments|evidence|assigned_to|cash_cost_usd|attributable_contribution_usd)\\?"\s*:/.test(owner), 'owner-no-record-payload');

  const imported = feed?.questions?.find(row => /^apify-[a-zA-Z0-9_-]{1,160}$/.test(row.id)
    && row.status !== 'archived' && row.post_kind !== 'experience' && row.destination_country === 'United States'
    && typeof row.body === 'string' && row.body.trim().length >= 40 && typeof row.title === 'string');
  requireCheck(imported, 'imported-fixture-available');
  const path = `/questions/${imported.id}`;
  const thread = await page('imported-thread', path);
  checkMetadata(thread, path, imported.title, 'imported-thread');
  const text = visible(thread);
  requireCheck(text.includes(imported.title.replace(/\s+/g, ' ').trim())
    && text.includes(imported.body.replace(/\s+/g, ' ').trim().slice(0, 160)), 'imported-server-content');
  requireCheck(!thread.includes('application/ld+json'), 'imported-no-fabricated-schema');
}
