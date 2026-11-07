'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import styles from './ResizablePostLayout.module.css';

const DEFAULT_SPLIT = 70;
const STORAGE_KEY = 'visathreads.content-layout.v2';
const DIVIDER_WIDTH = 32;
const MIN_SPLIT_WIDTH = 1000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** One ratio and resize preference for every content page with a supporting panel. */
export function ResizablePostLayout({ children, related, mainLabel = 'Post', relatedLabel = 'Also asked panel', className = '' }: {
  children: ReactNode; related: ReactNode; mainLabel?: string; relatedLabel?: string; className?: string;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startSplit: number; width: number; preference: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pendingSplit = useRef(DEFAULT_SPLIT);
  const [preference, setPreference] = useState(DEFAULT_SPLIT);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const available = Math.max(1, width - DIVIDER_WIDTH);
  // At the desktop breakpoint both panels remain readable, even at either limit.
  const min = width >= MIN_SPLIT_WIDTH ? Math.max(40, Math.ceil(440 / available * 100)) : 40;
  const max = width >= MIN_SPLIT_WIDTH ? Math.min(75, Math.floor((1 - 280 / available) * 100)) : 75;
  const split = clamp(preference, min, max);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const value = stored === null ? NaN : Number(stored);
      if (Number.isFinite(value) && value >= 40 && value <= 75) setPreference(value);
    } catch { /* Resizing still works when browser storage is unavailable. */ }
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const value = event.newValue === null ? DEFAULT_SPLIT : Number(event.newValue);
      if (!drag.current && Number.isFinite(value) && value >= 40 && value <= 75) setPreference(value);
    };
    window.addEventListener('storage', syncPreference);
    const element = container.current;
    if (!element) return () => window.removeEventListener('storage', syncPreference);
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); window.removeEventListener('storage', syncPreference); cancelFrame(); };
  }, []);

  function cancelFrame() {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  function save(value: number) {
    setPreference(value);
    try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Optional preference. */ }
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    cancelFrame();
    drag.current = null;
    setDragging(false);
    if (cancelled) setPreference(active.preference);
    else save(clamp(active.startSplit + (event.clientX - active.startX) / active.width * 100, min, max));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className={`${styles.container} ${className}`}>
    <div ref={container} className={`${styles.layout} ${dragging ? styles.dragging : ''}`} style={{ '--post-split': `${split}fr`, '--related-split': `${100 - split}fr` } as CSSProperties}>
      <div id={`${id}-post`} className={styles.post}>{children}</div>
      <div role="separator" tabIndex={0} aria-label={mainLabel} aria-orientation="vertical"
        aria-controls={`${id}-post`} aria-describedby={`${id}-keys`}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(split)}
        aria-valuetext={`${Math.round(split)} percent ${mainLabel.toLowerCase()}, ${Math.round(100 - split)} percent ${relatedLabel.toLowerCase()}`}
        className={styles.divider} title="Resize panels"
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0 || !container.current || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          const paneWidth = container.current.getBoundingClientRect().width - DIVIDER_WIDTH;
          if (paneWidth <= 0) return;
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startSplit: split, width: paneWidth, preference };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={event => {
          const active = drag.current;
          if (active?.pointerId !== event.pointerId) return;
          pendingSplit.current = clamp(active.startSplit + (event.clientX - active.startX) / active.width * 100, min, max);
          // Apply the latest position once per paint, without queuing pointer events.
          if (frame.current === null) frame.current = window.requestAnimationFrame(() => {
            frame.current = null;
            setPreference(pendingSplit.current);
          });
        }}
        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
        onLostPointerCapture={() => {
          if (drag.current) { cancelFrame(); setPreference(drag.current.preference); drag.current = null; setDragging(false); }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) {
            const active = drag.current;
            cancelFrame();
            drag.current = null; setDragging(false); setPreference(active.preference);
            if (event.currentTarget.hasPointerCapture(active.pointerId)) event.currentTarget.releasePointerCapture(active.pointerId);
            event.preventDefault(); return;
          }
          if (drag.current) return;
          const step = event.shiftKey ? 5 : 1;
          const next = event.key === 'ArrowLeft' ? split - step : event.key === 'ArrowRight' ? split + step
            : event.key === 'Home' ? min : event.key === 'End' ? max : null;
          if (next !== null) { event.preventDefault(); save(clamp(next, min, max)); }
        }} />
      <aside aria-label={relatedLabel} tabIndex={width >= MIN_SPLIT_WIDTH ? 0 : undefined} className={styles.related}>{related}</aside>
    </div>
    <p id={`${id}-keys`} className="sr-only capitalize">Use left and right arrow keys to resize, Shift for larger steps, Home or End for the limits. Press Escape to cancel a drag.</p>
  </div>;
}
