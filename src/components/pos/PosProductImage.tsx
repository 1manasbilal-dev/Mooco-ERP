import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface PosProductImageProps {
  name: string;
  imageUrl?: string;
  /** Size and shape, e.g. "aspect-square w-full rounded-xl". */
  className?: string;
  isAvailable?: boolean;
  children?: React.ReactNode;
}

/** Product photo with a lettered placeholder; overlays (badges) go in as children. */
export const PosProductImage: React.FC<PosProductImageProps> = ({
  name,
  imageUrl,
  className,
  isAvailable = true,
  children
}) => {
  const [failedSrc, setFailedSrc] = useState<string>();
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const activeSrc = imageUrl || undefined;
  const showImage = Boolean(activeSrc && failedSrc !== activeSrc);
  const isImageReady = showImage && loadedSrc === activeSrc;

  return (
    <div className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 ring-1 ring-inset ring-line/70', className)}>
      {showImage ? (
        <>
          {!isImageReady && <div className="absolute inset-0 animate-shimmer bg-surface-3/70" aria-hidden="true" />}
          <img
            src={activeSrc}
            alt={name}
            draggable={false}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedSrc(activeSrc)}
            onError={() => setFailedSrc(activeSrc)}
            className={cn(
              'relative h-full w-full object-cover transition-opacity duration-200',
              isImageReady ? 'opacity-100' : 'opacity-0',
              !isAvailable && 'grayscale-[40%]',
            )}
          />
        </>
      ) : (
        <div aria-hidden="true" className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-fg-faint">
          <Package className="size-[38%] max-h-10 max-w-10" strokeWidth={1.5} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{name.trim().slice(0, 3)}</span>
        </div>
      )}
      {children}
    </div>
  );
};
