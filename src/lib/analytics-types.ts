export type AnalyticsPeriod = 7 | 30 | 90;
export type ActivityTotals = {
  members_joined: number; questions_created: number; experiences_created: number;
  answers_created: number; imported_replies_created: number; distinct_contributors: number;
};
export type OwnerAnalytics = {
  schema_version: number; generated_at: string;
  window: { days: AnalyticsPeriod; start_inclusive: string; end_exclusive: string; timezone: string; includes_partial_today: boolean };
  overview: ActivityTotals;
  quality: { questions_in_window: number; questions_with_human_answer: number; answer_rate_percent: number | null; median_first_answer_hours: number | null; unanswered_questions_current: number };
  operations: { reports_received: number; reports_pending_current: number; feedback_received: number; feedback_pending_current: number };
  daily: (ActivityTotals & { date: string })[];
  limitations: string[];
};
export type ImportHealth = {
  available: boolean;
  mode: string; capturedAt: string | null; newestPostAt: string | null; oldestPostAt: string | null;
  posts: number | null; duplicates: number | null; rejected: number | null; invalidDates: number | null;
  newestPostAgeHours: number | null; stale: boolean; staleAfterHours: number;
};
export type AnalyticsResponse = {
  metrics: OwnerAnalytics; imports: ImportHealth;
  release: { environment: string; publicLaunchApproved: boolean; checks: { key: string; status: string }[] };
};
