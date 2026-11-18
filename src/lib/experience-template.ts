export const EXPERIENCE_FIELDS = [
  { key: 'timeline', label: 'Timeline', maxLength: 1000, placeholder: 'Dates or approximate waiting times, if you want to share them.' },
  { key: 'location', label: 'City or processing office', maxLength: 200, placeholder: 'For example: Hyderabad consulate, or the processing office.' },
  { key: 'documents', label: 'Documents used', maxLength: 1500, placeholder: 'Which documents were requested or useful?' },
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
  return [section('timeline'), section('location'), section('documents'), body.trim() ? `My experience\n${body.trim()}` : '', section('outcome'), section('tips')].filter(Boolean).join('\n\n');
}
