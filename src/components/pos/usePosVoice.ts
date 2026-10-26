import { useCallback, useEffect, useRef, useState } from 'react';
import { formatQty } from '../../lib/formatters';
import {
  matchVoiceProduct,
  parseVoiceSale,
  planVoiceLine,
  scoreVoiceReading,
  type VoiceSegment,
} from '../../lib/voiceSale';
import type { AvailableProduct } from './PosTypes';
import type { PosSellOption } from './posStock';

/**
 * Voice sale at the counter: the browser's speech recogniser (Chrome / Edge, Google's engine, free)
 * hears the cashier, `voiceSale` reads the words, and each item goes on the bill through the same
 * `addToCart` a tap uses. Items are added one per render, because `addToCart` reads the cart of the
 * render it came from.
 */

export type VoiceLang = 'ur-PK' | 'en-IN';

export type VoiceResult =
  | { id: string; status: 'added'; heard: string; label: string; total: number }
  | { id: string; status: 'choose'; heard: string; question: string; choices: { id: string; label: string }[]; segment: VoiceSegment; key: string; productId?: string }
  | { id: string; status: 'problem'; heard: string; message: string }
  | { id: string; status: 'saved'; heard: string; message: string };

type Job =
  | { kind: 'line'; segment: VoiceSegment; startsUndo: boolean }
  | { kind: 'remove'; segment: VoiceSegment }
  | { kind: 'undo' }
  | { kind: 'save' }
  | { kind: 'stop' };

interface Options {
  products: AvailableProduct[];
  /** False while POS is off screen, billing a customer order or saving: the mic stops. */
  enabled: boolean;
  cart: any[];
  setCart: (cart: any[]) => void;
  /** Sell options for a product after the latest cart. */
  sellOptions: (product: AvailableProduct) => PosSellOption[];
  /** Puts the line on the bill; returns why it can't (stock, hidden pack), or null when added. `amount` is a spoken rupee total. */
  addLine: (product: AvailableProduct, option: PosSellOption, qty: number, amount?: number) => string | null;
  /** Takes every line of this product off the bill; false when there was none. */
  removeProduct: (productId: string) => boolean;
  checkout: () => Promise<boolean>;
  /** Called when items are heard, e.g. to close the last bill's receipt for the next customer. */
  onItemsHeard?: () => void;
}

const PICKS_KEY = 'mooco_voice_picks';
const LANG_KEY = 'mooco_voice_lang';
const MAX_RESULTS = 8;

const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeStore = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: picks last this visit only */ }
};

const recognizerClass = (): any => {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const voiceSupported = () => Boolean(recognizerClass());

let nextId = 0;
const newId = () => `voice_${Date.now()}_${nextId++}`;

const MIC_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone for this site in the browser, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow the microphone for this site in the browser, then try again.',
  'audio-capture': 'No microphone found. Plug in a microphone and try again.',
  network: 'Voice needs the internet. Check the connection and try again.',
  'language-not-supported': 'This browser cannot hear that language. Switch to English or use Chrome.',
};

export function usePosVoice({ products, enabled, cart, setCart, sellOptions, addLine, removeProduct, checkout, onItemsHeard }: Options) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [lastHeard, setLastHeard] = useState('');
  const [micError, setMicError] = useState('');
  const [results, setResults] = useState<VoiceResult[]>([]);
  const [queue, setQueue] = useState<Job[]>([]);
  const [lang, setLangState] = useState<VoiceLang>(() => (readStore<string>(LANG_KEY, 'ur-PK') === 'en-IN' ? 'en-IN' : 'ur-PK'));
  // The bill as voice last left it; Undo is offered only while the bill is still exactly that.
  const [undoAfter, setUndoAfter] = useState<any[] | null>(null);

  const recognizer = useRef<any>(null);
  const wantListening = useRef(false);
  const restarts = useRef<number[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const picks = useRef<Record<string, string>>(readStore(PICKS_KEY, {}));
  const busy = useRef(false);
  // Undo puts back the bill as it was before the last sentence that changed it.
  const undoBefore = useRef<any[] | null>(null);
  // Panel rows of the sentence Undo would take back, so they leave the panel with it.
  const undoRows = useRef<string[]>([]);
  const sentenceStart = useRef<{ cart: any[]; changed: boolean; rows: string[] } | null>(null);
  const settleUndo = useRef(false);
  const latest = useRef({ products, cart, setCart, sellOptions, addLine, removeProduct, checkout, onItemsHeard });
  latest.current = { products, cart, setCart, sellOptions, addLine, removeProduct, checkout, onItemsHeard };

  const beep = useCallback((kind: 'ok' | 'ask' | 'error' | 'saved') => {
    try {
      const ctx = audio.current;
      if (!ctx) return;
      const tones = { ok: [880], ask: [620, 620], error: [240], saved: [880, 1175] }[kind];
      tones.forEach((frequency, index) => {
        const start = ctx.currentTime + index * 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === 'error' ? 0.3 : 0.12));
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.32);
      });
    } catch { /* no sound is fine */ }
  }, []);

  const pushResult = useCallback((result: VoiceResult) => {
    setResults(previous => [result, ...previous].slice(0, MAX_RESULTS));
  }, []);

  /** Turns one final sentence (and the recogniser's other guesses) into jobs. */
  const hear = useCallback((alternatives: string[]) => {
    const readings = alternatives.map(text => ({ text, utterance: parseVoiceSale(text) }));
    const best = readings.reduce((winner, reading) =>
      scoreVoiceReading(reading.utterance, latest.current.products, picks.current) > scoreVoiceReading(winner.utterance, latest.current.products, picks.current) ? reading : winner, readings[0]);
    if (!best) return;
    const { segments, command } = best.utterance;
    setLastHeard(best.text.trim());
    const jobs: Job[] = [];
    if (command === 'undo') {
      const named = segments.filter(segment => segment.concepts.length > 0 || segment.words.length > 0);
      if (named.length > 0) named.forEach(segment => jobs.push({ kind: 'remove', segment }));
      else jobs.push({ kind: 'undo' });
    } else {
      segments.forEach((segment, index) => jobs.push({ kind: 'line', segment, startsUndo: index === 0 }));
      if (command === 'save') jobs.push({ kind: 'save' });
      if (command === 'stop') jobs.push({ kind: 'stop' });
    }
    if (jobs.some(job => job.kind === 'line' || job.kind === 'remove')) latest.current.onItemsHeard?.();
    if (jobs.length > 0) setQueue(previous => [...previous, ...jobs]);
  }, []);

  const stop = useCallback(() => {
    wantListening.current = false;
    setListening(false);
    setInterim('');
    try { recognizer.current?.abort(); } catch { /* already stopped */ }
  }, []);

  const startRecognizer = useCallback((language: VoiceLang) => {
    const Recognizer = recognizerClass();
    if (!Recognizer) return;
    try { recognizer.current?.abort(); } catch { /* none running */ }
    const rec = new Recognizer();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = (event: any) => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const alternatives = Array.from(result as ArrayLike<{ transcript: string }>).map(alt => alt.transcript).filter(Boolean);
          if (alternatives.length > 0) hear(alternatives);
        } else {
          partial += result[0]?.transcript || '';
        }
      }
      setInterim(partial.trim());
    };
    rec.onerror = (event: any) => {
      const message = MIC_ERRORS[event?.error];
      if (message) {
        setMicError(message);
        stop();
        beep('error');
      }
    };
    // Chrome ends a session after a pause or about a minute; keep listening until the cashier stops,
    // but give up if it keeps ending at once (no network, mic taken by another app).
    rec.onend = () => {
      if (recognizer.current !== rec || !wantListening.current) return;
      const now = Date.now();
      restarts.current = [...restarts.current.filter(time => now - time < 10000), now];
      if (restarts.current.length > 6) {
        setMicError('The microphone keeps stopping. Check the internet and the microphone, then start again.');
        stop();
        return;
      }
      window.setTimeout(() => {
        if (recognizer.current === rec && wantListening.current) {
          try { rec.start(); } catch { /* starting twice throws; the running one is fine */ }
        }
      }, 200);
    };
    recognizer.current = rec;
    try { rec.start(); } catch { /* already running */ }
  }, [beep, hear, stop]);

  const start = useCallback(() => {
    if (!recognizerClass()) return;
    setMicError('');
    restarts.current = [];
    // Sound needs a tap or key press to start, so the context is made here.
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!audio.current && Ctx) audio.current = new Ctx();
      void audio.current?.resume();
    } catch { /* no sound */ }
    wantListening.current = true;
    setListening(true);
    startRecognizer(lang);
  }, [lang, startRecognizer]);

  const toggle = useCallback(() => { if (wantListening.current) stop(); else start(); }, [start, stop]);

  const setLang = useCallback((next: VoiceLang) => {
    setLangState(next);
    writeStore(LANG_KEY, next);
    if (wantListening.current) startRecognizer(next);
  }, [startRecognizer]);

  useEffect(() => { if (!enabled && wantListening.current) stop(); }, [enabled, stop]);
  useEffect(() => () => {
    wantListening.current = false;
    try { recognizer.current?.abort(); } catch { /* gone */ }
    void audio.current?.close().catch(() => {});
  }, []);

  /** One item: find the product, then the unit and quantity, then put it on the bill. */
  const runLine = (segment: VoiceSegment): VoiceResult | null => {
    const { products: catalog, sellOptions: optionsOf, addLine: add } = latest.current;
    const heard = segment.text;
    const match = matchVoiceProduct(segment, catalog, picks.current);
    if (match.kind === 'none') {
      const saidQty = segment.qty !== undefined || segment.unit || segment.pack || segment.money;
      // Chatter with no quantity ("shukriya") is not an item; say nothing.
      if (!saidQty && segment.concepts.length === 0) return null;
      return { id: newId(), status: 'problem', heard, message: `No product found for “${heard}”.` };
    }
    if (match.kind === 'choose') {
      const choices = match.productIds.map(id => catalog.find(p => p.id === id)).filter(Boolean).map(p => ({ id: p!.id, label: p!.name.trim() }));
      return { id: newId(), status: 'choose', heard, question: `Which one for “${heard}”?`, choices, segment, key: match.key };
    }
    const product = catalog.find(p => p.id === match.productId);
    if (!product) return { id: newId(), status: 'problem', heard, message: `No product found for “${heard}”.` };
    const options = optionsOf(product);
    const plan = planVoiceLine(segment, product, options, picks.current);
    if (plan.kind === 'problem') return { id: newId(), status: 'problem', heard, message: plan.message };
    if (plan.kind === 'choose') {
      const choices = plan.optionIds.map(id => options.find(o => o.id === id)).filter(Boolean).map(o => ({ id: o!.id, label: o!.name }));
      return { id: newId(), status: 'choose', heard, question: `Which ${product.name.trim()}?`, choices, segment, key: plan.key, productId: product.id };
    }
    const option = options.find(o => o.id === plan.optionId);
    if (!option) return { id: newId(), status: 'problem', heard, message: `${product.name.trim()}: this unit is not on sale.` };
    const problem = add(product, option, plan.qty, plan.byAmount ? plan.total : undefined);
    if (problem) return { id: newId(), status: 'problem', heard, message: problem };
    const name = product.name.trim();
    const packName = option.name.trim();
    // "Shahi Kheer Cup · 2", not "Shahi Kheer · 2 Shahi Kheer Cup".
    const label = option.kind === 'loose'
      ? `${name} · ${formatQty(plan.qty, 3)} ${product.unit || 'unit'}`
      : packName.toLowerCase().includes(name.toLowerCase()) ? `${packName} · ${formatQty(plan.qty, 3)}` : `${name} · ${formatQty(plan.qty, 3)} ${packName}`;
    return { id: newId(), status: 'added', heard, label, total: plan.total };
  };

  // Work through the queue one job per render, after the previous job's cart update has rendered.
  useEffect(() => {
    if (settleUndo.current && queue.length === 0) {
      settleUndo.current = false;
      setUndoAfter(cart);
    }
    if (busy.current || queue.length === 0) return;
    const [job] = queue;
    const done = () => setQueue(previous => previous.slice(1));
    const { cart: currentCart, setCart: replaceCart, removeProduct: remove, checkout: save } = latest.current;
    // The first change a sentence makes keeps the bill from before it, for Undo.
    const changed = (rowId: string) => {
      const start = sentenceStart.current;
      if (!start) return;
      if (!start.changed) { start.changed = true; undoBefore.current = start.cart; undoRows.current = start.rows; }
      start.rows.push(rowId);
      settleUndo.current = true;
    };

    if (job.kind === 'line') {
      if (job.startsUndo) sentenceStart.current = { cart: currentCart, changed: false, rows: [] };
      const result = runLine(job.segment);
      if (result) {
        pushResult(result);
        beep(result.status === 'added' ? 'ok' : result.status === 'choose' ? 'ask' : 'error');
        if (result.status === 'added') changed(result.id);
      }
      done();
      return;
    }
    if (job.kind === 'remove') {
      const match = matchVoiceProduct(job.segment, latest.current.products, picks.current);
      const product = match.kind === 'one' ? latest.current.products.find(p => p.id === match.productId) : undefined;
      sentenceStart.current = { cart: currentCart, changed: false, rows: [] };
      const removed = product ? remove(product.id) : false;
      const row: VoiceResult = removed
        ? { id: newId(), status: 'saved', heard: job.segment.text, message: `${product!.name.trim()} removed from the bill` }
        : { id: newId(), status: 'problem', heard: job.segment.text, message: `“${job.segment.text}” is not on the bill.` };
      pushResult(row);
      beep(removed ? 'ok' : 'error');
      if (removed) changed(row.id);
      done();
      return;
    }
    if (job.kind === 'undo') {
      const before = undoBefore.current;
      if (before && undoAfter === currentCart) {
        replaceCart(before);
        const rows = new Set(undoRows.current);
        undoBefore.current = null;
        undoRows.current = [];
        setUndoAfter(null);
        setResults(previous => previous.filter(r => r.status !== 'choose' && !rows.has(r.id)));
        pushResult({ id: newId(), status: 'saved', heard: 'undo', message: 'Last voice entry taken back' });
        beep('ok');
      } else {
        pushResult({ id: newId(), status: 'problem', heard: 'undo', message: before ? 'The bill changed since then. Remove the line by hand.' : 'Nothing to take back.' });
        beep('error');
      }
      done();
      return;
    }
    if (job.kind === 'stop') {
      stop();
      done();
      return;
    }
    // Save: never with an item still waiting for its pick, so a half-heard bill is not saved.
    if (currentCart.length === 0) {
      pushResult({ id: newId(), status: 'problem', heard: 'save', message: 'The bill is empty.' });
      beep('error');
      done();
      return;
    }
    if (results.some(r => r.status === 'choose')) {
      pushResult({ id: newId(), status: 'problem', heard: 'save', message: 'Pick the item asked about first, then say save.' });
      beep('error');
      done();
      return;
    }
    busy.current = true;
    void save().then(saved => {
      if (saved) {
        undoBefore.current = null;
        setUndoAfter(null);
        // The next customer starts with a clean panel.
        setResults([{ id: newId(), status: 'saved', heard: 'save', message: 'Bill saved' }]);
        beep('saved');
      } else {
        pushResult({ id: newId(), status: 'problem', heard: 'save', message: 'The bill was not saved. See the message on screen.' });
        beep('error');
      }
    }).catch(() => beep('error')).finally(() => {
      busy.current = false;
      done();
    });
    // Runs once per queue or cart change on purpose; everything else it reads is from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, cart]);

  /** A tap on one of the choices: remember it for these words and add the item. */
  const choose = useCallback((resultId: string, choiceId: string) => {
    const result = results.find(r => r.id === resultId);
    if (!result || result.status !== 'choose') return;
    picks.current = { ...picks.current, [result.key]: choiceId };
    writeStore(PICKS_KEY, picks.current);
    setResults(previous => previous.filter(r => r.id !== resultId));
    setQueue(previous => [...previous, { kind: 'line', segment: result.segment, startsUndo: true }]);
  }, [results]);

  const dismiss = useCallback((resultId: string) => setResults(previous => previous.filter(r => r.id !== resultId)), []);
  const clearResults = useCallback(() => { setResults([]); setLastHeard(''); setMicError(''); }, []);
  const undoLast = useCallback(() => setQueue(previous => [...previous, { kind: 'undo' }]), []);

  const canUndo = undoAfter !== null && undoAfter === cart && cart.length > 0;

  return { supported: voiceSupported(), listening, interim, lastHeard, micError, results, lang, setLang, start, stop, toggle, choose, dismiss, clearResults, undoLast, canUndo };
}
