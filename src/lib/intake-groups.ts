import { getSupabase, isSupabaseConfigured } from './supabase/client';

/** Visa types that have university intake groups, in the order of their sub-tabs. */
export const GROUP_VISA_TYPES = ['F-1 / OPT', 'H-1B', 'H-4', 'H-4 / EAD', 'B1/B2'] as const;
export type GroupVisaType = typeof GROUP_VISA_TYPES[number];
export type IntakeTerm = 'spring' | 'fall';
export type Intake = { term: IntakeTerm; year: number; label: string; key: string };
export type IntakeGroup = { id: string; slug: string; display_name: string; university: string; member_count: number };
export type CreatedIntakeGroup = { id: string; slug: string; created: boolean };

// Spring classes start in January and Fall classes in August. An intake stays
// listed through its start month, while new arrivals are still looking for it.
const TERMS: [IntakeTerm, number][] = [['spring', 1], ['fall', 8]];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const UNIVERSITY = /^[A-Za-z0-9][A-Za-z0-9 .,&'()-]*$/;

export function visaTabLabel(visa: string) { return visa.replace(/-/g, ''); }
export function intakeLabel(term: IntakeTerm, year: number) { return `${term === 'spring' ? 'Spring' : 'Fall'} ${year}`; }

/** The next `count` intakes (about 18 months ahead) from `now`, soonest first; never a fixed year. */
export function upcomingIntakes(now = new Date(), count = 3): Intake[] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const result: Intake[] = [];
  for (let offset = 0; result.length < count; offset++) {
    for (const [term, start] of TERMS) {
      const intakeYear = year + offset;
      if (offset === 0 && month > start) continue;
      if (result.length < count) result.push({ term, year: intakeYear, label: intakeLabel(term, intakeYear), key: `${term}-${intakeYear}` });
    }
  }
  return result;
}

export function normalizeUniversity(value: string) {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 60 || !UNIVERSITY.test(clean) || clean.replace(/[^A-Za-z]/g, '').length < 3)
    throw new Error('Enter the university name using 3–60 letters, numbers or basic punctuation.');
  return clean;
}

function client() {
  if (!isSupabaseConfigured) throw new Error('Groups are unavailable until the community service is connected.');
  return getSupabase();
}

function apiError(error: { code?: string; message?: string }, fallback: string) {
  const message = error.message ?? '';
  if (message.includes('acknowledge')) return new Error('Review and accept the current community policies in your account, then try again.');
  if (message.includes('Too many requests')) return new Error('You have created several groups today. Please try again tomorrow.');
  if (message.includes('Account changed')) return new Error('Your account changed in another tab. Reload the page and try again.');
  if (error.code === '23505') return new Error('A community with this name already exists. Search for it in Explore Communities.');
  if (error.code === '22023' && message) return new Error(message.endsWith('.') ? message : `${message}.`);
  if (error.code === '42501' || error.code === 'PGRST301') return new Error('Log in again to create a group.');
  if (error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703') return new Error('Groups are not available on this environment yet. Please try again later.');
  return new Error(fallback);
}

/** Only F-1 groups have Spring/Fall intakes; other visa groups are by university. */
export const INTAKE_VISA = 'F-1 / OPT';
export function hasIntakes(visa: string) { return visa === INTAKE_VISA; }

function checkIntake(visa: string, intake: Pick<Intake, 'term' | 'year'> | null) {
  if (!GROUP_VISA_TYPES.includes(visa as GroupVisaType)) throw new Error('Choose a supported visa type.');
  if (!hasIntakes(visa)) { if (intake) throw new Error('Intakes apply to F-1 groups only.'); return; }
  if (!intake || (intake.term !== 'spring' && intake.term !== 'fall')) throw new Error('Choose a Spring or Fall intake.');
  if (!Number.isInteger(intake.year)) throw new Error('Choose an upcoming intake.');
}

export async function listIntakeGroups(visa: string, intake: Pick<Intake, 'term' | 'year'> | null, signal?: AbortSignal): Promise<IntakeGroup[]> {
  checkIntake(visa, intake);
  let query = client().from('community_directory').select('id,slug,display_name,university,member_count').eq('group_visa_type', visa);
  query = intake ? query.eq('intake_term', intake.term).eq('intake_year', intake.year) : query.is('intake_term', null);
  query = query.order('member_count', { ascending: false }).order('slug', { ascending: true }).limit(24);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw apiError(error, 'Groups could not be loaded. Please retry.');
  return (data ?? []) as IntakeGroup[];
}

/** Returns the existing group when one already matches this visa, intake (F-1 only) and university. */
export async function createIntakeGroup(input: { visa: string; intake: Pick<Intake, 'term' | 'year'> | null; university: string; expectedUser: string }): Promise<CreatedIntakeGroup> {
  checkIntake(input.visa, input.intake);
  const university = normalizeUniversity(input.university);
  if (!UUID.test(input.expectedUser)) throw new Error('Log in again to create a group.');
  const { data, error } = await client().rpc('create_intake_group', {
    target_visa: input.visa, target_term: input.intake?.term ?? null, target_year: input.intake?.year ?? null,
    university_name: university, expected_user: input.expectedUser,
  });
  if (error) throw apiError(error, 'The group could not be created. Please retry.');
  const result = data as CreatedIntakeGroup | null;
  if (!result || !UUID.test(result.id) || !SLUG.test(result.slug) || typeof result.created !== 'boolean')
    throw new Error('The group service returned an invalid result. Check the group list before retrying.');
  return result;
}
