import React from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface Props {
  children: React.ReactNode;
  className: string;
  label: string;
  labels: string[];
}

/** Native scrolling gives touch devices momentum and preserves page scrolling. */
export default function SwipeCards({ children, className, label, labels }: Props) {
  const reducedMotion = useReducedMotion();
  if (!labels.length) return null;
  return <div className="overview-carousel" role="group" aria-label={label}>
    <div className={`${className} overview-snap-track`} tabIndex={0} aria-label={`${label} cards`}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const element = event.currentTarget as HTMLDivElement;
        if (element.scrollWidth <= element.clientWidth + 2) return;
        const slides = Array.from(element.querySelectorAll<HTMLElement>(':scope > [data-carousel-slide]'));
        if (!slides.length) return;
        const active = slides.reduce((best, slide, index) => Math.abs(slide.offsetLeft - element.scrollLeft) < Math.abs(slides[best].offsetLeft - element.scrollLeft) ? index : best, 0);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1
          : Math.min(slides.length - 1, Math.max(0, active + (event.key === 'ArrowRight' ? 1 : -1)));
        event.preventDefault();
        element.scrollTo({ left: slides[index].offsetLeft, behavior: reducedMotion ? 'auto' : 'smooth' });
      }}>{children}</div>
  </div>;
}
