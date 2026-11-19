export const EXPERIENCE_FIELDS = [
  { key: 'timeline', label: 'Timeline', maxLength: 1000, placeholder: 'Dates or approximate waiting times, if you want to share them.' },
  { key: 'location', label: 'City or processing office', maxLength: 200, placeholder: 'For example: Hyderabad consulate, or the processing office.' },
  { key: 'outcome', label: 'Outcome or current status', maxLength: 1000, placeholder: 'What happened, or what are you still waiting for?' },
  { key: 'tips', label: 'Tips for others', maxLength: 1500, placeholder: 'What would you do differently or recommend preparing?' },
] as const;

export type ExperienceFields = Partial<Record<typeof EXPERIENCE_FIELDS[number]['key'], string>>;

export function readExperienceFields(value: unknown): ExperienceFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const fields: ExperienceFields = {};
  for (const field of EXPERIENCE_FIELDS) {
    const text = Object.hasOwn(value, field.key) ? (value as Record<string, unknown>)[field.key] : undefined;
    if (typeof text === 'string') fields[field.key] = text.slice(0, field.maxLength);
  }
  // Drafts saved before "Documents used" was removed keep that text under Tips.
  const documents = (value as Record<string, unknown>).documents;
  if (typeof documents === 'string' && documents.trim()) {
    fields.tips = [`Documents: ${documents.trim()}`, fields.tips?.trim()].filter(Boolean).join('\n\n').slice(0, 1500);
  }
  return fields;
}

export function experienceStoryPrompt(visa: string): string {
  if (visa === 'F-1 / OPT') return 'Describe your F1 interview, OPT/STEM OPT application, travel, or student visa experience in your own words.';
  if (visa === 'H-1B') return 'Describe your H1B interview, stamping, transfer, extension, or work visa experience in your own words.';
  if (visa === 'H-4 / EAD') return 'Describe your H4 EAD application, renewal, biometrics, or work authorization experience in your own words.';
  if (visa === 'H-4') return 'Describe your H4 application, interview, stamping, or dependent visa experience in your own words.';
  if (visa === 'B1/B2') return 'Describe your visitor visa application, interview, or travel experience in your own words.';
  if (visa === 'Family / spouse') return 'Describe your family or spouse visa application, interview, or arrival experience in your own words.';
  return 'Describe what happened during your visa application, interview, or travel in your own words.';
}

export function buildExperienceBody(body: string, fields: ExperienceFields): string {
  const section = (key: typeof EXPERIENCE_FIELDS[number]['key']) => {
    const field = EXPERIENCE_FIELDS.find(item => item.key === key)!;
    const text = fields[key]?.trim();
    return text ? `${field.label}\n${text}` : '';
  };
  if (!EXPERIENCE_FIELDS.some(field => fields[field.key]?.trim())) return body.trim();
  return [section('timeline'), section('location'), body.trim() ? `My experience\n${body.trim()}` : '', section('outcome'), section('tips')].filter(Boolean).join('\n\n');
}

/** Speaker markers for writing an interview as a conversation. */
export const SPEAKER_LINES = { me: '🔹Me: ', vo: '🔻VO: ' } as const;

/** Insert a speaker line at the caret, always starting on its own line. */
export function insertSpeakerLine(text: string, caret: number, speaker: keyof typeof SPEAKER_LINES): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at), after = text.slice(at);
  const line = `${before && !before.endsWith('\n') ? '\n' : ''}${SPEAKER_LINES[speaker]}`;
  return { text: before + line + after, caret: at + line.length };
}

/** A fill-in outline for visa interview experiences. Officer details are limited
 * to gender and approximate age: never race or other sensitive traits. */
export function interviewTemplate(visa: string): string {
  const student = visa === 'F-1 / OPT';
  return [
    ['Interview details', 'Consulate:', `${student ? 'F1 intake' : 'Visa type'}: ${student ? '' : visa.replace(/-/g, '')}`.trimEnd(), 'Interview date:', 'Counter:', 'In time / Out time:', 'Duration:', 'Number of questions:', 'Officer (gender and approximate age only):', 'Visa status:', 'Attempt:'].join('\n'),
    ...(student ? [
      ['University details', 'University:', 'Program:'].join('\n'),
      ['Your profile', 'Highest degree:', 'University or college:', 'City and state:', 'CGPA:', 'GRE:', 'TOEFL / Duolingo / IELTS / PTE:'].join('\n'),
    ] : []),
    ['Dress', 'What did you wear?'].join('\n'),
    ['Interview experience', `${SPEAKER_LINES.me}Good morning, officer.`, `${SPEAKER_LINES.vo}Good morning.`].join('\n'),
  ].join('\n\n');
}

/** Example titles that show what a specific, useful experience title looks like. */
export function experienceTitlePlaceholder(category: string, visaLabel: string): string {
  switch (category) {
    case 'Visa interview': return `e.g. ${visaLabel} interview in Hyderabad, approved on 2nd attempt`;
    case 'Application & documents': return `e.g. ${visaLabel} application: documents and steps that worked`;
    case 'Approval & timeline': return `e.g. ${visaLabel} approved after 3 months: my timeline`;
    case 'Refusal & reapplication': return `e.g. ${visaLabel} refused under 214(b), approved on reapplying`;
    case 'Renewal & extension': return `e.g. ${visaLabel} extension: what the renewal involved`;
    case 'Travel & arrival': return `e.g. Arriving on ${visaLabel}: port of entry questions`;
    default: return `e.g. My ${visaLabel} experience`;
  }
}
