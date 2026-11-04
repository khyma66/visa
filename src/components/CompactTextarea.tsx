'use client';

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** A small composer that grows with drafts and shrinks again when cleared. */
export function CompactTextarea({ rows = 1, value, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    let width = 0;
    function resize() {
      if (!element) return;
      element.style.height = 'auto';
      const style = getComputedStyle(element);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      element.style.height = `${element.scrollHeight + border}px`;
    }
    resize();
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, rows]);
  return <textarea {...props} ref={field} rows={rows} value={value} className={`compact-composer ${className}`} />;
}
