'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, MessageCircle, Plus, Send, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  getConversation, getConversationCounts, getConversationMessageCount, getMessageEntry, getMessageRecipient, listConversationFolder, listMessages, markConversationRead, refreshMessages, respondToConversation, sendMessage, startConversation,
  type MessageRecipient,
} from '@/lib/community';
import { canSendToConversation, conversationFolder, messageLoginHref, sortConversations, sortMessages, type ConversationCounts, type ConversationFolder } from '@/lib/messaging-state';
import type { Conversation, DirectMessage } from '@/lib/types';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';
import { ReportButton } from './ReportButton';
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
  const [tab, setTab] = useState<ConversationFolder>('chats');
  const [live, setLive] = useState<LiveStatus>('connecting');
  const [hasOlder, setHasOlder] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [inboxHasOlder, setInboxHasOlder] = useState(false);
  const [inboxOlderLoading, setInboxOlderLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState('');
  const [inboxNotice, setInboxNotice] = useState('');
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState('');
  const [folderCounts, setFolderCounts] = useState<ConversationCounts | null>(null);
  const [messageTotal, setMessageTotal] = useState<number | null>(null);
  const [messageError, setMessageError] = useState('');
  const [composeOpen, setComposeOpen] = useState(Boolean(recipientUsername));
  const [mobileThread, setMobileThread] = useState(false);
  const composeRef = useRef<HTMLDialogElement>(null);
  const composeOpenRef = useRef(composeOpen);
  composeOpenRef.current = composeOpen;
  const presentedComposeOpen = useRef(composeOpen);
  const mobileThreadRef = useRef(mobileThread);
  mobileThreadRef.current = mobileThread;
  const threadIsVisible = () => !composeOpenRef.current && !composeRef.current?.open
    && (typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches || mobileThreadRef.current);
  const changeComposer = useCallback((open: boolean) => {
    // Update before React commits so an already-running history fetch cannot
    // mark the obscured thread read between opening the dialog and rerendering.
    composeOpenRef.current = open;
    setComposeOpen(open);
  }, []);
  const folderRef = useRef(tab);
  folderRef.current = tab;
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
  const sendLock = useRef(false);
  const retryMessages = useRef<(() => Promise<void>) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const openConversation = useCallback((conversation: Conversation, selectFolder = true) => {
    // Invalidate any inbox response captured before this explicit selection.
    ++inboxGeneration.current;
    setInboxLoading(false);
    if (activeRef.current !== conversation.id) {
      ++messageGeneration.current;
      messageRef.current = [];
      setMessages([]); setBody(''); setHasOlder(false); setMessagesLoading(true); setMessageTotal(null); setMessageError('');
    }
    activeRef.current = conversation.id;
    setSelectedConversation(conversation);
    setActiveId(conversation.id);
    if (selectFolder) {
      mobileThreadRef.current = true;
      setMobileThread(true);
      changeComposer(false);
      ++navigationGeneration.current;
      const next = conversationFolder(conversation, user?.id ?? '');
      if (folderRef.current !== next) { inboxRef.current = []; setConversations([]); setInboxHasOlder(false); }
      folderRef.current = next;
      setTab(next);
    }
  }, [user?.id, changeComposer]);

  const loadInbox = useCallback(async (selectedId = activeRef.current) => {
    if (!user) return;
    const generation = ++inboxGeneration.current;
    const folder = folderRef.current;
    setInboxLoading(true); setInboxError('');
    try {
      const previous = inboxRef.current;
      const [result, counts] = await Promise.all([listConversationFolder(folder, user.id), getConversationCounts(user.id)]);
      const selected = selectedId ? result.conversations.find((row) => row.id === selectedId) ?? await getConversation(selectedId) : null;
      if (generation !== inboxGeneration.current) return;
      const rows = sortConversations(result.conversations);
      inboxRef.current = rows;
      setConversations(rows);
      setFolderCounts(counts);
      if (activeRef.current === selectedId) setSelectedConversation(selected);
      if (previous.length > 50) setInboxNotice('Inbox updated. Load earlier conversations to see more; your open chat is unchanged.');
      setInboxHasOlder(result.hasOlder);
      if (!activeRef.current) {
        const first = rows.find((r) => !r.request_status || r.request_status === 'accepted');
        if (first) openConversation(first, false);
      }
    } catch {
      if (generation === inboxGeneration.current) { setFolderCounts(null); setInboxError('We couldn’t load your conversations. Please try again.'); }
    } finally {
      if (generation === inboxGeneration.current) setInboxLoading(false);
    }
  }, [openConversation, user?.id]);

  useEffect(() => {
    if (!user) return;
    void loadInbox();
    return subscribeLive([`inbox:${user.id}`], () => { void loadInbox(); });
  }, [loadInbox, user, tab]);

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
      } catch {
        if (valid) { setResolvedRecipient(null); setError('We couldn’t find this member. Check their public username and try again.'); }
      } finally { if (valid) setResolvingRecipient(false); }
    })();
    return () => { valid = false; };
  }, [recipientUsername, recipientMemberId, user?.id, openConversation]);

  useEffect(() => {
    if (!activeId || !user) return;
    let valid = true;
    messageGeneration.current++;
    messageRef.current = [];
    setMessages([]); setBody(''); setHasOlder(false); setMessagesLoading(true); setMessageTotal(null); setHistoryNotice(''); setMessageError('');
    const reload = async () => {
      const current = ++messageGeneration.current;
      try {
        const previous = messageRef.current;
        const [result, total] = await Promise.all([refreshMessages(activeId, previous), getConversationMessageCount(activeId)]);
        if (!valid || current !== messageGeneration.current) return;
        messageRef.current = result.messages;
        setMessages(result.messages);
        setMessageTotal(total);
        setMessageError('');
        if (result.reset) {
          setHasOlder(result.hasOlder && result.messages.length < total);
          if (previous.length && result.hasOlder) setHistoryNotice('You have newer messages. Load earlier messages to continue through the full history.');
        }
        if (document.visibilityState === 'visible' && threadIsVisible() && result.messages.some((m) => m.sender_id !== user.id && !m.read_at)) {
          // A receipt write is independent of the successfully fetched history
          // and count. Its failure must not turn that count into an unknown one.
          const receiptError = 'Messages loaded, but read receipts could not be updated. They will retry when the conversation refreshes.';
          try {
            await markConversationRead(activeId, user.id, result.messages);
            if (valid && current === messageGeneration.current) {
              setError(previous => previous === receiptError ? '' : previous);
              await loadInbox();
            }
          } catch {
            if (valid && current === messageGeneration.current) setError(receiptError);
          }
        }
      } catch { if (valid && current === messageGeneration.current) { setMessageTotal(null); setMessageError('We couldn’t refresh this conversation. Please try again.'); } }
      finally { if (valid && current === messageGeneration.current) setMessagesLoading(false); }
    };
    retryMessages.current = async () => { if (valid) { setMessagesLoading(true); await reload(); } };
    void reload();
    const stop = subscribeLive([`conversation:${activeId}`], () => { void reload(); }, setLive);
    return () => { valid = false; retryMessages.current = null; stop(); };
  }, [activeId, loadInbox, user]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages.at(-1)?.id]);

  useEffect(() => {
    const dialog = composeRef.current;
    if (!dialog) return;
    const wasComposing = presentedComposeOpen.current;
    presentedComposeOpen.current = composeOpen;
    if (composeOpen && !dialog.open) dialog.showModal();
    if (!composeOpen && dialog.open) dialog.close();
    // Escape closes a native dialog before this effect runs too. Refresh only
    // after it is dismissed, with the normal visibility/auth checks still used.
    if (!composeOpen && wasComposing) void retryMessages.current?.();
  }, [composeOpen, loading, user?.id]);

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
    } catch { setError('We couldn’t start this conversation. Check the member’s public username and try again.'); }
    finally { setActing(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!user || !activeId || !body.trim() || sending || sendLock.current) return;
    sendLock.current = true;
    const conversation = activeId;
    const text = body.trim();
    if (pendingSend.current?.body !== text || pendingSend.current.conversation !== conversation) pendingSend.current = { id: crypto.randomUUID(), body: text, conversation };
    setSending(true); setError('');
    let confirmed = false;
    let refreshGeneration: number | undefined;
    try {
      await sendMessage(conversation, user.id, text, pendingSend.current.id);
      confirmed = true;
      pendingSend.current = null;
      if (activeRef.current === conversation) {
        setBody('');
        const generation = ++messageGeneration.current;
        refreshGeneration = generation;
        const [result, total] = await Promise.all([refreshMessages(conversation, messageRef.current), getConversationMessageCount(conversation)]);
        if (activeRef.current === conversation && generation === messageGeneration.current) {
          messageRef.current = result.messages;
          setMessages(result.messages);
          setMessageTotal(total);
          setMessageError('');
          if (result.reset) setHasOlder(result.hasOlder && result.messages.length < total);
        }
      }
      await loadInbox();
    } catch {
      if (activeRef.current === conversation) {
        if (confirmed && refreshGeneration === messageGeneration.current) {
          setMessageTotal(null);
          setMessageError('Your message was sent, but this conversation could not refresh. Retry to see the latest messages.');
        } else if (!confirmed) setError('Your message could not be sent. Your text is saved. Refresh the conversation and try again.');
      }
      if (confirmed) await loadInbox();
    }
    finally {
      // A confirmed send can supersede a manual history retry. The operation
      // that owns the current generation must settle its loading indicator.
      if (activeRef.current === conversation && refreshGeneration === messageGeneration.current) setMessagesLoading(false);
      sendLock.current = false; setSending(false);
    }
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
    catch { setError('We couldn’t update this request. Refresh the conversation and try again.'); }
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
      setHasOlder(rows.length === 50 && (messageTotal === null || merged.length < messageTotal));
      if (user && document.visibilityState === 'visible' && threadIsVisible()) {
        await markConversationRead(conversation, user.id, rows);
        if (activeRef.current === conversation && generation === messageGeneration.current) await loadInbox();
      }
    } catch { setError('We couldn’t load earlier messages. Please try again.'); }
    finally { setOlderLoading(false); if (activeRef.current === conversation) setMessagesLoading(false); }
  }

  async function olderConversations() {
    if (!user || inboxLoading || inboxOlderLoading || !conversations.length) return;
    const generation = ++inboxGeneration.current;
    setInboxOlderLoading(true);
    try {
      const result = await listConversationFolder(folderRef.current, user.id, conversations.at(-1));
      if (generation !== inboxGeneration.current) return;
      const merged = sortConversations([...inboxRef.current, ...result.conversations]);
      inboxRef.current = merged;
      setConversations(merged);
      setInboxHasOlder(result.hasOlder);
    } catch { setError('We couldn’t load earlier conversations. Please try again.'); }
    finally { setInboxOlderLoading(false); }
  }

  if (loading) return <main className="mx-auto max-w-6xl p-8">Loading messages…</main>;
  if (!user) return <main className="mx-auto max-w-xl px-4 py-20 text-center"><Lock className="mx-auto text-blue-700" size={34} /><h1 className="mt-4 text-3xl font-black">Your community inbox</h1><p className="mt-3 text-slate-600">Log In to see conversations for your account.</p><Link href={messageLoginHref(recipientUsername, recipientMemberId)} className="mt-6 inline-block rounded-lg bg-blue-700 px-5 py-3 font-bold text-white">Log In</Link></main>;

  const active = conversations.find((item) => item.id === activeId) ?? (selectedConversation?.id === activeId ? selectedConversation : null);
  const incoming = (c: Conversation) => conversationFolder(c, user.id) === 'requests';
  const closed = (c: Conversation) => conversationFolder(c, user.id) === 'closed';
  // Realtime refreshes and overlapping pages must not create duplicate inbox rows.
  // Distinct conversation IDs are never merged: their histories are separate.
  const visible = sortConversations(conversations).filter((c) => tab === 'requests' ? incoming(c) : tab === 'closed' ? closed(c) : !incoming(c) && !closed(c));
  const canSend = canSendToConversation(active, user.id, messages, messagesLoading);
  const emptyFolder = {
    chats: { title: 'No chats yet', description: 'Start a request using a member’s public username.' },
    requests: { title: 'No message requests', description: 'New Chat Requests from other members appear here.' },
    closed: { title: 'No closed conversations', description: 'Declined or blocked conversations appear here.' },
  }[tab];
  return (
    <main className="page-shell py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight text-slate-950">Messages</h1><p className="mt-1 text-sm text-slate-500">Your conversations, in one place.</p></div>
        <button type="button" aria-haspopup="dialog" aria-controls="new-message-dialog" aria-expanded={composeOpen} onClick={() => { setError(''); changeComposer(true); }} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"><Plus size={17} />New message</button>
      </div>
      {demoMode && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Development preview: sample conversations are saved in this browser. Real accounts across devices require the community database.</p>}
      <dialog id="new-message-dialog" ref={composeRef} aria-labelledby="new-message-title" onCancel={() => changeComposer(false)} onClose={() => changeComposer(false)} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/40">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 id="new-message-title" className="text-lg font-bold text-slate-900">New message</h2><button type="button" onClick={() => changeComposer(false)} aria-label="Close new message" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        <form onSubmit={begin} className="p-5">
            <label htmlFor="message-recipient" className="text-sm font-semibold text-slate-800">Public username <span aria-hidden="true">*</span></label>
            <input id="message-recipient" aria-label="Recipient public username" autoFocus autoComplete="off" value={recipient} onChange={(event) => { setRecipient(event.target.value); setLinkedRecipientId(''); setResolvedRecipient(null); setError(''); }} disabled={acting || resolvingRecipient} maxLength={34} required placeholder="e.g. calm-raven-12345" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100" />
            <p role="status" className="mt-2 text-xs leading-relaxed text-slate-500">{resolvingRecipient ? 'Finding this community member…' : resolvedRecipient ? `Member found: u/${resolvedRecipient.username}.` : 'Existing chats reopen here. New members receive a message request.'}</p>
            {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
            <button disabled={acting || resolvingRecipient || !recipient.trim()} className="mt-5 w-full rounded-full bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40" aria-label={acting ? 'Opening conversation' : 'Start conversation'}>{acting ? 'Opening…' : 'Continue'}</button>
          </form>
      </dialog>
      <div className="grid h-[min(720px,calc(100dvh-12rem))] min-h-[440px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="Conversation inbox" className={`${mobileThread ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-slate-200 md:border-r`}>
          <nav aria-label="Message folders" className="flex gap-1 border-b p-3">{(['chats', 'requests', 'closed'] as const).map((item) => <button key={item} onClick={() => { ++navigationGeneration.current; if (item === tab) return; ++inboxGeneration.current; folderRef.current = item; inboxRef.current = []; setConversations([]); setInboxHasOlder(false); setInboxLoading(true); setTab(item); }} aria-label={item} aria-pressed={tab === item} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold capitalize ${tab === item ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{item}<span aria-label={`${item} conversation count`} className="tabular-nums">{folderCounts ? folderCounts[item] : '—'}</span></button>)}</nav>
          {!inboxLoading && !inboxError && <p role="status" className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{visible.length} of {folderCounts?.[tab] ?? '—'} {tab === 'requests' ? 'requests' : 'conversations'} shown</p>}
          <div aria-busy={inboxLoading} className="min-h-0 flex-1 overflow-y-auto">{inboxLoading && <p role="status" className="p-4 text-center text-sm text-slate-500">{conversations.length ? 'Updating inbox…' : 'Loading conversations…'}</p>}{inboxError && <div role="alert" className="p-4 text-sm text-rose-700"><p>{inboxError}</p><button onClick={() => void loadInbox()} disabled={inboxLoading} className="mt-2 font-bold underline disabled:opacity-50">Retry inbox</button></div>}{visible.map((conversation) => (
            <button key={conversation.id} aria-label={`Conversation with u/${conversation.other_username}`} aria-current={activeId === conversation.id ? 'true' : undefined} onClick={() => { const alreadySelected = activeRef.current === conversation.id; openConversation(conversation); if (alreadySelected) void retryMessages.current?.(); }} className={`flex w-full gap-3 border-b border-slate-100 p-4 text-left transition ${activeId === conversation.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
              <Avatar seed={conversation.other_avatar_seed} />
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><b className="truncate text-sm text-slate-900">u/{conversation.other_username}</b>{conversation.unread_count > 0 && <span aria-label={`${conversation.unread_count} unread messages`} title="Unread messages in this conversation, including earlier history" className="ml-auto shrink-0 rounded-full bg-blue-700 px-2 py-0.5 text-xs font-bold text-white">{conversation.unread_count} unread</span>}</span><span className="mt-1 block truncate text-xs text-slate-500">{conversation.last_message ?? 'Start the conversation'}</span></span>
            </button>
          ))}{!inboxLoading && !inboxError && visible.length === 0 && <div className="p-6 text-center text-sm text-slate-500"><p className="font-semibold">{inboxHasOlder ? `No ${tab === 'requests' ? 'message requests' : tab === 'closed' ? 'closed conversations' : 'chats'} on this page` : emptyFolder.title}</p><p className="mt-1 text-xs">{inboxHasOlder ? 'Load earlier conversations to check this folder’s older history.' : emptyFolder.description}</p></div>}
          {inboxNotice && <p role="status" className="px-4 pt-3 text-xs text-slate-500">{inboxNotice}</p>}
          {inboxHasOlder && <button onClick={() => void olderConversations()} disabled={inboxLoading || inboxOlderLoading} className="w-full p-4 text-sm font-bold text-blue-700 disabled:opacity-50">{inboxOlderLoading ? 'Loading…' : 'Load earlier conversations'}</button>}</div>
        </aside>
        <section aria-label="Selected conversation" className={`${mobileThread ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}>
          {active ? <>
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4"><button type="button" onClick={() => { mobileThreadRef.current = false; setMobileThread(false); }} aria-label="Back to inbox" className="rounded-full p-2 text-slate-600 hover:bg-slate-100 md:hidden"><ArrowLeft size={20} /></button><Avatar seed={active.other_avatar_seed} /><div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-900">u/{active.other_username}</b><p role="status" className="text-xs text-slate-500">{demoMode ? 'Browser preview' : live === 'live' ? 'Connected' : 'Reconnecting…'}</p></div>{!closed(active) && <button disabled={acting} onClick={() => void respond('blocked')} className="rounded-full px-3 py-2 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700">Block</button>}</div>
            {!messagesLoading && <p role="status" className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">{messages.length} of {messageTotal ?? '—'} messages shown{hasOlder ? ' · Earlier messages available' : ''}</p>}
            {messageError && <div role="alert" className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700"><p>{messageError}</p><button type="button" disabled={messagesLoading} onClick={() => void retryMessages.current?.()} className="mt-2 font-semibold underline disabled:opacity-50">Retry conversation</button></div>}
            <div aria-label="Conversation messages" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-5">
              {historyNotice && <p role="status" className="text-center text-xs text-slate-500">{historyNotice}</p>}
              {hasOlder && <button onClick={() => void older()} disabled={olderLoading} className="mx-auto block text-xs font-bold text-blue-700">{olderLoading ? 'Loading…' : 'Load earlier messages'}</button>}
              {messagesLoading && <p className="text-center text-sm text-slate-500">Loading conversation…</p>}
              {messages.map((message) => {
              const mine = message.sender_id === user.id;
              return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className="max-w-[78%]">
                <div className={`rounded-2xl px-4 py-3 text-base leading-normal shadow-sm ${mine ? 'rounded-br-md bg-blue-700 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><p className={`mt-1 text-xs ${mine ? 'text-blue-100' : 'text-slate-500'}`}>{formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}{mine ? ` · ${message.read_at ? 'Read' : 'Sent'}` : ''}</p></div>
                {!mine && <ReportButton kind="message" target={message.id} />}
              </div></div>;
            })}<div ref={endRef} /></div>
            {incoming(active) && <div className="border-t bg-amber-50 p-4"><p className="text-sm text-amber-950">Accept this request to reply.</p><div className="mt-3 flex gap-3"><button disabled={acting} onClick={() => void respond('accepted')} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">Accept request</button><button disabled={acting} onClick={() => void respond('declined')} className="rounded-lg border border-amber-300 px-4 py-2 text-sm">Decline</button></div></div>}
            {closed(active) ? <p className="border-t p-4 text-sm text-slate-500">{active.request_status === 'blocked' ? 'This conversation is blocked. No more messages can be sent.' : 'This request was declined.'}</p> : !incoming(active) && <>
              {active.request_status === 'pending' && <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-900">{messages.length ? 'Waiting for acceptance before you can send more messages.' : 'Send one introduction. You can continue when they accept.'}</p>}
              <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3 sm:p-4"><textarea aria-label="Private message" rows={2} value={body} onChange={(event) => setBody(event.target.value)} disabled={!canSend || sending} maxLength={4000} required placeholder="Write a message…" className="max-h-40 min-w-0 flex-1 resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100" /><button type="submit" disabled={!canSend || sending || !body.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40" aria-label={sending ? 'Sending message' : 'Send message'}><Send size={18} /></button></form>
            </>}
          </> : <div className="grid flex-1 place-items-center p-8 text-center"><div><MessageCircle className="mx-auto text-slate-300" size={42} /><h2 className="mt-3 text-xl font-black text-slate-800">Choose a conversation</h2><p className="mt-1 text-sm text-slate-500">Or start one with a public username.</p></div></div>}
        </section>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Lock size={12} />Not end-to-end encrypted. <Link href="/privacy" className="underline hover:text-slate-700">Privacy details</Link></p>
      {error && !composeOpen && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
    </main>
  );
}
