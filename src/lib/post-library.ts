import { getSupabase } from './supabase/client';

export type LibraryEntry = { post_id: string; saved: boolean; followed: boolean };
export type LibrarySelection = 'saved' | 'followed';
export type LibrarySnapshot = { entry: LibraryEntry; loading: boolean; error: boolean };
type Store = { userId: string; values: Map<string, LibrarySnapshot>; listeners: Set<() => void>; changes: Set<() => void>; pending: Set<string>; scheduled: boolean };
let current: Store | undefined;
const empty = new Map<string, LibrarySnapshot>();
export function emptyLibraryEntry(id: string): LibrarySnapshot {
  if (!empty.has(id)) empty.set(id, { entry: { post_id: id, saved: false, followed: false }, loading: true, error: false });
  return empty.get(id)!;
}
export function libraryStore(userId: string): Store {
  if (current?.userId !== userId) current = { userId, values: new Map(), listeners: new Set(), changes: new Set(), pending: new Set(), scheduled: false };
  return current;
}
function publish(store: Store, entry: LibraryEntry) {
  store.values.set(entry.post_id, { entry, loading: false, error: false });
  store.listeners.forEach(listener => listener());
}
export function watchLibrary(store: Store, id: string, listener: () => void) {
  store.listeners.add(listener);
  {
    store.pending.add(id);
    if (!store.scheduled) {
      store.scheduled = true;
      queueMicrotask(() => { void loadPending(store); });
    }
  }
  return () => { store.listeners.delete(listener); };
}
async function loadPending(store: Store) {
  const ids = [...store.pending].slice(0,100);
  ids.forEach(id => store.pending.delete(id));
  const previous = new Map(ids.map(id => [id, store.values.get(id)]));
  try {
    const { data, error } = await getSupabase().rpc('post_library_state', { targets: ids }).abortSignal(AbortSignal.timeout(8000));
    if (error || !Array.isArray(data)) throw new Error('Library unavailable');
    if (current !== store) return;
    for (const id of ids) {
      // A successful user action takes precedence over an older read.
      if (store.values.get(id) === previous.get(id)) publish(store, data.find((entry: LibraryEntry) => entry.post_id === id) ?? { post_id: id, saved: false, followed: false });
    }
  } catch {
    if (current === store) for (const id of ids) if (!store.values.has(id)) {
      store.values.set(id, { ...emptyLibraryEntry(id), loading: false, error: true });
    }
    store.listeners.forEach(listener => listener());
  } finally {
    store.scheduled = false;
    if (store.pending.size && current === store) { store.scheduled = true; queueMicrotask(() => { void loadPending(store); }); }
  }
}
export async function changeLibraryEntry(store: Store, id: string, selection: LibrarySelection, enabled: boolean) {
  const { data: identity, error: identityError } = await getSupabase().auth.getUser();
  if (identityError || identity.user?.id !== store.userId || current !== store) throw new Error('Your account changed. Please try again.');
  const { data, error } = await getSupabase().rpc('set_post_library', { target: id, selection, enabled, expected_user: store.userId }).abortSignal(AbortSignal.timeout(8000));
  if (error || !data || data.post_id !== id) throw new Error('Could not update your post library. Please try again.');
  if (current === store) { publish(store, data as LibraryEntry); store.changes.forEach(listener => listener()); }
}
export function retryLibrary(store: Store, id: string) {
  store.values.delete(id);
  store.listeners.forEach(listener => listener());
  const stop = watchLibrary(store,id,()=>{}); stop();
}
export async function listLibrary(selection: LibrarySelection, page: number) {
  const { data, error } = await getSupabase().rpc('list_post_library', { selection, page_number: page }).abortSignal(AbortSignal.timeout(8000));
  if (error || !Array.isArray(data)) throw new Error('Your posts could not be loaded. Please try again.');
  return { entries: data.slice(0,20) as LibraryEntry[], more: data.length > 20 };
}

export function subscribeLibraryChanges(userId: string, listener: () => void) {
  const store = libraryStore(userId); store.changes.add(listener);
  return () => { store.changes.delete(listener); };
}
