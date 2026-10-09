export const TAG_RULES: Array<[string, RegExp]> = [
  ['h1b', /\bh[ -]?1b\b/i],
  ['h4', /\bh[ -]?4\b/i],
  ['ead', /\bead\b|employment authorization/i],
  ['opt', /\bopt\b|optional practical training/i],
  ['f1', /\bf[ -]?1\b/i],
  ['cpt', /\bcpt\b|curricular practical training/i],
  ['i-140', /\bi[ -]?140\b/i],
  ['uscis', /\buscis\b/i],
  ['lottery', /\blottery\b|registration selection/i],
  ['transfer', /\btransfer\b|change of employer/i],
  ['premium-processing', /premium processing/i],
  ['rfe', /\brfe\b|request for evidence/i],
  ['ds-160', /\bds[ -]?160\b/i],
  ['b1-b2', /\bb[ -]?1\/?b[ -]?2\b/i],
  ['interview', /\binterview\b|appointment slot/i],
  ['stamping', /\bstamping\b|visa stamp/i],
  ['biometrics', /\bbiometric/i],
  ['work-permit', /work (?:visa|permit)/i],
  ['study-permit', /study permit/i],
  ['canada', /\bcanada\b/i],
  ['schengen', /\bschengen\b/i],
  ['timeline', /\btimeline\b|how long|waiting/i],
];

const TAG_SYNONYMS: Record<string, string> = {
  'h-1b': 'h1b', 'h 1 b': 'h1b', 'h1-b': 'h1b',
  'h-4': 'h4', 'h 4': 'h4',
  'f-1': 'f1', 'f 1': 'f1',
  'i140': 'i-140', 'i 140': 'i-140',
  'ds160': 'ds-160', 'ds 160': 'ds-160',
  'b1/b2': 'b1-b2', 'b1 b2': 'b1-b2',
  'premium processing': 'premium-processing',
  'work permit': 'work-permit', 'study permit': 'study-permit',
};

export function normalizeTag(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const synonym = TAG_SYNONYMS[cleaned];
  return (synonym ?? cleaned).replace(/&/g, 'and').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeTags(values: string[]): string[] {
  return [...new Set(values.map(normalizeTag).filter(Boolean))].slice(0, 5);
}

export function inferTags(body: string): string[] {
  const tags = detectTopics(body);
  return [...new Set(tags.length ? tags : ['visa-question'])].slice(0, 5);
}

export function detectTopics(body: string): string[] {
  return TAG_RULES.filter(([, pattern]) => pattern.test(body)).map(([tag]) => tag);
}

export function suggestTags(body: string): string[] {
  const normalized = body.trim();
  return normalized.length >= 8 ? inferTags(normalized).filter((tag) => tag !== 'visa-question') : [];
}
