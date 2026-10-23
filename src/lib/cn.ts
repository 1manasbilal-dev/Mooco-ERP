import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the design-system shadow and radius names so `cn('shadow-e1', 'shadow-e2')` keeps only the last.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ['e1', 'e1-lit', 'e2', 'e3'] }],
      rounded: [{ rounded: ['card', 'control'] }],
    },
  },
});

/** Join class names and let later Tailwind classes override earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
