import { AlertCircle, Check, Mic, MicOff, Undo2, X } from 'lucide-react';
import { Button, IconButton, Money, SegmentedControl } from '../ui';
import { cn } from '../../lib/cn';
import type { usePosVoice, VoiceLang, VoiceResult } from './usePosVoice';

type Voice = ReturnType<typeof usePosVoice>;

const LANGS = [
  { value: 'ur-PK' as VoiceLang, label: 'Urdu' },
  { value: 'en-IN' as VoiceLang, label: 'English' },
];

/** Mic button beside the product search. */
export function PosVoiceButton({ listening, onToggle }: { listening: boolean; onToggle: () => void }) {
  return (
    <Button
      variant={listening ? 'primary' : 'secondary'}
      size="lg"
      onClick={onToggle}
      aria-pressed={listening}
      aria-label={listening ? 'Stop voice sale (F7)' : 'Voice sale (F7)'}
      title={listening ? 'Stop voice sale (F7)' : 'Voice sale (F7): say the items instead of tapping'}
      leftIcon={<Mic />}
      className={cn('shrink-0 px-4', listening && 'pos-voice-live')}
    >
      <span className="hidden sm:inline">{listening ? 'Listening' : 'Voice'}</span>
    </Button>
  );
}

function ResultRow({ result, onChoose, onDismiss }: { result: VoiceResult; onChoose: (resultId: string, choiceId: string) => void; onDismiss: (resultId: string) => void }) {
  if (result.status === 'added') {
    return (
      <li className="flex items-center gap-2 rounded-control bg-success-soft px-3 py-1.5 text-sm text-success-fg">
        <Check className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-semibold">{result.label}</span>
        <Money amount={result.total} className="shrink-0 font-bold" />
      </li>
    );
  }
  if (result.status === 'saved') {
    return (
      <li className="flex items-center gap-2 rounded-control bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-fg">
        <Check className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{result.message}</span>
      </li>
    );
  }
  if (result.status === 'choose') {
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-fg ring-1 ring-inset ring-warning/25">
        <span dir="auto" className="min-w-0 font-semibold">{result.question}</span>
        <span className="flex flex-1 flex-wrap gap-1.5">
          {result.choices.map(choice => (
            <Button key={choice.id} size="md" variant="secondary" onClick={() => onChoose(result.id, choice.id)}>
              {choice.label}
            </Button>
          ))}
        </span>
        <IconButton size="sm" aria-label="Skip this item" icon={<X />} onClick={() => onDismiss(result.id)} />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 rounded-control bg-danger-soft px-3 py-1.5 text-sm text-danger-fg">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      <span dir="auto" className="min-w-0 flex-1">{result.message}</span>
      <IconButton size="sm" aria-label="Dismiss" icon={<X />} onClick={() => onDismiss(result.id)} />
    </li>
  );
}

/** What the mic heard and did: items added, choices to tap, problems. Shown while voice sale is in use. */
export function PosVoicePanel({ voice }: { voice: Voice }) {
  const { listening, interim, lastHeard, micError, results, lang, setLang, toggle, stop, choose, dismiss, clearResults, undoLast, canUndo } = voice;
  const heard = interim || lastHeard;
  return (
    <section aria-label="Voice sale" className="pos-voice-panel shrink-0 rounded-card border border-line bg-surface p-3 shadow-e1">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={listening}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
          className={cn(
            'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            listening ? 'pos-voice-live bg-brand text-brand-on' : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-line hover:bg-surface-3',
          )}
        >
          {listening ? <Mic className="size-5" aria-hidden="true" /> : <MicOff className="size-5" aria-hidden="true" />}
        </button>
        <div className="min-w-[10rem] flex-1">
          <p className="text-xs font-semibold text-fg-muted">{listening ? 'Listening — say the items' : 'Voice sale paused · tap the mic to go on'}</p>
          <p dir="auto" aria-live="polite" className={cn('truncate text-[15px] font-semibold', heard ? 'text-fg' : 'text-fg-subtle')}>
            {heard ? `“${heard}”` : 'Waiting for you to speak…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl size="sm" aria-label="Voice language" options={LANGS} value={lang} onChange={setLang} />
          {canUndo && (
            <Button variant="secondary" size="md" leftIcon={<Undo2 />} onClick={undoLast}>
              Undo
            </Button>
          )}
          <IconButton aria-label="Close voice sale" icon={<X />} onClick={() => { stop(); clearResults(); }} />
        </div>
      </div>

      {micError && (
        <p role="alert" className="mt-2 rounded-control bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-fg">{micError}</p>
      )}

      {results.length > 0 ? (
        <ul className="mt-2 flex max-h-[7.25rem] flex-col gap-1 overflow-y-auto" aria-label="Heard items">
          {results.map(result => <ResultRow key={result.id} result={result} onChoose={choose} onDismiss={dismiss} />)}
        </ul>
      ) : (
        !micError && (
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
            Say each item with its amount, for example “2 kilo dahi”, “200 ka doodh” or “1 darjan anday”. Say “save” to save the bill, or “ghalat” to take back the last entry.
          </p>
        )
      )}
    </section>
  );
}
