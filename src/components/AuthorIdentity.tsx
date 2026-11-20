'use client';
import Link from 'next/link';
import {Mail} from 'lucide-react';
import {getMemberMessageHref} from '@/lib/messaging-state';
import {isImportedPost,publicImportedUsername} from '@/lib/post-presentation';
import {featureAccess} from '@/lib/feature-access';
import {useAuth} from './AuthProvider';
import {ActionPopover} from './ActionPopover';
import {EARLIER_DISCUSSION_NOTE} from './PostOriginBadge';
type AuthorContent={id:string;author_id:string|null;author_username:string;source?:string};
export function AuthorIdentity({content}:{content:AuthorContent}) {
  const {user}=useAuth();
  const imported=isImportedPost(content),name=imported?publicImportedUsername(content):`u/${content.author_username}`;
  const messageHref=featureAccess.directMessaging?getMemberMessageHref(content,user?.id):null;
  // Tapping an earlier-discussion author explains why there is no Message option.
  if(imported)return <ActionPopover label={`About ${name}`} trigger={<span>{name}</span>} triggerClassName="author-identity">
    <p className="break-all px-3 pt-2 text-sm font-semibold text-slate-900">{name}</p>
    <p className="max-w-64 px-3 pb-2 text-xs leading-5 text-slate-600">{EARLIER_DISCUSSION_NOTE}</p>
  </ActionPopover>;
  if(!messageHref)return <span className="break-all font-semibold text-slate-700">{name}</span>;
  return <ActionPopover label={`About ${name}`} trigger={<span>{name}</span>} triggerClassName="author-identity">
    <p className="break-all px-3 py-2 text-sm font-semibold text-slate-900">{name}</p>
    <Link href={messageHref} className="post-action" aria-label={`Message ${content.author_username}`}><Mail size={17} aria-hidden="true"/>Message</Link>
  </ActionPopover>;
}
