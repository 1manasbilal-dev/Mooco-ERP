import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../ui';
import { cn } from '../../lib/cn';
import { optimizeImage, type OptimizationResult } from '../../lib/imageOptimizer';

/** Phone photos are a few MB; anything this big is not a product photo and would stall the browser. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

interface Props {
  value?: string;
  name: string;
  disabled?: boolean;
  onChange: (dataUrl: string) => void;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

function problemWith(file: File): string | null {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return 'iPhone ki HEIC photo yahan nahi khulti. Camera ko JPG/"Most Compatible" par set karein ya screenshot use karein.';
  if (!file.type.startsWith('image/')) return 'Yeh photo nahi hai. JPG, PNG ya WebP file chunein.';
  if (file.size > MAX_SOURCE_BYTES) return 'Photo bohat bari hai (25 MB se zyada). Choti photo chunein.';
  return null;
}

/** Product photo: pick or drop a file, it is shrunk to a small WebP before it is stored. */
export function ImageUploadField({ value, name, disabled, onChange, onError, onBusyChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [info, setInfo] = useState<OptimizationResult | null>(null);
  // A slow photo that finishes after the form closed or another photo was picked must not win.
  const runRef = useRef(0);
  useEffect(() => () => { runRef.current += 1; }, []);

  const setBusyState = (next: boolean) => {
    setBusy(next);
    onBusyChange?.(next);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || disabled) return;
    const problem = problemWith(file);
    if (problem) {
      onError(problem);
      return;
    }
    const run = ++runRef.current;
    setBusyState(true);
    try {
      const result = await optimizeImage(file, { maxDimension: 500, quality: 0.82, preferredFormat: 'image/webp' });
      if (run !== runRef.current) return;
      onChange(result.dataUrl);
      setInfo(result);
    } catch (err: any) {
      if (run !== runRef.current) return;
      console.error('Image optimization error:', err);
      onError(err?.message === 'Failed to load image data'
        ? 'Yeh photo browser mein nahi khul saki. JPG ya PNG try karein.'
        : `Photo process nahi hui: ${err?.message || 'unknown error'}`);
    } finally {
      if (run === runRef.current) setBusyState(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const pick = () => { if (!busy && !disabled) inputRef.current?.click(); };

  const dropProps = {
    onDragOver: (event: React.DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      // Without preventDefault the browser opens the dropped file and the form is lost.
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      setDragOver(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      setDragOver(false);
      void handleFile(event.dataTransfer.files?.[0]);
    },
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={event => void handleFile(event.target.files?.[0])}
    />
  );

  if (value) {
    return (
      <div {...dropProps} className={cn('flex items-center gap-4 rounded-card border border-line bg-surface-2 p-3 transition-colors', dragOver && 'border-brand-accent bg-brand-soft')}>
        {input}
        <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-surface ring-1 ring-inset ring-line">
          <img src={value} alt={name ? `${name} photo` : 'Product photo'} className="size-full object-cover" decoding="async" />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/80">
              <Loader2 className="size-5 animate-spin text-brand-fg" aria-label="Photo process ho rahi hai" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-fg-subtle">
            {info
              ? <><span className="font-semibold text-success-fg">{info.optimizedSizeFormatted}</span> ({info.originalSizeFormatted} se {info.savedPercentage}% chhoti, {info.width}×{info.height}px)</>
              : 'Photo catalog aur POS mein dikhegi.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={pick} disabled={busy || disabled}>Badlein</Button>
            <Button size="sm" variant="danger-soft" leftIcon={<Trash2 />} onClick={() => { runRef.current += 1; setInfo(null); setBusyState(false); onChange(''); }} disabled={disabled}>Hatayen</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    {input}
    <button
      type="button"
      {...dropProps}
      onClick={pick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cn(
        'flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed border-line-strong/70 bg-surface-2/60 px-4 py-6 text-center transition-colors',
        'hover:border-brand-accent hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        dragOver && 'border-brand-accent bg-brand-soft',
        busy && 'cursor-wait',
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-surface text-fg-muted shadow-e1">
        {busy ? <Loader2 className="size-5 animate-spin text-brand-fg" /> : <ImagePlus className="size-5" />}
      </span>
      <span className="text-sm font-semibold text-fg">{busy ? 'Photo chhoti ki ja rahi hai...' : 'Photo add karein'}</span>
      <span className="max-w-xs text-xs text-fg-subtle">Click karein ya photo yahan chhoren. Bari photo khud ~30-50 KB ki ho jati hai.</span>
    </button>
    </>
  );
}
