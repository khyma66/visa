import type { Answer, Conversation, DirectMessage, Profile, Question } from './types';

export const DEMO_USER: Profile = {
  id: 'demo-current',
  username: 'quiet-otter-4821',
  avatar_seed: 'quiet-otter',
  bio: 'Learning the visa process one form at a time.',
  reputation: 86,
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export const DEMO_QUESTIONS: Question[] = [
  {
    id: 'q-h1b-transfer', author_id: 'user-raven', author_username: 'wise-raven-1840',
    author_avatar_seed: 'wise-raven',
    title: 'Can I start an H-1B transfer before the receipt notice arrives?',
    body: 'My new employer filed an H-1B transfer with premium processing. The package was delivered, but we do not have the receipt notice yet. Can I legally begin work based on the delivery confirmation, or should I wait for the receipt number?',
    destination_country: 'United States', visa_type: 'H-1B', tags: ['h1b', 'transfer', 'employment'],
    status: 'open', vote_score: 34, answer_count: 3, view_count: 1284,
    accepted_answer_id: 'a-h1b-1', created_at: daysAgo(2), updated_at: daysAgo(1),
  },
  {
    id: 'q-ds160', author_id: 'user-lotus', author_username: 'hidden-lotus-7302',
    author_avatar_seed: 'hidden-lotus',
    title: 'DS-160 submitted with an old travel date — do I need a new form?',
    body: 'My B1/B2 appointment was moved by four months and the intended travel date on my submitted DS-160 is now in the past. All other information is still correct. Should I submit a new DS-160 and update the confirmation number?',
    destination_country: 'United States', visa_type: 'B1/B2', tags: ['ds160', 'interview', 'tourist-visa'],
    status: 'open', vote_score: 21, answer_count: 2, view_count: 842,
    accepted_answer_id: null, created_at: daysAgo(3), updated_at: daysAgo(3),
  },
  {
    id: 'q-f1-opt', author_id: 'user-falcon', author_username: 'swift-falcon-2914',
    author_avatar_seed: 'swift-falcon',
    title: 'F-1 OPT EAD approved but card has not arrived after three weeks',
    body: 'USCIS shows my post-completion OPT as approved, but the EAD card tracking has not updated for three weeks. My planned start date is approaching. What steps should I take and can I work with the approval notice alone?',
    destination_country: 'United States', visa_type: 'F-1 / OPT', tags: ['f1', 'opt', 'ead'],
    status: 'open', vote_score: 18, answer_count: 4, view_count: 624,
    accepted_answer_id: 'a-opt-1', created_at: daysAgo(5), updated_at: daysAgo(2),
  },
  {
    id: 'q-schengen', author_id: 'user-comet', author_username: 'cosmic-comet-5561',
    author_avatar_seed: 'cosmic-comet',
    title: 'Which Schengen country should receive my application for a split itinerary?',
    body: 'I will spend four nights in France, four in Italy, and enter through the Netherlands for one night. The trip is continuous. Which consulate is responsible when the two main destinations have the same number of nights?',
    destination_country: 'Schengen Area', visa_type: 'Schengen', tags: ['schengen', 'itinerary', 'consulate'],
    status: 'open', vote_score: 15, answer_count: 2, view_count: 491,
    accepted_answer_id: null, created_at: daysAgo(7), updated_at: daysAgo(7),
  },
  {
    id: 'q-canada-pof', author_id: 'user-panda', author_username: 'calm-panda-9083',
    author_avatar_seed: 'calm-panda',
    title: 'How should a recent large deposit be explained for a Canada study permit?',
    body: 'My parents transferred tuition and living funds into my account two months before the study permit application. I have their bank statements and a gift deed. What evidence is usually helpful to explain the source of funds clearly?',
    destination_country: 'Canada', visa_type: 'Study permit', tags: ['canada', 'proof-of-funds', 'student'],
    status: 'open', vote_score: 12, answer_count: 1, view_count: 307,
    accepted_answer_id: null, created_at: daysAgo(9), updated_at: daysAgo(9),
  },
];

export const DEMO_ANSWERS: Answer[] = [
  {
    id: 'a-h1b-1', question_id: 'q-h1b-transfer', author_id: 'user-panda', author_username: 'calm-panda-9083',
    author_avatar_seed: 'calm-panda', vote_score: 19, is_accepted: true, status: 'active',
    body: 'Portability can allow an eligible H-1B worker to begin after USCIS receives a properly filed, non-frivolous petition. In practice, confirm the delivery and filing details with the employer’s immigration counsel before changing payroll; a courier delivery event is not by itself proof that every portability condition is met.',
    created_at: daysAgo(1.8), updated_at: daysAgo(1.8),
  },
  {
    id: 'a-h1b-2', question_id: 'q-h1b-transfer', author_id: DEMO_USER.id, author_username: DEMO_USER.username,
    author_avatar_seed: DEMO_USER.avatar_seed, vote_score: 7, is_accepted: false, status: 'active',
    body: 'My attorney gave me the complete filing copy and written confirmation of the received date before I started. Ask what evidence HR will keep in the I-9 file and whether your current status and last entry create any special issue.',
    created_at: daysAgo(1.2), updated_at: daysAgo(1.2),
  },
  {
    id: 'a-opt-1', question_id: 'q-f1-opt', author_id: 'user-lotus', author_username: 'hidden-lotus-7302',
    author_avatar_seed: 'hidden-lotus', vote_score: 11, is_accepted: true, status: 'active',
    body: 'Report the non-delivery through the USCIS card-delivery process and check the tracking address with USPS. The approval notice generally does not replace the EAD for employment authorization verification, so coordinate the start date with your DSO and employer rather than assuming you can begin.',
    created_at: daysAgo(3), updated_at: daysAgo(3),
  },
];

export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: 'c-raven', other_user_id: 'user-raven', other_username: 'wise-raven-1840', other_avatar_seed: 'wise-raven',
    last_message: 'That checklist cleared up the timeline. Thank you!', last_message_created_at: daysAgo(0.1),
    last_message_at: daysAgo(0.1), unread_count: 1,
  },
  {
    id: 'c-lotus', other_user_id: 'user-lotus', other_username: 'hidden-lotus-7302', other_avatar_seed: 'hidden-lotus',
    last_message: 'I found an earlier appointment slot.', last_message_created_at: daysAgo(1),
    last_message_at: daysAgo(1), unread_count: 0,
  },
];

export const DEMO_MESSAGES: DirectMessage[] = [
  { id: 'm1', conversation_id: 'c-raven', sender_id: DEMO_USER.id, body: 'I wrote down the filing and start-date checklist we discussed.', read_at: daysAgo(0.2), created_at: daysAgo(0.3) },
  { id: 'm2', conversation_id: 'c-raven', sender_id: 'user-raven', body: 'That checklist cleared up the timeline. Thank you!', read_at: null, created_at: daysAgo(0.1) },
  { id: 'm3', conversation_id: 'c-lotus', sender_id: DEMO_USER.id, body: 'Any luck moving your appointment?', read_at: daysAgo(1), created_at: daysAgo(1.2) },
  { id: 'm4', conversation_id: 'c-lotus', sender_id: 'user-lotus', body: 'I found an earlier appointment slot.', read_at: daysAgo(1), created_at: daysAgo(1) },
];
