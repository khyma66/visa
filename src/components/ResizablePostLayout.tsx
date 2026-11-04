'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import styles from './ResizablePostLayout.module.css';

const DEFAULT_SPLIT = 60;
const STORAGE_KEY = 'visathreads.post-layout.v1';
const DIVIDER_WIDTH = 32;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Shared by questions and experiences. Preferences contain only a panel width. */
export function ResizablePostLayout({ children, related }: { children: ReactNode; related: ReactNode }) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startSplit: number; width: number; preference: number } | null>(null);
  const [preference, setPreference] = useState(DEFAULT_SPLIT);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const available = Math.max(1, width - DIVIDER_WIDTH);
  // At the desktop breakpoint both panels remain readable, even at either limit.
  const min = width >= 800 ? Math.max(40, Math.ceil(440 / available * 100)) : 40;
  const max = width >= 800 ? Math.min(75, Math.floor((1 - 280 / available) * 100)) : 75;
  const split = clamp(preference, min, max);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const value = stored === null ? NaN : Number(stored);
      if (Number.isFinite(value) && value >= 40 && value <= 75) setPreference(value);
    } catch { /* Resizing still works when browser storage is unavailable. */ }
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function save(value: number) {
    setPreference(value);
    try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Optional preference. */ }
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (cancelled) setPreference(active.preference);
    else save(clamp(active.startSplit + (event.clientX - active.startX) / active.width * 100, min, max));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div>
    <div className={styles.controls}>
      <span id={`${id}-hint`}>Drag divider to resize</span>
      <span className={styles.ratio}>{Math.round(split)}% post / {Math.round(100 - split)}% related</span>
      <button type="button" onClick={() => save(clamp(split - 5, min, max))} disabled={split <= min} aria-label="Widen related questions" title="Widen related questions">←</button>
      <button type="button" onClick={() => save(clamp(split + 5, min, max))} disabled={split >= max} aria-label="Widen post" title="Widen post">→</button>
      <button type="button" onClick={() => save(DEFAULT_SPLIT)} disabled={preference === DEFAULT_SPLIT}>Reset 60/40</button>
    </div>
    <div ref={container} className={`${styles.layout} ${dragging ? styles.dragging : ''}`} style={{ '--post-split': `${split}fr`, '--related-split': `${100 - split}fr` } as CSSProperties}>
      <div id={`${id}-post`} className={styles.post}>{children}</div>
      <div role="separator" tabIndex={0} aria-label="Post" aria-orientation="vertical"
        aria-controls={`${id}-post`} aria-describedby={`${id}-hint ${id}-keys`}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(split)}
        aria-valuetext={`${Math.round(split)} percent post, ${Math.round(100 - split)} percent related questions`}
        className={styles.divider} title="Drag to resize. Double-click to reset to 60/40."
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
          if (active?.pointerId === event.pointerId) setPreference(clamp(active.startSplit + (event.clientX - active.startX) / active.width * 100, min, max));
        }}
        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
        onLostPointerCapture={() => {
          if (drag.current) { setPreference(drag.current.preference); drag.current = null; setDragging(false); }
        }}
        onDoubleClick={() => save(DEFAULT_SPLIT)}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) {
            const active = drag.current;
            drag.current = null; setDragging(false); setPreference(active.preference);
            if (event.currentTarget.hasPointerCapture(active.pointerId)) event.currentTarget.releasePointerCapture(active.pointerId);
            event.preventDefault(); return;
          }
          if (drag.current) return;
          const step = event.shiftKey ? 5 : 1;
          const next = event.key === 'ArrowLeft' ? split - step : event.key === 'ArrowRight' ? split + step
            : event.key === 'Home' ? min : event.key === 'End' ? max : null;
          if (next !== null) { event.preventDefault(); save(clamp(next, min, max)); }
        }}>
        <span className={styles.grip} aria-hidden="true">⋮</span>
      </div>
      <aside aria-label="Related questions panel" className={styles.related}>{related}</aside>
    </div>
    <p id={`${id}-keys`} className="sr-only">Use left and right arrow keys to resize, Shift for larger steps, Home or End for the limits. Use Reset 60/40 to restore the default. Press Escape to cancel a drag.</p>
  </div>;
}
