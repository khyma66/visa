'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Lock, MessageCircle, Plus, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  getConversation, getMessageEntry, getMessageRecipient, listConversations, listMessages, markConversationRead, refreshConversations, refreshMessages, respondToConversation, sendMessage, startConversation,
  type MessageRecipient,
} from '@/lib/community';
import { canSendToConversation, conversationFolder, messageLoginHref, sortConversations, sortMessages } from '@/lib/messaging-state';
import type { Conversation, DirectMessage } from '@/lib/types';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';
import { ReportButton } from './ReportButton';
import { SafetyNotice } from './SafetyNotice';
import { subscribeLive, type LiveStatus } from '@/lib/realtime';

export function MessagesClient({ recipientUsername = '', recipientMemberId = '' }: { recipientUsername?: string; recipientMemberId?: string }) {
  const { user, loading, demoMode } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [recipient, setRecipient] = useState(recipientUsername);
  const [linkedRecipientId, setLinkedRecipientId] = useState(recipientMemberId);
  const [resolvedRecipient, setResolvedRecipient] = useState<MessageRecipient | null>(null);
  const [resolvingRecipient, setResolvingRecipient] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [tab, setTab] = useState<'chats' | 'requests' | 'closed'>('chats');
  const [live, setLive] = useState<LiveStatus>('connecting');
  const [hasOlder, setHasOlder] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [inboxHasOlder, setInboxHasOlder] = useState(false);
  const [inboxOlderLoading, setInboxOlderLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState('');
  const [inboxNotice, setInboxNotice] = useState('');
  const inboxRef = useRef(conversations);
  inboxRef.current = conversations;
  const messageRef = useRef(messages);
  messageRef.current = messages;
  const inboxGeneration = useRef(0);
  const messageGeneration = useRef(0);
  const navigationGeneration = useRef(0);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const pendingSend = useRef<{ id: string; body: string; conversation: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const openConversation = useCallback((conversation: Conversation, selectFolder = true) => {
    // Invalidate any inbox response captured before this explicit selection.
    ++inboxGeneration.current;
    if (activeRef.current !== conversation.id) {
      ++messageGeneration.current;
      messageRef.current = [];
      setMessages([]); setBody(''); setHasOlder(false); setMessagesLoading(true);
    }
    activeRef.current = conversation.id;
    setSelectedConversation(conversation);
    setActiveId(conversation.id);
    if (selectFolder) {
      ++navigationGeneration.current;
      setTab(conversationFolder(conversation, user?.id ?? ''));
    }
  }, [user?.id]);

  const loadInbox = useCallback(async (selectedId = activeRef.current) => {
    const generation = ++inboxGeneration.current;
    const previous = inboxRef.current;
    const result = await refreshConversations(previous);
    const selected = selectedId ? result.conversations.find((row) => row.id === selectedId) ?? await getConversation(selectedId) : null;
    if (generation !== inboxGeneration.current) return;
    const rows = result.conversations;
    inboxRef.current = rows;
    setConversations(rows);
    if (activeRef.current === selectedId) {
      setSelectedConversation(selected);
    }
    if (previous.length > 50) setInboxNotice('Inbox updated. Earlier conversations remain available below; your open chat is unchanged.');
    if (result.reset) setInboxHasOlder(result.hasOlder);
    if (!activeRef.current) {
      const first = rows.find((r) => !r.request_status || r.request_status === 'accepted');
      if (first) openConversation(first, false);
    }
  }, [openConversation, user?.id]);

  useEffect(() => {
    if (!user) return;
    void loadInbox().catch((reason: Error) => setError(reason.message));
    return subscribeLive([`inbox:${user.id}`], () => { void loadInbox().catch((reason: Error) => setError(reason.message)); });
  }, [loadInbox, user]);

  useEffect(() => {
    if (!user || !recipientUsername) return;
    let valid = true;
    const navigation = navigationGeneration.current;
    setResolvingRecipient(true);
    void (async () => {
      try {
        const { member, conversation: existing } = await getMessageEntry(recipientUsername, user.id, recipientMemberId || undefined);
        if (!valid) return;
        setResolvedRecipient(member);
        setRecipient(member.username);
        // Following an author link only reads. A new request needs the explicit
        // Start request action; an existing incoming request opens its own folder.
        if (existing && navigation === navigationGeneration.current) openConversation(existing);
      } catch (reason) {
        if (valid) { setResolvedRecipient(null); setError(reason instanceof Error ? reason.message : 'Could not find this member.'); }
      } finally { if (valid) setResolvingRecipient(false); }
    })();
    return () => { valid = false; };
  }, [recipientUsername, recipientMemberId, user?.id, openConversation]);

  useEffect(() => {
    if (!activeId || !user) return;
    let valid = true;
    messageGeneration.current++;
    messageRef.current = [];
    setMessages([]); setBody(''); setHasOlder(false); setMessagesLoading(true); setHistoryNotice('');
    const reload = async () => {
      const current = ++messageGeneration.current;
      try {
        const previous = messageRef.current;
        const result = await refreshMessages(activeId, previous);
        if (!valid || current !== messageGeneration.current) return;
        messageRef.current = result.messages;
        setMessages(result.messages);
        if (result.reset) {
          setHasOlder(result.hasOlder);
          if (previous.length && result.hasOlder) setHistoryNotice('You have newer messages. Load earlier messages to continue through the full history.');
        }
        if (document.visibilityState === 'visible' && result.messages.some((m) => m.sender_id !== user.id && !m.read_at)) {
          await markConversationRead(activeId, user.id, result.messages);
          if (valid) await loadInbox();
        }
      } catch (reason) { if (valid) setError(reason instanceof Error ? reason.message : 'Could not load messages.'); }
      finally { if (valid && current === messageGeneration.current) setMessagesLoading(false); }
    };
    void reload();
    const stop = subscribeLive([`conversation:${activeId}`], () => { void reload(); }, setLive);
    return () => { valid = false; stop(); };
  }, [activeId, loadInbox, user]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages.at(-1)?.id]);

  async function begin(event: FormEvent) {
    event.preventDefault();
    if (!user || acting || resolvingRecipient) return;
    setActing(true);
    setError('');
    try {
      const member = resolvedRecipient ?? await getMessageRecipient(recipient, linkedRecipientId || undefined);
      if (member.id === user.id) throw new Error('You cannot message yourself. Choose another community member.');
      const id = await startConversation(member.username, demoMode ? undefined : member.id);
      const conversation = await getConversation(id);
      if (!conversation) throw new Error('This conversation is unavailable. Please refresh and try again.');
      openConversation(conversation);
      setRecipient('');
      setLinkedRecipientId('');
      setResolvedRecipient(null);
      await loadInbox(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start conversation.'); }
    finally { setActing(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!user || !activeId || !body.trim() || sending) return;
    const conversation = activeId;
    const text = body.trim();
    if (pendingSend.current?.body !== text || pendingSend.current.conversation !== conversation) pendingSend.current = { id: crypto.randomUUID(), body: text, conversation };
    setSending(true); setError('');
    try {
      await sendMessage(conversation, user.id, text, pendingSend.current.id);
      pendingSend.current = null;
      if (activeRef.current === conversation) {
        setBody('');
        const generation = ++messageGeneration.current;
        const result = await refreshMessages(conversation, messageRef.current);
        if (activeRef.current === conversation && generation === messageGeneration.current) {
          messageRef.current = result.messages;
          setMessages(result.messages);
          if (result.reset) setHasOlder(result.hasOlder);
        }
      }
      await loadInbox();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Send failed. Your text is saved; retry to send.'); }
    finally { setSending(false); }
  }

  async function respond(decision: 'accepted' | 'declined' | 'blocked') {
    if (!user || !activeId || acting) return;
    const conversation = activeId;
    setActing(true); setError('');
    try {
      await respondToConversation(conversation, decision, user.id);
      await loadInbox();
      if (activeRef.current === conversation) setTab(decision === 'accepted' ? 'chats' : 'closed');
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this request.'); }
    finally { setActing(false); }
  }

  async function older() {
    if (!messages[0] || olderLoading) return;
    const conversation = activeId;
    const generation = ++messageGeneration.current;
    setOlderLoading(true);
    try {
      const rows = await listMessages(conversation, messages[0]);
      if (activeRef.current !== conversation || generation !== messageGeneration.current) return;
      const merged = sortMessages([...rows, ...messageRef.current]);
      messageRef.current = merged;
      setMessages(merged);
      setHasOlder(rows.length === 50);
      if (user && document.visibilityState === 'visible') await markConversationRead(conversation, user.id, rows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load older messages.'); }
    finally { setOlderLoading(false); if (activeRef.current === conversation) setMessagesLoading(false); }
  }

  async function olderConversations() {
    if (inboxOlderLoading || !conversations.length) return;
    const generation = ++inboxGeneration.current;
    setInboxOlderLoading(true);
    try {
      const rows = await listConversations(conversations.at(-1));
      if (generation !== inboxGeneration.current) return;
      const merged = sortConversations([...inboxRef.current, ...rows]);
      inboxRef.current = merged;
      setConversations(merged);
      setInboxHasOlder(rows.length === 50);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load earlier conversations.'); }
    finally { setInboxOlderLoading(false); }
  }

  if (loading) return <main className="mx-auto max-w-6xl p-8">Loading messages…</main>;
  if (!user) return <main className="mx-auto max-w-xl px-4 py-20 text-center"><Lock className="mx-auto text-teal-700" size={34} /><h1 className="mt-4 text-3xl font-black">Your community inbox</h1><p className="mt-3 text-slate-600">Log in to see conversations for your account.</p><SafetyNotice kind="messaging" /><Link href={messageLoginHref(recipientUsername, recipientMemberId)} className="mt-6 inline-block rounded-lg bg-teal-700 px-5 py-3 font-bold text-white">Log in</Link></main>;

  const active = conversations.find((item) => item.id === activeId) ?? (selectedConversation?.id === activeId ? selectedConversation : null);
  const incoming = (c: Conversation) => conversationFolder(c, user.id) === 'requests';
  const closed = (c: Conversation) => conversationFolder(c, user.id) === 'closed';
  const visible = conversations.filter((c) => tab === 'requests' ? incoming(c) : tab === 'closed' ? closed(c) : !incoming(c) && !closed(c));
  const canSend = canSendToConversation(active, user.id, messages, messagesLoading);
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wider text-teal-700">Private conversations</p><h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Messages</h1></div><p className="flex items-center gap-1.5 text-xs text-slate-500"><Lock size={13} /> Participant-only access. Reported messages may be reviewed by moderators.</p></div>
      {demoMode && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Development preview: sample conversations are saved in this browser. Real accounts across devices require the community database.</p>}
      <SafetyNotice kind="messaging" />
      <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[700px] md:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 md:border-b-0 md:border-r">
          <form onSubmit={begin} className="border-b border-slate-200 p-4">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">New chat request</label>
            <div className="mt-2 flex gap-2"><input aria-label="Recipient public username" value={recipient} onChange={(event) => { setRecipient(event.target.value); setLinkedRecipientId(''); setResolvedRecipient(null); setError(''); }} disabled={acting || resolvingRecipient} maxLength={34} required placeholder="public username" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 disabled:bg-slate-100" /><button disabled={acting || resolvingRecipient || !recipient.trim()} className="grid w-10 place-items-center rounded-lg bg-slate-900 text-white disabled:opacity-40" aria-label={acting ? 'Opening conversation' : 'Start conversation'}><Plus size={17} /></button></div>
            <p role="status" className="mt-2 text-xs text-slate-500">{resolvingRecipient ? 'Finding this community member…' : resolvedRecipient ? `Member found: u/${resolvedRecipient.username}. Start a request or continue your existing conversation.` : 'Enter a member’s public username. They decide whether to accept your request.'}</p>
          </form>
          <nav aria-label="Message folders" className="flex gap-2 border-b p-3">{(['chats', 'requests', 'closed'] as const).map((item) => <button key={item} onClick={() => setTab(item)} aria-pressed={tab === item} className={`rounded-full px-3 py-2 text-xs font-bold capitalize ${tab === item ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{item}{item === 'requests' ? ` (${conversations.filter(incoming).length}${inboxHasOlder ? '+' : ''})` : ''}</button>)}</nav>
          <div className="max-h-[530px] overflow-y-auto">{visible.map((conversation) => (
            <button key={conversation.id} onClick={() => openConversation(conversation)} className={`flex w-full gap-3 border-b border-slate-100 p-4 text-left transition ${activeId === conversation.id ? 'bg-teal-50' : 'hover:bg-slate-50'}`}>
              <Avatar seed={conversation.other_avatar_seed} />
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><b className="truncate text-sm text-slate-900">u/{conversation.other_username}</b>{conversation.unread_count > 0 && <span className="ml-auto rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-bold text-white">{conversation.unread_count}</span>}</span><span className="mt-1 block truncate text-xs text-slate-500">{conversation.last_message ?? 'Start the conversation'}</span></span>
            </button>
          ))}{visible.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No {tab} in the loaded conversations.</p>}
          {inboxNotice && <p role="status" className="px-4 pt-3 text-xs text-slate-500">{inboxNotice}</p>}
          {inboxHasOlder && <button onClick={() => void olderConversations()} disabled={inboxOlderLoading} className="w-full p-4 text-sm font-bold text-teal-700">{inboxOlderLoading ? 'Loading…' : 'Load earlier conversations'}</button>}</div>
        </aside>
        <section className="flex h-[600px] min-h-0 flex-col md:h-auto">
          {active ? <>
            <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4"><Avatar seed={active.other_avatar_seed} /><div><b className="text-sm text-slate-900">u/{active.other_username}</b><p role="status" className="text-xs text-slate-500">{demoMode ? 'Browser preview' : live === 'live' ? 'Connected · live messages' : 'Reconnecting · checking for missed messages'}</p></div>{!closed(active) && <button disabled={acting} onClick={() => void respond('blocked')} className="ml-auto text-xs text-slate-500 hover:text-rose-700">Block</button>}</div>
            <div aria-label="Conversation messages" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-5">
              {historyNotice && <p role="status" className="text-center text-xs text-slate-500">{historyNotice}</p>}
              {hasOlder && <button onClick={() => void older()} disabled={olderLoading} className="mx-auto block text-xs font-bold text-teal-700">{olderLoading ? 'Loading…' : 'Load earlier messages'}</button>}
              {messagesLoading && <p className="text-center text-sm text-slate-500">Loading conversation…</p>}
              {messages.map((message) => {
              const mine = message.sender_id === user.id;
              return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className="max-w-[78%]">
                <div className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${mine ? 'rounded-br-md bg-teal-700 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><p className={`mt-1 text-[10px] ${mine ? 'text-teal-100' : 'text-slate-400'}`}>{formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}{mine ? ` · ${message.read_at ? 'Read' : 'Sent'}` : ''}</p></div>
                {!mine && <ReportButton kind="message" target={message.id} />}
              </div></div>;
            })}<div ref={endRef} /></div>
            {incoming(active) && <div className="border-t bg-amber-50 p-4"><p className="text-sm text-amber-950">Accept this request to reply.</p><div className="mt-3 flex gap-3"><button disabled={acting} onClick={() => void respond('accepted')} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white">Accept request</button><button disabled={acting} onClick={() => void respond('declined')} className="rounded-lg border border-amber-300 px-4 py-2 text-sm">Decline</button></div></div>}
            {closed(active) ? <p className="border-t p-4 text-sm text-slate-500">{active.request_status === 'blocked' ? 'This conversation is blocked. No more messages can be sent.' : 'This request was declined.'}</p> : !incoming(active) && <>
              {active.request_status === 'pending' && <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-900">{messages.length ? 'Waiting for acceptance before you can send more messages.' : 'Send one introduction. You can continue when they accept.'}</p>}
              <form onSubmit={send} className="flex gap-3 border-t border-slate-200 p-4"><input aria-label="Private message" value={body} onChange={(event) => setBody(event.target.value)} disabled={!canSend || sending} maxLength={4000} required placeholder="Write a private message…" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100 disabled:bg-slate-100" /><button disabled={!canSend || sending || !body.trim()} className="grid w-12 place-items-center rounded-xl bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40" aria-label="Send message"><Send size={19} /></button></form>
            </>}
          </> : <div className="grid flex-1 place-items-center p-8 text-center"><div><MessageCircle className="mx-auto text-slate-300" size={42} /><h2 className="mt-3 text-xl font-black text-slate-800">Choose a conversation</h2><p className="mt-1 text-sm text-slate-500">Or start one with a public username.</p></div></div>}
        </section>
      </div>
      {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
    </main>
  );
}
