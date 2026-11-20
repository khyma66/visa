export const VISA_TYPES = ['H-1B', 'H-4', 'H-4 / EAD', 'B1/B2', 'F-1 / OPT', 'Family / spouse', 'General', 'Other'];
export const EXPERIENCE_CATEGORIES = ['Visa interview', 'Application & documents', 'Approval & timeline', 'Refusal & reapplication', 'Renewal & extension', 'Travel & arrival', 'Other'];

// Ordered: the most specific status wins (an H-4 EAD question also mentions H-4;
// a STEM OPT question that mentions an H-1B petition is still a student question
// when the student status is the subject).
const VISA_SIGNALS: [string, RegExp][] = [
  ['H-4 / EAD', /\bh[\s-]?4\b[^.?!\n]{0,40}\bead\b|\bead\b[^.?!\n]{0,40}\bh[\s-]?4\b/i],
  ['F-1 / OPT', /\b(?:stem[\s-]?opt|opt|cpt|f[\s-]?1|sevis|i[\s-]?20|dso|cap[\s-]?gap)\b/i],
  ['H-1B', /\bh[\s-]?1[\s-]?b\b|\bh1\b|\blca\b|\bi[\s-]?129\b|\bh1b\b/i],
  ['H-4', /\bh[\s-]?4\b/i],
  ['B1/B2', /\bb[\s-]?1\s*\/?\s*b[\s-]?2\b|\bb[\s-]?[12]\b|\bvisitor visa\b|\btourist visa\b/i],
  ['Family / spouse', /\b(?:spouse|i[\s-]?130|k[\s-]?1|fianc[eé]e?|cr[\s-]?1|ir[\s-]?1|marriage[\s-]based)\b/i],
];

/** Best guess of the visa a post is about, from its own words. Empty when unclear. */
export function inferVisaType(text: string): string {
  const signals = VISA_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([visa]) => visa);
  if (!signals.length) return '';
  // OPT/STEM questions often mention a pending H-1B; the student status is the subject.
  if (signals.includes('F-1 / OPT') && /\b(?:stem[\s-]?opt|opt|cpt|sevis|i[\s-]?20)\b/i.test(text)) return 'F-1 / OPT';
  return signals[0];
}
