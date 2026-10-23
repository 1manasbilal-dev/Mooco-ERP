import { memo, useState } from 'react';
import { cn } from '../../lib/cn';

interface ProductThumbProps {
  name: string;
  src?: string;
  /** Size and shape come from the caller, e.g. `size-10 rounded-xl` or `aspect-[4/3] w-full`. */
  className?: string;
  /** Text size of the initials fallback. */
  initialsClassName?: string;
  dimmed?: boolean;
}

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase() || '?';

/**
 * Product photo in a fixed box so the list never jumps while images decode.
 * Falls back to the product's initials when there is no photo or it fails to load.
 */
export const ProductThumb = memo(function ProductThumb({ name, src, className, initialsClassName, dimmed }: ProductThumbProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 ring-1 ring-inset ring-line/70', className)}>
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className={cn('size-full object-cover', dimmed && 'opacity-60 grayscale')}
        />
      ) : (
        <span aria-hidden="true" className={cn('select-none font-bold tracking-tight text-fg-faint', initialsClassName ?? 'text-sm')}>
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
});
