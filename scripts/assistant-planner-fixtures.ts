import type { AssistantRequest, AssistantTurnPlan } from '../src/lib/assistant-contract';

// Fixed before hosted testing. These expectations are never supplied to the model.
const history = [{ question: 'Show recent STEM OPT application discussions.', answer: 'Displayed two discussions about STEM OPT application processing.' }];
const refs = [1, 2].map(n => ({ questionId: `apify-planner-${n}`, sourceId: `q:apify-planner-${n}` }));
type Fixture = { id: string; input: AssistantRequest; action: AssistantTurnPlan['action']; required: RegExp[]; excluded?: RegExp[]; focus?: number | null };
const followup = (question: string): AssistantRequest => ({ mode: 'ask', scope: { kind: 'public' }, question, conversation: history, previousPosts: refs });
export const plannerFixtures: Fixture[] = [
  { id: 'gist', input: followup('Give me the gist.'), action: 'reuse', required: [/stem\s*opt/i], focus: null },
  { id: 'longest', input: followup('Who had the longest wait among those people?'), action: 'reuse', required: [/wait|longest|processing/i], focus: null },
  { id: 'constraint', input: followup('Only include applicants who used premium processing.'), action: 'retrieve', required: [/stem\s*opt/i, /premium/i] },
  { id: 'negation', input: followup('Now find cases without premium processing.'), action: 'retrieve', required: [/stem\s*opt/i, /without|not|non-premium|regular|standard/i] },
  { id: 'translation', input: followup('Can you put that in Hindi, briefly?'), action: 'reuse', required: [/hindi/i], focus: null },
  { id: 'new-topic', input: followup('Different topic: B2 visitor interview experiences in Mumbai.'), action: 'retrieve', required: [/b[ -]?2/i, /mumbai/i], excluded: [/stem|opt|premium/i] },
  { id: 'period-comparison', input: followup('Compare these with posts from last month.'), action: 'retrieve', required: [/stem\s*opt/i, /last month|previous month/i] },
  { id: 'unknown-reference', input: { ...followup('Explain what happened to the third person.'), previousPosts: [], conversation: [{ question: 'Hello', answer: 'What would you like to discuss?' }] }, action: 'clarify', required: [] },
  { id: 'aggregate', input: followup('Exactly how many STEM OPT posts were created across the entire website last month?'), action: 'clarify', required: [] },
  { id: 'ordinal', input: followup('Tell me what happened in the second discussion.'), action: 'reuse', required: [], focus: 1 },
  { id: 'location-correction', input: { ...followup('Sorry, I meant Chennai, not Delhi.'), conversation: [{ question: 'Summarize H1B stamping experiences in Delhi.', answer: 'Displayed H1B stamping reports from Delhi.' }] }, action: 'retrieve', required: [/h[ -]?1[ -]?b/i, /chennai/i, /stamp/i] },
  { id: 'clarification-answer', input: { ...followup('The H4 one, in Hyderabad.'), conversation: [{ question: 'Any interview experiences?', answer: 'Which visa type and location do you mean?' }], previousPosts: [] }, action: 'retrieve', required: [/h[ -]?4/i, /hyderabad/i, /interview/i] },
];

export function evaluatePlanner(fixture: Fixture, plan: AssistantTurnPlan) {
  const checks = [
    { name: 'action', passed: plan.action === fixture.action },
    { name: 'context_retained', passed: fixture.required.every(pattern => pattern.test(plan.query)) },
    { name: 'old_topic_removed', passed: !(fixture.excluded ?? []).some(pattern => pattern.test(plan.query)) },
    { name: 'reference', passed: fixture.focus === undefined || plan.focus === fixture.focus },
  ];
  return { id: fixture.id, passed: checks.every(check => check.passed), checks };
}
