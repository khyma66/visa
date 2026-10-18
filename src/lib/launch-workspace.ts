export const LAUNCH_STATUSES = {
  backlog: 'Backlog', ready: 'Ready', in_progress: 'In progress',
  in_review: 'In review', done: 'Done', blocked: 'Blocked',
} as const;
export const EXPERIMENT_DECISIONS = { observe: 'Keep observing', scale: 'Scale', fix: 'Improve', stop: 'Stop' } as const;
export type LaunchStatus = keyof typeof LAUNCH_STATUSES;
export type ExperimentDecision = keyof typeof EXPERIMENT_DECISIONS;
export type LaunchTaskDefinition = {
  id: string; title: string; priority: 'P0' | 'P1' | 'P2'; dependencies: string[]; acceptance: string;
};
export type LaunchTask = LaunchTaskDefinition & {
  status: LaunchStatus; evidence: string; assigned_to: string; due_on: string | null;
  version: number; completed_at: string | null; created_at: string; updated_at: string;
};
export type LaunchTaskPatch = Pick<LaunchTask, 'status' | 'evidence' | 'assigned_to' | 'due_on'>;
export type LaunchExperimentInput = {
  title: string; hypothesis: string; start_on: string; end_on: string;
  cash_cost_usd: number; founder_hours: number; hour_value_usd: number;
  /** Realized, attributable contribution after customer-linked costs; null means unknown. */
  attributable_contribution_usd: number | null;
  decision: ExperimentDecision; notes: string;
};
export type LaunchExperiment = LaunchExperimentInput & {
  id: string; currency: 'USD'; version: number; created_at: string; updated_at: string;
};
export type LaunchWorkspace = { schema_version: 1; generated_at: string; tasks: LaunchTask[]; experiments: LaunchExperiment[] };
export type LaunchHistoryEvent = {
  id: number; entity_kind: 'task' | 'experiment'; entity_id: string;
  action: 'task_update' | 'experiment_create' | 'experiment_update';
  snapshot: LaunchTask | LaunchExperiment; created_at: string;
};

// The database seeds these reviewed definitions. No task starts completed, and
// recording evidence here never changes hosting, billing or launch flags.
export const LAUNCH_TASK_DEFINITIONS: LaunchTaskDefinition[] = [
  { id: 'L01', title: 'Confirm operator and launch scope', priority: 'P0', dependencies: [], acceptance: 'Record the actual legal operator, monitored contact, adult U.S. scope, production domain and service inventory in the reviewed operating record.' },
  { id: 'L02', title: 'Verify account ownership and credential recovery', priority: 'P0', dependencies: ['L01'], acceptance: 'Verify administrator MFA, recovery and domain renewals; document credential rotation without pasting credentials or recovery codes.' },
  { id: 'L03', title: 'Verify domain and sign-in journeys', priority: 'P0', dependencies: ['L02'], acceptance: 'Verify canonical HTTPS links, email delivery, signup, confirmation, recovery, logout and enabled OAuth on the live domain.' },
  { id: 'L04', title: 'Verify private access and abuse controls', priority: 'P0', dependencies: ['L03'], acceptance: 'Run cross-account, anonymous and revoked-session checks for private records, owner tools, bot protection and enabled write paths.' },
  { id: 'L05', title: 'Finalize privacy and community policies', priority: 'P0', dependencies: ['L01'], acceptance: 'Review actual vendors, retention, age policy, optional tracking and legal applicability; publish accurate policies with versioned acceptance.' },
  { id: 'L06', title: 'Rehearse privacy requests and content removal', priority: 'P0', dependencies: ['L04', 'L05'], acceptance: 'Complete an identity-verified export/deletion and takedown rehearsal, including sessions, imported-content suppression, caches and backup exceptions.' },
  { id: 'L07', title: 'Staff moderation and contributor support', priority: 'P0', dependencies: ['L05'], acceptance: 'Assign real moderators and a monitored support owner; test no-account reports, appeals and sensitive-data escalation.' },
  { id: 'L08', title: 'Rehearse recovery and incident response', priority: 'P0', dependencies: ['L04'], acceptance: 'Verify backup restoration, scoped rollback, alert delivery, incident responsibilities and an initial operating-cost ceiling.' },
  { id: 'S01', title: 'Verify public search templates and crawler policy', priority: 'P1', dependencies: ['L04', 'L06'], acceptance: 'Check real server-rendered public content, stable canonical links, accurate structured data and sitemap lifecycle; keep private pages and previews excluded.' },
  { id: 'S02', title: 'Verify search ownership and submit sitemap', priority: 'P1', dependencies: ['S01', 'L09'], acceptance: 'Verify Google Search Console and Bing ownership using issued records, submit the approved canonical sitemap and inspect representative pages.' },
  { id: 'A01', title: 'Reconcile owner metrics and exclusions', priority: 'P1', dependencies: ['L04'], acceptance: 'Reconcile retained activity with source records, designate test/staff exclusions, and document UTC periods, missing metrics and distinct-user definitions.' },
  { id: 'C01', title: 'Recruit a narrow genuine contributor cohort', priority: 'P1', dependencies: ['L07'], acceptance: 'Recruit answerers for two or three U.S. visa topics and prepare original, dated resources; do not publish fabricated experiences or fake member activity.' },
  { id: 'AI01', title: 'Review enabled AI quality and cost limits', priority: 'P1', dependencies: ['L04', 'L05'], acceptance: 'Record source-linked quality, conflicting/outdated evidence and access tests; verify quotas, failure behavior and observed provider cost before expansion.' },
  { id: 'L09', title: 'Review the limited public-launch decision', priority: 'P0', dependencies: ['L03', 'L04', 'L05', 'L06', 'L07', 'L08'], acceptance: 'Review current release evidence, unresolved defects and staffed operations. Record the decision; deployment approval remains a separate guarded process.' },
  { id: 'R01', title: 'Review the first measured growth experiment', priority: 'P1', dependencies: ['A01', 'C01', 'L09'], acceptance: 'Review qualified contribution and return, cash spend, founder time and attribution uncertainty; record an observe, improve, scale or stop decision.' },
  { id: 'M01', title: 'Assess a delivered paid convenience pilot', priority: 'P2', dependencies: ['R01', 'AI01'], acceptance: 'Establish actual willingness to pay, delivered features, support/refunds, provider eligibility and server-verified entitlements before any payment or advertising activation.' },
];

const round = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
export function experimentEconomics(input: Pick<LaunchExperimentInput, 'cash_cost_usd' | 'founder_hours' | 'hour_value_usd' | 'attributable_contribution_usd'>) {
  const { cash_cost_usd: cash, founder_hours: hours, hour_value_usd: rate, attributable_contribution_usd: benefit } = input;
  if (![cash, hours, rate].every(value => Number.isFinite(value) && value >= 0)
    || cash > 1_000_000_000 || hours > 100_000 || rate > 100_000
    || (benefit !== null && (!Number.isFinite(benefit) || Math.abs(benefit) > 1_000_000_000))) throw new Error('Enter valid experiment amounts.');
  const founderCost = round(hours * rate), totalCost = round(cash + founderCost);
  return {
    founder_cost_usd: founderCost, total_cost_usd: totalCost,
    cash_contribution_usd: benefit === null ? null : round(benefit - cash),
    economic_contribution_usd: benefit === null ? null : round(benefit - totalCost),
    cash_roi_percent: benefit === null || cash === 0 ? null : round((benefit - cash) / cash * 100),
    economic_roi_percent: benefit === null || totalCost === 0 ? null : round((benefit - totalCost) / totalCost * 100),
  };
}

export function unmetTaskDependencies(task: LaunchTaskDefinition, tasks: Pick<LaunchTask, 'id' | 'status'>[]): string[] {
  return task.dependencies.filter(id => tasks.find(row => row.id === id)?.status !== 'done');
}
export function launchWorkspaceError(error: unknown): string {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === '40001') return 'This item changed in another tab. Refresh before saving again.';
  if (value?.code === '42501') return 'Sign in with the designated owner account and a current session.';
  if (value?.message?.includes('Too many requests')) return 'Too many workspace changes. Wait a minute, then refresh before retrying.';
  if (value?.code === 'P0001' && value.message === 'Workspace experiment limit reached') return 'This workspace is limited to 100 experiments. Review existing experiments before adding more.';
  if (value?.code === '22023' && value.message === 'Complete dependencies before marking done') return 'Complete the prerequisite tasks before marking this task done.';
  if (value?.code === '22023' && value.message === 'Reopen completed dependents first') return 'Reopen completed dependent tasks before reopening this prerequisite.';
  if (value?.code === '22023' && value.message === 'Completion requires evidence') return 'Add at least 20 characters of actual completion evidence.';
  if (['22023', '22003', '22007', '22008', '22P02', '23514'].includes(value?.code ?? '')) return 'Check the fields, date range and amounts, then try again.';
  return 'The owner workspace is unavailable. Your changes have not been confirmed; refresh before retrying.';
}
