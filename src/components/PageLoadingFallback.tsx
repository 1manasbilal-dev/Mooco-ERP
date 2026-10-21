import React, { useEffect, useState } from 'react';
import { BarChart3, Droplets, RefreshCw } from 'lucide-react';
import { MOOCO_THEME } from '../theme';

export const PageLoadingFallback: React.FC<{ message?: string; submessage?: string; variant?: 'page' | 'overlay' }> = ({
  message = 'Your workspace is on its way',
  submessage = 'Getting everything ready for you',
  variant = 'page',
}) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className={`mooco-loader mooco-loader--${variant}`} aria-busy="true">
      <div className="mooco-loader-card">
        <div className="mooco-loader-scene" aria-hidden="true">
          <span className="mooco-loader-halo" />
          <span className="mooco-loader-satellite mooco-loader-satellite--milk"><Droplets size={21} strokeWidth={1.7} /></span>
          <div className="mooco-loader-emblem"><span>M</span><i /></div>
          <span className="mooco-loader-satellite mooco-loader-satellite--chart"><BarChart3 size={21} strokeWidth={1.7} /></span>
          <span className="mooco-loader-spark mooco-loader-spark--one" />
          <span className="mooco-loader-spark mooco-loader-spark--two" />
        </div>
        <div className="mooco-loader-brand" aria-hidden="true">MOOCO<span>.</span></div>
        <div className="mooco-loader-copy" role="status" aria-live="polite" aria-atomic="true">
          <h3>{message}</h3>
          <p>{slow ? 'Taking a little longer. You can reload if needed.' : submessage}</p>
        </div>
        <div className="mooco-loader-track" aria-hidden="true"><span /></div>
        <div className="mooco-loader-caption" aria-hidden="true"><span className="mooco-loader-dots"><i /><i /><i /></span>A little clarity. On its way.</div>
        {slow && (
          <button type="button" onClick={() => window.location.reload()} className={`${MOOCO_THEME.button.secondary} mooco-loader-retry`}>
            <RefreshCw size={14} aria-hidden="true" />Reload page
          </button>
        )}
      </div>
    </div>
  );
};

export default PageLoadingFallback;
