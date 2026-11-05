'use client';
import Link from 'next/link';
import {Mail} from 'lucide-react';
import {getMemberMessageHref} from '@/lib/messaging-state';
import {isImportedPost,publicImportedUsername} from '@/lib/post-presentation';
import {featureAccess} from '@/lib/feature-access';
import {useAuth} from './AuthProvider';
import {ActionPopover} from './ActionPopover';
type AuthorContent={id:string;author_id:string|null;author_username:string;source?:string};
export function AuthorIdentity({content}:{content:AuthorContent}) {
  const {user}=useAuth();
  const imported=isImportedPost(content),name=imported?publicImportedUsername(content):`u/${content.author_username}`;
  const messageHref=featureAccess.directMessaging?getMemberMessageHref(content,user?.id):null;
  if(!messageHref)return <span className="break-all font-semibold text-slate-700">{name}</span>;
  return <ActionPopover label={`About ${name}`} trigger={<span>{name}</span>} triggerClassName="author-identity">
    <p className="break-all px-3 py-2 text-sm font-semibold text-slate-900">{name}</p>
    <Link href={messageHref} className="post-action" aria-label={`Message ${content.author_username}`}><Mail size={17} aria-hidden="true"/>Message</Link>
  </ActionPopover>;
}
