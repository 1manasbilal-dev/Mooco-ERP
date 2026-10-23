import React, { useRef } from 'react';

interface Props {
  children: React.ReactNode;
  label: string;
  className?: string;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * Horizontal gestures change views; vertical gestures belong to the page.
 * Touches that start on a form control or inside `[data-no-swipe]` are ignored.
 * Arrow keys are left to the controls inside (SegmentedControl handles its own).
 */
export default function SwipeRegion({ children, label, className = '', onNext, onPrevious }: Props) {
  const gesture = useRef<{ x: number; y: number; time: number; axis: 'x' | 'y' | null } | null>(null);
  const lastSwipe = useRef(-Infinity);
  return <div className={`overview-swipe-region min-w-0 touch-pan-y touch-pinch-zoom ${className}`} role="region" aria-label={label}
    onTouchStart={event => {
      const target = event.target as HTMLElement;
      if (event.touches.length !== 1 || target.closest('input, select, textarea, a, [contenteditable="true"], [role="slider"], [data-no-swipe]')) {
        gesture.current = null;
        return;
      }
      const touch = event.touches[0];
      // Keep the browser's navigation gestures available at the screen edges.
      if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) { gesture.current = null; return; }
      gesture.current = { x: touch.clientX, y: touch.clientY, time: performance.now(), axis: null };
    }}
    onTouchMove={event => {
      const start = gesture.current;
      if (!start || event.touches.length !== 1) { gesture.current = null; return; }
      const touch = event.touches[0];
      const x = Math.abs(touch.clientX - start.x);
      const y = Math.abs(touch.clientY - start.y);
      if (!start.axis && Math.max(x, y) > 12) {
        if (x > y * 1.3) start.axis = 'x';
        else if (y > x) start.axis = 'y';
      }
    }}
    onTouchEnd={event => {
      const start = gesture.current;
      gesture.current = null;
      if (!start || start.axis === 'y' || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const x = touch.clientX - start.x;
      const y = touch.clientY - start.y;
      const distance = Math.abs(x);
      const velocity = distance / Math.max(1, performance.now() - start.time);
      if (distance < 36 || distance < Math.abs(y) * 1.3 || (distance < 60 && velocity < 0.4)) return;
      lastSwipe.current = performance.now();
      if (x < 0) onNext(); else onPrevious();
    }}
    onTouchCancel={() => { gesture.current = null; }}
    onClickCapture={event => {
      if (event.detail !== 0 && performance.now() - lastSwipe.current < 450) { event.preventDefault(); event.stopPropagation(); }
    }}>
    {children}
  </div>;
}
