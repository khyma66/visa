import Link from 'next/link';

const notices = {
  advice: { title: 'Peer experiences, not legal advice', body: 'VisaFlow is not affiliated with USCIS or any government. Similar cases, reactions and accepted answers do not establish eligibility or guarantee an outcome. Rules and deadlines can change; verify them with official sources or an authorized immigration professional.' },
  publishing: { title: 'Before you publish', body: 'Your question or reply is public and may be copied or indexed. Remove names, passport/receipt/SEVIS numbers, addresses, financial details and other people’s information. Share only text you have permission to publish. A public pseudonym does not make you untraceable.' },
  messaging: { title: 'Protect yourself in messages', body: 'Messages are not end-to-end encrypted. Recipients can copy them; reported messages may be reviewed by moderators, and infrastructure administrators can access stored data. Never send passwords, verification codes, documents or money to someone promising a visa outcome.' },
  imported: { title: 'Imported discussion: verify before relying on it', body: 'This is a collected snapshot, not a current official answer. Dates, circumstances and source claims may be incomplete. Public handles are replaced, but quoted text and source links can still identify people. A source link is not an endorsement or proof of permission to republish.' },
} as const;

export function SafetyNotice({ kind }: { kind: keyof typeof notices }) {
  const notice = notices[kind];
  return <aside aria-label={notice.title} className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-950">
    <p className="font-bold">{notice.title}</p><p>{notice.body}</p>
    <Link href="/community-safety" className="font-semibold underline">Safety and official resources</Link>
    {' · '}<Link href="/contact" className="font-semibold underline">Reporting and privacy requests</Link>
  </aside>;
}
