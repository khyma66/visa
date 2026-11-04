export type MemberCursor = { created_at: string; id: string } | null;
export type Member = {
  id: string; email: string | null; username: string | null; created_at: string;
  last_sign_in_at: string | null; email_verified: boolean; suspended: boolean;
  is_owner: boolean; questions: number; experiences: number; replies: number;
};
export type MemberPage = {
  generated_at: string; matched: number; total: number; verified: number;
  joined_7_days: number; items: Member[]; next_cursor: MemberCursor;
};
// Treat every string as untrusted spreadsheet input, including leading controls.
export function memberCsv(rows: Member[]): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [
    ['Member ID','Username','Email','Email verified','Account status','Owner','Signed up (UTC)','Last sign-in (UTC)','Questions','Experiences','Replies'],
    ...rows.map(r => [r.id,r.username,r.email,r.email_verified,r.suspended?'Suspended':'Not suspended',r.is_owner,r.created_at,r.last_sign_in_at,r.questions,r.experiences,r.replies]),
  ].map(row => row.map(cell).join(',')).join('\r\n');
}
