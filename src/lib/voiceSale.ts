import { calculateQuickEntry } from './posQuickEntry';
import { cleanNumber, cleanQty, formatQty } from './formatters';
import { convertQuantity, unitTypeOf } from './unitConversion';

/**
 * Voice sale: turns what the cashier says at the counter ("do kilo dahi aur 200 ka doodh", the same
 * in Urdu script, or plain English) into bill lines. Pure functions only, so the rules are unit tested;
 * the microphone and the cart live in `usePosVoice`.
 *
 * Steps: `parseVoiceSale` splits the words into items and a command, `matchVoiceProduct` finds the
 * catalog product an item names, and `planVoiceLine` picks the sell unit and quantity for it.
 */

export type VoiceCommand = 'save' | 'undo' | 'stop';
type SpokenUnit = 'kg' | 'g' | 'pao' | 'L' | 'ml' | 'pcs';

export interface VoiceSegment {
  /** The words of this item as heard, for the panel. */
  text: string;
  /** Product words, as concepts (doodh / دودھ / milk all read "milk"). */
  concepts: string[];
  /** Other words that may still be part of a product name (Latin only, singular). */
  words: string[];
  /** The number said, if any (already combined: "do sau" = 200, "saarhe teen" = 3.5). */
  qty?: number;
  unit?: SpokenUnit;
  /** True when the number is rupees ("200 ka dahi", "200 rupay ka doodh"). */
  money: boolean;
  /** A pack word: dozen, tray, cup, tub, bottle, box or pack. */
  pack?: string;
}

export interface VoiceUtterance {
  segments: VoiceSegment[];
  command?: VoiceCommand;
}

export interface VoicePack {
  id: string;
  name?: string;
  quantity_in_base_unit?: number;
  isActive?: boolean;
}

export interface VoiceProduct {
  id: string;
  name: string;
  unit?: string;
  allow_loose_sale?: boolean;
  variants?: VoicePack[];
}

/** One way the counter can sell a product right now (the POS `PosSellOption`). */
export interface VoiceSellOption {
  id: string;
  name: string;
  kind: 'loose' | 'multi' | 'packed';
  contains: number;
  price: number;
}

export type VoiceMatch =
  | { kind: 'one'; productId: string }
  | { kind: 'choose'; productIds: string[]; key: string }
  | { kind: 'none' };

export type VoicePlan =
  /** `byAmount`: the cashier said rupees, so `total` is that exact amount (the cart keeps it as the line total). */
  | { kind: 'add'; optionId: string; qty: number; rate: number; total: number; byAmount: boolean }
  | { kind: 'choose'; optionIds: string[]; key: string }
  | { kind: 'problem'; message: string };

type Token =
  | { k: 'num'; v: number }
  | { k: 'mult'; v: number }
  | { k: 'mod'; v: number }
  | { k: 'unit'; v: SpokenUnit }
  | { k: 'money' }
  | { k: 'pack'; v: string }
  | { k: 'prod'; v: string }
  | { k: 'cmd'; v: VoiceCommand }
  | { k: 'bill' }
  | { k: 'verb' }
  | { k: 'of' }
  | { k: 'fill' }
  | { k: 'break' }
  | { k: 'word'; v: string };

const lexicon = new Map<string, Token>();
const put = (token: Token, words: string[]) => words.forEach(word => lexicon.set(word, token));

const NUMBERS: [number, string[]][] = [
  [1, ['ek', 'aik', 'ik', 'one', 'ایک', 'اک']],
  [2, ['do', 'two', 'دو']],
  [3, ['teen', 'tin', 'three', 'تین']],
  [4, ['char', 'chaar', 'four', 'چار']],
  [5, ['panch', 'paanch', 'five', 'پانچ']],
  [6, ['chay', 'chhe', 'che', 'chhay', 'chhey', 'six', 'چھ', 'چھے']],
  [7, ['saat', 'sat', 'seven', 'سات']],
  [8, ['aath', 'ath', 'eight', 'آٹھ']],
  [9, ['nau', 'nine', 'نو']],
  [10, ['das', 'dus', 'ten', 'دس']],
  [11, ['gyarah', 'giyarah', 'gyara', 'eleven', 'گیارہ']],
  [12, ['barah', 'baarah', 'baara', 'twelve', 'بارہ']],
  [13, ['terah', 'tera', 'تیرہ']],
  [14, ['chaudah', 'chodah', 'چودہ']],
  [15, ['pandrah', 'pandra', 'fifteen', 'پندرہ']],
  [16, ['solah', 'sola', 'سولہ']],
  [17, ['satrah', 'satra', 'سترہ']],
  [18, ['atharah', 'athara', 'اٹھارہ']],
  [19, ['unnees', 'unees', 'انیس']],
  [20, ['bees', 'twenty', 'بیس']],
  [25, ['pachees', 'pachis', 'پچیس']],
  [30, ['tees', 'thirty', 'تیس']],
  [35, ['paintees', 'پینتیس']],
  [40, ['chalees', 'chalis', 'forty', 'چالیس']],
  [45, ['paintalees', 'پینتالیس']],
  [50, ['pachaas', 'pachas', 'fifty', 'پچاس']],
  [60, ['saath', 'sixty', 'ساٹھ']],
  [70, ['sattar', 'seventy', 'ستر']],
  [75, ['pachattar', 'پچھتر']],
  [80, ['assi', 'eighty', 'اسی']],
  [90, ['nawway', 'nabbe', 'ninety', 'نوے']],
  [0.5, ['aadha', 'adha', 'aadhi', 'adhi', 'aadhe', 'half', 'آدھا', 'آدھی', 'آدھے']],
  [1.5, ['dedh', 'deadh', 'derh', 'ڈیڑھ']],
  [2.5, ['dhai', 'dhaai', 'ڈھائی']],
];
NUMBERS.forEach(([value, words]) => put({ k: 'num', v: value }, words));
put({ k: 'mult', v: 100 }, ['sau', 'so', 'hundred', 'سو']);
put({ k: 'mult', v: 1000 }, ['hazar', 'hazaar', 'thousand', 'ہزار']);
put({ k: 'mod', v: 0.25 }, ['sawa', 'سوا']);
put({ k: 'mod', v: 0.5 }, ['sarhe', 'saarhe', 'sadhe', 'saade', 'sare', 'ساڑھے']);
put({ k: 'mod', v: -0.25 }, ['paune', 'pone', 'pauney', 'پونے', 'پونا']);

put({ k: 'unit', v: 'kg' }, ['kilo', 'kg', 'kgs', 'kilogram', 'kilograms', 'killo', 'کلو']);
put({ k: 'unit', v: 'g' }, ['gram', 'grams', 'gm', 'gms', 'g', 'گرام']);
put({ k: 'unit', v: 'pao' }, ['pao', 'paao', 'pau', 'paav', 'paw', 'quarter', 'پاؤ', 'پاو']);
put({ k: 'unit', v: 'L' }, ['litre', 'liter', 'litres', 'liters', 'litr', 'ltr', 'l', 'لیٹر', 'لٹر']);
put({ k: 'unit', v: 'ml' }, ['ml']);
put({ k: 'unit', v: 'pcs' }, ['piece', 'pieces', 'pc', 'pcs', 'adad', 'dana', 'daane', 'dane', 'پیس', 'عدد', 'دانے', 'دانہ']);
put({ k: 'money' }, ['rupay', 'rupaye', 'rupey', 'rupee', 'rupees', 'rs', 'pkr', 'روپے', 'روپیہ', 'روپئے', 'روپیے', 'روپ']);

const PACKS: Record<string, string[]> = {
  dozen: ['dozen', 'dozens', 'darjan', 'darjen', 'darzan', 'درجن'],
  tray: ['tray', 'trays', 'tre', 'trey', 'peti', 'crate', 'ٹرے', 'پیٹی'],
  cup: ['cup', 'cups', 'کپ', 'پیالی'],
  tub: ['tub', 'tubs', 'ٹب'],
  bottle: ['bottle', 'bottles', 'botal', 'bottal', 'بوتل', 'بوتلیں'],
  box: ['box', 'boxes', 'dabba', 'dabbe', 'dibba', 'ڈبہ', 'ڈبا', 'ڈبے', 'باکس'],
  pack: ['pack', 'packs', 'packet', 'packets', 'paket', 'پیکٹ', 'پیک'],
};
Object.entries(PACKS).forEach(([pack, words]) => put({ k: 'pack', v: pack }, words));

// Product words. Catalog names go through the same table, so "Cow Milk", "gaye ka doodh" and
// "گائے کا دودھ" all read cow + milk.
const PRODUCTS: Record<string, string[]> = {
  milk: ['milk', 'doodh', 'dudh', 'dood', 'doodth', 'دودھ', 'دودہ', 'دوده'],
  cow: ['cow', 'gaye', 'gae', 'gai', 'gaey', 'gaay', 'gaaye', 'گائے', 'گاۓ', 'گائ', 'گاے'],
  buffalo: ['buffalo', 'bhains', 'bhens', 'bhainss', 'بھینس'],
  yogurt: ['yogurt', 'yoghurt', 'curd', 'dahi', 'dahee', 'dehi', 'دہی', 'دھی'],
  egg: ['egg', 'eggs', 'anda', 'anday', 'ande', 'aanda', 'andey', 'andy', 'انڈا', 'انڈے', 'انڈہ', 'انڈوں'],
  ghee: ['ghee', 'ghi', 'گھی'],
  desi: ['desi', 'deshi', 'دیسی'],
  kheer: ['kheer', 'khir', 'کھیر'],
  shahi: ['shahi', 'شاہی'],
  almond: ['badam', 'badaam', 'almond', 'almonds', 'بادام'],
  bread: ['bread', 'roti', 'بریڈ', 'روٹی'],
  large: ['large', 'big', 'bara', 'bari', 'bada', 'badi', 'baray', 'bare', 'barey', 'bade', 'badey', 'بڑا', 'بڑی', 'بڑے'],
  small: ['small', 'chhota', 'chota', 'choti', 'chhoti', 'chote', 'chhote', 'چھوٹا', 'چھوٹی', 'چھوٹے'],
  cake: ['cake', 'cakes', 'کیک'],
  fruit: ['fruit', 'فروٹ'],
  muffin: ['muffin', 'muffins', 'مفن', 'مفنز'],
  rusk: ['rusk', 'rusks', 'rus', 'russ', 'papay', 'paape', 'رسک', 'رس', 'پاپے'],
  bran: ['bran', 'brown', 'براؤن', 'بران'],
  dawn: ['dawn', 'ڈان'],
  butter: ['butter', 'makhan', 'makkhan', 'مکھن'],
  cream: ['cream', 'malai', 'ملائی', 'کریم'],
  lassi: ['lassi', 'لسی'],
  cheese: ['cheese', 'paneer', 'پنیر'],
  special: ['special', 'اسپیشل', 'سپیشل'],
};
Object.entries(PRODUCTS).forEach(([concept, words]) => put({ k: 'prod', v: concept }, words));

put({ k: 'cmd', v: 'save' }, ['save', 'checkout', 'سیو', 'محفوظ']);
put({ k: 'cmd', v: 'undo' }, ['undo', 'cancel', 'hatao', 'hatado', 'remove', 'ghalat', 'galat', 'wrong', 'کینسل', 'ہٹاؤ', 'ہٹاو', 'غلط']);
put({ k: 'cmd', v: 'stop' }, ['stop', 'ruko', 'رکو']);
put({ k: 'bill' }, ['bill', 'بل']);
put({ k: 'verb' }, ['banao', 'bana', 'banado', 'karo', 'kar', 'kardo', 'complete', 'done', 'بناؤ', 'بنا', 'بنادو', 'کرو', 'کر', 'کردو', 'مکمل']);
put({ k: 'of' }, ['ka', 'ki', 'ke', 'kay', 'kaa', 'kee', 'of', 'worth', 'کا', 'کی', 'کے']);
put({ k: 'fill' }, [
  'wala', 'wali', 'wale', 'walay', 'والا', 'والی', 'والے', 'ji', 'jee', 'bhai', 'please', 'plz', 'mujhe', 'muje', 'hamein',
  'chahiye', 'chahye', 'چاہیے', 'چاہئے', 'bhi', 'بھی', 'de', 'dein', 'dena', 'دے', 'دیں', 'دینا', 'is', 'ye', 'yeh', 'یہ',
  'the', 'a', 'an', 'give', 'me', 'double', 'ڈبل', 'mein', 'میں', 'hai', 'ہے', 'more',
]);
put({ k: 'break' }, [',', 'aur', 'or', 'and', 'plus', 'phir', 'fir', 'then', 'اور', 'پھر']);

// Brand and marketing words tell products apart only when said; leaving them out costs nothing.
const OPTIONAL_CONCEPTS = new Set(['dawn', 'special', 'desi']);

// Multi-word phrases first, so "de do" is not read as the number 2 and "double roti" is bread.
const PHRASES: [RegExp, string][] = [
  [/(^|\s)(de do|dey do|de dein|de dijiye|de dijye|dedo|dedain|de dena)(?=\s|$)/g, ' '],
  [/(^|\s)(دے دو|دے دیں|دے دیجیے|دے دیجئے|دیجیے|دیجئے|دے دینا)(?=\s|$)/g, ' '],
  [/(^|\s)(hata do|hata dein|ہٹا دو|ہٹا دیں)(?=\s|$)/g, ' hatao '],
  [/(^|\s)(band karo|band kar do|mic band|بند کرو|بند کر دو)(?=\s|$)/g, ' stop '],
  [/(^|\s)(milli ?litres?|milli ?liters?|ملی لیٹر|ملی لٹر)(?=\s|$)/g, ' ml '],
  [/(^|\s)(کلو گرام)(?=\s|$)/g, ' کلو '],
];

const URDU_DIGIT_BASE = [0x06f0, 0x0660];

/** Lower case, Western digits, one spelling per Urdu letter, punctuation as item breaks. */
export function normalizeSpeech(text: string): string {
  let out = String(text || '')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ہ')
    .replace(/[۰-۹٠-٩]/g, d => {
      const code = d.charCodeAt(0);
      const base = URDU_DIGIT_BASE.find(b => code >= b && code <= b + 9) ?? 0x06f0;
      return String(code - base);
    })
    .replace(/(\d)[,٬](\d{3})(?!\d)/g, '$1$2')
    .replace(/(^|\s)rs\.\s*/g, '$1rs ')
    .replace(/(\d+)\s*\/\s*(\d+)/g, (_, a, b) => (Number(b) ? String(cleanQty(Number(a) / Number(b))) : `${a} ${b}`))
    .replace(/(\d)(?=[^\d\s.])/g, '$1 ')
    .replace(/([^\d\s.])(?=\d)/g, '$1 ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' , ')
    .replace(/[،؛,;:!?؟۔"“”'‘’()[\]{}\-–—]/g, ' , ');
  PHRASES.forEach(([pattern, replacement]) => { out = out.replace(pattern, (_m, lead) => `${lead}${replacement}`); });
  return out.replace(/\s+/g, ' ').trim();
}

const singular = (word: string) => (/^[a-z]{4,}s$/.test(word) ? word.slice(0, -1) : word);

function tokenize(text: string): { token: Token; word: string }[] {
  return normalizeSpeech(text).split(' ').filter(Boolean).map(word => {
    const known = lexicon.get(word);
    if (known) return { token: known, word };
    if (/^\d*\.?\d+$/.test(word)) return { token: { k: 'num', v: Number(word) }, word };
    const single = singular(word);
    const knownSingle = lexicon.get(single);
    if (knownSingle) return { token: knownSingle, word };
    return { token: { k: 'word', v: single }, word };
  });
}

/** Reads one run of number words: "do sau" 200, "saarhe teen" 3.5, "sawa sau" 125, "ek hazaar paanch sau" 1500. */
function readNumber(tokens: Token[]): number | undefined {
  let total = 0;
  let current = 0;
  let mod = 0;
  let seen = false;
  for (const token of tokens) {
    if (token.k === 'mod') { mod = token.v; seen = true; continue; }
    if (token.k === 'num') {
      current += token.v + mod;
      mod = 0;
      seen = true;
    } else if (token.k === 'mult') {
      current = ((current || 1) + (current ? 0 : mod)) * token.v;
      mod = 0;
      seen = true;
      if (token.v >= 1000) { total += current; current = 0; }
    }
  }
  if (!seen) return undefined;
  const value = cleanQty(total + current + mod);
  return value > 0 ? value : undefined;
}

interface Draft {
  words: string[];
  numberTokens: Token[];
  /** True while the number run is still open (no other word since it started). */
  numberOpen: boolean;
  concepts: string[];
  rawWords: string[];
  unit?: SpokenUnit;
  money: boolean;
  ofAfterNumber: boolean;
  pack?: string;
  /** Last meaningful token class, to tell "gaye ka doodh" (one product) from "dahi do kilo anday" (two items). */
  last: 'num' | 'unit' | 'prod' | 'none';
}

const emptyDraft = (): Draft => ({ words: [], numberTokens: [], numberOpen: false, concepts: [], rawWords: [], money: false, ofAfterNumber: false, last: 'none' });
const hasQty = (d: Draft) => d.numberTokens.length > 0 || Boolean(d.unit) || Boolean(d.pack);
// Only known product words count: an unknown word may be chatter, so it never closes an item.
const hasProduct = (d: Draft) => d.concepts.length > 0;

function finish(draft: Draft): VoiceSegment | null {
  if (draft.words.length === 0) return null;
  const qty = readNumber(draft.numberTokens);
  return {
    text: draft.words.join(' '),
    concepts: Array.from(new Set(draft.concepts)),
    words: Array.from(new Set(draft.rawWords)),
    qty,
    unit: draft.unit,
    // "200 ka dahi": a number with "ka" and no unit is rupees. "do ka" (2 rupees) is not a sale.
    money: draft.money || (draft.ofAfterNumber && !draft.unit && !draft.pack && qty !== undefined && qty >= 10),
    pack: draft.pack,
  };
}

/**
 * Splits one spoken sentence into items and an optional command. Items break at "aur" / "اور" /
 * commas, and also where a new quantity or product starts after a complete item, so
 * "do kilo dahi ek darjan anday" is two items.
 */
export function parseVoiceSale(text: string): VoiceUtterance {
  const tokens = tokenize(text);
  const segments: VoiceSegment[] = [];
  let command: VoiceCommand | undefined;
  let draft = emptyDraft();
  const close = () => {
    const segment = finish(draft);
    if (segment) segments.push(segment);
    draft = emptyDraft();
  };

  tokens.forEach(({ token, word }, index) => {
    const next = tokens[index + 1]?.token;
    switch (token.k) {
      case 'break':
        close();
        return;
      case 'cmd':
        command = token.v;
        return;
      case 'bill':
        if (next?.k === 'verb' || (next?.k === 'cmd' && next.v === 'save')) command = 'save';
        return;
      case 'verb':
      case 'fill':
        return;
      case 'of':
        if (draft.last === 'num' && !draft.unit) draft.ofAfterNumber = true;
        draft.numberOpen = false;
        draft.words.push(word);
        return;
      case 'money':
        draft.money = true;
        draft.numberOpen = false;
        draft.words.push(word);
        return;
      case 'num':
      case 'mult':
      case 'mod': {
        // "pao kilo": pao before a weight is the number 1/4.
        if (!draft.numberOpen && hasQty(draft) && hasProduct(draft)) close();
        else if (!draft.numberOpen && draft.numberTokens.length > 0) close();
        draft.numberTokens.push(token);
        draft.numberOpen = true;
        draft.last = 'num';
        draft.words.push(word);
        return;
      }
      case 'unit': {
        if (token.v === 'pao' && next?.k === 'unit' && (next.v === 'kg' || next.v === 'L')) {
          if (!draft.numberOpen && hasQty(draft) && hasProduct(draft)) close();
          draft.numberTokens.push({ k: 'num', v: 0.25 });
          draft.numberOpen = true;
          draft.last = 'num';
          draft.words.push(word);
          return;
        }
        if (draft.unit && hasProduct(draft)) close();
        draft.unit = token.v;
        draft.numberOpen = false;
        draft.last = 'unit';
        draft.words.push(word);
        return;
      }
      case 'pack': {
        if ((draft.pack || draft.unit) && hasProduct(draft)) close();
        draft.pack = token.v;
        draft.numberOpen = false;
        draft.last = 'unit';
        draft.words.push(word);
        return;
      }
      case 'prod': {
        // A product word after a finished item starts the next one ("dahi do kilo anday ek darjan").
        if (hasProduct(draft) && hasQty(draft) && draft.last !== 'prod') close();
        draft.concepts.push(token.v);
        draft.numberOpen = false;
        draft.last = 'prod';
        draft.words.push(word);
        return;
      }
      case 'word':
        // Words the table does not know never split an item: they may be chatter ("taaza") or a
        // catalog name the table lacks, which `matchVoiceProduct` still compares.
        draft.rawWords.push(token.v);
        draft.numberOpen = false;
        draft.words.push(word);
        return;
    }
  });
  close();

  // "ek aur dahi" splits into "ek" + "dahi": a lone quantity joins the product that follows it.
  const merged: VoiceSegment[] = [];
  segments.forEach(segment => {
    const previous = merged[merged.length - 1];
    const lonely = (s: VoiceSegment) => s.concepts.length === 0 && s.words.length === 0;
    const noQty = (s: VoiceSegment) => s.qty === undefined && !s.unit && !s.pack && !s.money;
    if (previous && lonely(previous) && !lonely(segment) && noQty(segment)) {
      merged[merged.length - 1] = { ...segment, text: `${previous.text} ${segment.text}`, qty: previous.qty, unit: previous.unit, money: previous.money, pack: previous.pack };
    } else {
      merged.push(segment);
    }
  });
  // A trailing "do" with nothing after it is the verb "give", not the number 2.
  const last = merged[merged.length - 1];
  if (last && last.concepts.length === 0 && last.words.length === 0 && !last.unit && !last.pack && !last.money && (last.text === 'do' || last.text === 'دو')) merged.pop();
  return { segments: merged, command };
}

const nameTokens = (name: string) => normalizeSpeech(name).split(' ').filter(Boolean).map(word => {
  const known = lexicon.get(word) || lexicon.get(singular(word));
  return { known, word: singular(word) };
});

/** Product concepts and leftover Latin words of a catalog name ("Dawn Bread Large" → dawn, bread, large). */
export function productConcepts(name: string): { concepts: Set<string>; words: Set<string> } {
  const concepts = new Set<string>();
  const words = new Set<string>();
  nameTokens(name).forEach(({ known, word }) => {
    if (known?.k === 'prod') concepts.add(known.v);
    else if (!known && /^[a-z]{3,}$/.test(word)) words.add(word);
  });
  return { concepts, words };
}

/** Pack concept of a variant name ("Shahi Kheer Cup" → cup), or undefined for a pack with no pack word. */
export function packConcept(name?: string): string | undefined {
  for (const { known } of nameTokens(name || '')) if (known?.k === 'pack') return known.v;
  return undefined;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** The key a cashier's earlier pick is remembered under, e.g. "milk" when "doodh" alone was said. */
export const voicePickKey = (segment: Pick<VoiceSegment, 'concepts' | 'words'>) => [...segment.concepts, ...segment.words].sort().join('+');

const wordsMatch = (said: string, own: string) => said === own || (said.length >= 5 && editDistanceAtMostOne(said, own));

/**
 * Finds the product an item names. Every product word said (doodh, gaye...) must be in the product's
 * name; other words only add weight when the name has them. The product with the fewest of its own
 * words left unsaid wins. A tie becomes a choice, unless the cashier picked one of the tied products
 * for the same words before (`picks`).
 */
export function matchVoiceProduct(segment: VoiceSegment, products: VoiceProduct[], picks: Record<string, string> = {}): VoiceMatch {
  const said = segment.concepts;
  const saidWords = segment.words.filter(word => /^[a-z]{3,}$/.test(word));
  if (said.length === 0 && saidWords.length === 0) {
    // "ek darjan" alone: the only product that has dozens.
    if (!segment.pack) return { kind: 'none' };
    const withPack = products.filter(p => (p.variants || []).some(v => v.isActive !== false && packConcept(v.name) === segment.pack));
    if (withPack.length === 1) return { kind: 'one', productId: withPack[0].id };
    return withPack.length > 1 ? { kind: 'choose', productIds: withPack.map(p => p.id), key: `pack:${segment.pack}` } : { kind: 'none' };
  }

  let best = -Infinity;
  let tied: VoiceProduct[] = [];
  products.forEach(product => {
    const own = productConcepts(product.name);
    if (!said.every(concept => own.concepts.has(concept))) return;
    const ownWords = Array.from(own.words);
    const matchedWords = saidWords.filter(word => ownWords.some(w => wordsMatch(word, w))).length;
    const matched = said.length + matchedWords;
    if (matched === 0) return;
    const unsaid = Array.from(own.concepts).filter(c => !said.includes(c) && !OPTIONAL_CONCEPTS.has(c)).length
      + ownWords.filter(w => !saidWords.some(s => wordsMatch(s, w))).length;
    const score = matched * 10 - unsaid;
    if (score > best) { best = score; tied = [product]; }
    else if (score === best) tied.push(product);
  });

  if (tied.length === 0) return { kind: 'none' };
  if (tied.length === 1) return { kind: 'one', productId: tied[0].id };
  const key = voicePickKey(segment);
  const remembered = picks[key];
  if (remembered && tied.some(p => p.id === remembered)) return { kind: 'one', productId: remembered };
  return { kind: 'choose', productIds: tied.map(p => p.id), key };
}

const SPOKEN_FACTOR: Record<Exclude<SpokenUnit, 'pcs'>, { base: 'kg' | 'L'; factor: number }> = {
  kg: { base: 'kg', factor: 1 },
  g: { base: 'kg', factor: 0.001 },
  pao: { base: 'kg', factor: 0.25 },
  L: { base: 'L', factor: 1 },
  ml: { base: 'L', factor: 0.001 },
};

/**
 * A spoken weight or volume in the product's own unit. At the counter a "kilo" of milk is a litre,
 * so kg and L stand in for each other; null when the product is not sold by weight or volume.
 */
function spokenToProductUnit(qty: number, unit: Exclude<SpokenUnit, 'pcs'>, productUnit: string): number | null {
  const type = unitTypeOf(productUnit);
  if (type !== 'Mass' && type !== 'Volume') return null;
  const { base, factor } = SPOKEN_FACTOR[unit];
  const inBase = qty * factor;
  const productBase = type === 'Mass' ? 'kg' : 'L';
  return convertQuantity(inBase, base === productBase ? base : productBase, productUnit);
}

const describe = (qty: number, option: VoiceSellOption, product: VoiceProduct) =>
  `${formatQty(qty, 3)} ${option.kind === 'loose' ? product.unit || 'unit' : option.name}`;

/**
 * Picks the sell unit and quantity for a matched item, from the options the counter has now:
 * a pack word picks that pack, a weight sells loose (or the pack of that size when loose sale is off),
 * rupees divide by the rate, and a bare number counts the base unit or the only pack.
 */
export function planVoiceLine(segment: VoiceSegment, product: VoiceProduct, options: VoiceSellOption[], picks: Record<string, string> = {}): VoicePlan {
  const loose = options.find(o => o.kind === 'loose');
  const packs = options.filter(o => o.kind !== 'loose');
  const name = product.name.trim();
  const said = segment.qty;

  const byAmount = (option: VoiceSellOption, amount: number): VoicePlan => {
    const entry = calculateQuickEntry(String(amount), 'amount', option.price, option.kind === 'packed');
    if (entry.error) return { kind: 'problem', message: `${name}: ${entry.error}` };
    return { kind: 'add', optionId: option.id, qty: entry.qty, rate: option.price, total: entry.total, byAmount: true };
  };
  const byQty = (option: VoiceSellOption, qty: number): VoicePlan => {
    if (!(qty > 0)) return { kind: 'problem', message: `${name}: say a quantity above zero.` };
    if (option.kind === 'packed' && Math.abs(qty - Math.round(qty)) > 0.001) {
      return { kind: 'problem', message: `${name}: ${option.name} is sold in whole numbers, not ${formatQty(qty, 3)}.` };
    }
    if (!(option.price > 0)) return { kind: 'problem', message: `${name}: set a selling rate before adding this item.` };
    const clean = cleanQty(qty);
    return { kind: 'add', optionId: option.id, qty: clean, rate: option.price, total: cleanNumber(clean * option.price), byAmount: false };
  };
  const choosePack = (candidates: VoiceSellOption[]): VoicePlan => {
    const key = `pack:${product.id}`;
    const remembered = candidates.find(o => o.id === picks[key]);
    if (remembered) return { kind: 'add', optionId: remembered.id, qty: 0, rate: remembered.price, total: 0, byAmount: false };
    return { kind: 'choose', optionIds: candidates.map(o => o.id), key };
  };
  // A remembered pack is returned with qty 0 by choosePack; finish it with the amount or count said.
  const withPack = (plan: VoicePlan, fill: (option: VoiceSellOption) => VoicePlan): VoicePlan => {
    if (plan.kind !== 'add') return plan;
    const option = options.find(o => o.id === plan.optionId);
    return option ? fill(option) : plan;
  };

  if (options.length === 0) return { kind: 'problem', message: `${name}: no unit of this product is on sale right now.` };

  if (segment.pack) {
    const option = packs.find(o => packConcept(o.name) === segment.pack);
    if (option) return segment.money && said ? byAmount(option, said) : byQty(option, said ?? 1);
    // "ek darjan muffin" with no Dozen pack: 12 loose pieces.
    if (segment.pack === 'dozen' && loose && unitTypeOf(product.unit) === 'Count') return byQty(loose, (said ?? 1) * 12);
    return { kind: 'problem', message: `${name} has no ${segment.pack} pack on sale.` };
  }

  if (segment.money && said) {
    if (loose) return byAmount(loose, said);
    if (packs.length === 1) return byAmount(packs[0], said);
    return withPack(choosePack(packs), option => byAmount(option, said));
  }

  if (segment.unit && segment.unit !== 'pcs') {
    const qty = spokenToProductUnit(said ?? 1, segment.unit, product.unit || '');
    if (qty === null) return { kind: 'problem', message: `${name} is sold in ${product.unit || 'units'}, not by ${segment.unit === 'L' || segment.unit === 'ml' ? 'volume' : 'weight'}.` };
    if (loose) return byQty(loose, qty);
    // Loose sale is off: "aadha kilo kheer" is the 0.5 kg tub, "1 kilo" is two of them.
    const exact = packs.find(o => Math.abs(o.contains - qty) < 0.001);
    if (exact) return byQty(exact, 1);
    const whole = packs.filter(o => o.contains > 0 && Math.abs(qty / o.contains - Math.round(qty / o.contains)) < 0.001);
    if (whole.length === 1) return byQty(whole[0], Math.round(qty / whole[0].contains));
    return { kind: 'problem', message: `${name} is sold in packs only. Say the pack, e.g. "${describe(1, packs[0], product)}".` };
  }

  // A bare number ("teen anday", "do dahi") counts the base unit, or the pack when there is no loose sale.
  // Shops never sell 50 kg of dahi by voice: a big bare number on a weight item is rupees.
  if (loose) {
    const byWeight = unitTypeOf(product.unit) === 'Mass' || unitTypeOf(product.unit) === 'Volume';
    if (byWeight && said !== undefined && said >= 50 && segment.unit !== 'pcs') return byAmount(loose, said);
    return byQty(loose, said ?? 1);
  }
  if (packs.length === 1) return byQty(packs[0], said ?? 1);
  return withPack(choosePack(packs), option => byQty(option, said ?? 1));
}

/** Rough confidence of a reading, to pick the best of the recogniser's alternatives. */
export function scoreVoiceReading(utterance: VoiceUtterance, products: VoiceProduct[], picks: Record<string, string> = {}): number {
  let score = utterance.command ? 1 : 0;
  utterance.segments.forEach(segment => {
    const match = matchVoiceProduct(segment, products, picks);
    score += match.kind === 'one' ? 3 : match.kind === 'choose' ? 1 : -2;
  });
  return score;
}
