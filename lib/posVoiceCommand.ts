export type PosVoiceProduct = {
  id: string;
  name: string;
  unit?: string;
  price?: number;
  pos_primary_mode?: 'amount' | 'qty';
};

export type PosVoiceCommand =
  | { type: 'save' }
  | { type: 'cancel' }
  | {
      type: 'add';
      product: PosVoiceProduct;
      mode: 'amount' | 'quantity';
      value: number;
    }
  | { type: 'error'; message: string };

const BASIC_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  aik: 1,
  ek: 1,
  two: 2,
  do: 2,
  three: 3,
  teen: 3,
  four: 4,
  char: 4,
  chaar: 4,
  five: 5,
  paanch: 5,
  panch: 5,
  six: 6,
  che: 6,
  chay: 6,
  chhe: 6,
  seven: 7,
  saat: 7,
  sat: 7,
  eight: 8,
  aath: 8,
  ath: 8,
  nine: 9,
  nau: 9,
  ten: 10,
  das: 10,
  eleven: 11,
  gyarah: 11,
  twelve: 12,
  barah: 12,
  thirteen: 13,
  terah: 13,
  fourteen: 14,
  chaudah: 14,
  fifteen: 15,
  pandrah: 15,
  sixteen: 16,
  solah: 16,
  seventeen: 17,
  satrah: 17,
  eighteen: 18,
  atharah: 18,
  nineteen: 19,
  unnis: 19,
  twenty: 20,
  bees: 20,
  thirty: 30,
  tees: 30,
  forty: 40,
  chalees: 40,
  chalis: 40,
  fifty: 50,
  pachaas: 50,
  pachas: 50,
  sixty: 60,
  saath: 60,
  seventy: 70,
  sattar: 70,
  eighty: 80,
  assi: 80,
  ninety: 90,
  nabbe: 90,
  nabey: 90,
  half: 0.5,
  aadha: 0.5,
  adha: 0.5,
  dedh: 1.5,
  sawa: 1.25,
  dhai: 2.5
};

const AMOUNT_WORDS = new Set([
  'rs', 'rupee', 'rupees', 'rupay', 'rupaye', 'pkr', 'amount', 'price'
]);

const QUANTITY_WORDS = new Set([
  'quantity', 'qty', 'unit', 'units', 'litre', 'litres', 'liter', 'liters',
  'ltr', 'kg', 'kilo', 'kilos', 'kilogram', 'grams', 'gram', 'packet',
  'packets', 'pack', 'packs', 'bottle', 'bottles', 'piece', 'pieces'
]);

const COMMAND_WORDS = new Set([
  ...AMOUNT_WORDS,
  ...QUANTITY_WORDS,
  'ka', 'ki', 'kay', 'ke', 'ko', 'add', 'karo', 'karein', 'karain', 'cart',
  'mein', 'main', 'please', 'mujhe', 'dein', 'den', 'wala', 'wali'
]);

export const normalizeVoiceText = (value: string): string => {
  return String(value || '')
    .toLowerCase()
    .replace(/\br\s*\.?\s*s\.?/g, ' rs ')
    .replace(/[₨₹]/g, ' rs ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const extractMoocoWakeCommand = (transcript: string): { detected: boolean; remainder: string } => {
  const normalized = normalizeVoiceText(transcript);
  const tokens = normalized.split(' ').filter(Boolean);
  const singleWordVariants = new Set(['mooco', 'moco', 'muko', 'muku', 'muco']);

  for (let index = 0; index < tokens.length; index += 1) {
    if (singleWordVariants.has(tokens[index])) {
      return { detected: true, remainder: tokens.slice(index + 1).join(' ') };
    }

    const pair = `${tokens[index]} ${tokens[index + 1] || ''}`;
    if (pair === 'moo co' || pair === 'moo cow' || pair === 'mu co') {
      return { detected: true, remainder: tokens.slice(index + 2).join(' ') };
    }
  }

  return { detected: false, remainder: '' };
};

const editDistance = (left: string, right: string): number => {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
};

const tokenSimilarity = (left: string, right: string): number => {
  if (left === right) return 1;
  if (left.length < 3 || right.length < 3) return 0;
  const distance = editDistance(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
};

const isNumberWord = (token: string): boolean => {
  return BASIC_NUMBERS[token] !== undefined || ['hundred', 'sau', 'so', 'thousand', 'hazar', 'hazaar', 'point', 'decimal'].includes(token);
};

const findProduct = <T extends PosVoiceProduct>(command: string, products: T[]): { product?: T; ambiguous?: string[] } => {
  const paddedCommand = ` ${command} `;
  const exactMatches = products
    .map(product => ({ product, name: normalizeVoiceText(product.name) }))
    .filter(candidate => candidate.name && paddedCommand.includes(` ${candidate.name} `))
    .sort((a, b) => b.name.length - a.name.length);

  if (exactMatches.length > 0) {
    const longestLength = exactMatches[0].name.length;
    const equallySpecific = exactMatches.filter(match => match.name.length === longestLength);
    if (equallySpecific.length > 1) {
      return { ambiguous: equallySpecific.slice(0, 3).map(match => match.product.name) };
    }
    return { product: exactMatches[0].product };
  }

  const commandTokens = command
    .split(' ')
    .filter(token => token && !COMMAND_WORDS.has(token) && !isNumberWord(token) && !/^\d+(?:\.\d+)?$/.test(token));

  const candidates = products.map(product => {
    const productTokens = normalizeVoiceText(product.name).split(' ').filter(Boolean);
    if (productTokens.length === 0) return { product, score: 0 };

    const totalSimilarity = productTokens.reduce((sum, productToken) => {
      const best = commandTokens.reduce(
        (max, commandToken) => Math.max(max, tokenSimilarity(productToken, commandToken)),
        0
      );
      return sum + best;
    }, 0);

    return { product, score: totalSimilarity / productTokens.length };
  }).sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.45) return {};

  const closeMatches = candidates.filter(candidate => candidate.score >= best.score - 0.08 && candidate.score >= 0.45);
  if (closeMatches.length > 1) {
    return { ambiguous: closeMatches.slice(0, 3).map(candidate => candidate.product.name) };
  }

  return { product: best.product };
};

const parseNumberAt = (tokens: string[], start: number): { value: number; length: number } | null => {
  const direct = Number(tokens[start]);
  if (Number.isFinite(direct)) return { value: direct, length: 1 };

  let current = 0;
  let total = 0;
  let consumed = 0;

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (BASIC_NUMBERS[token] !== undefined) {
      current += BASIC_NUMBERS[token];
      consumed += 1;
      continue;
    }

    if (token === 'hundred' || token === 'sau' || token === 'so') {
      current = (current || 1) * 100;
      consumed += 1;
      continue;
    }

    if (token === 'thousand' || token === 'hazar' || token === 'hazaar') {
      total += (current || 1) * 1000;
      current = 0;
      consumed += 1;
      continue;
    }

    if ((token === 'point' || token === 'decimal') && consumed > 0) {
      const decimalToken = tokens[index + 1];
      const decimal = BASIC_NUMBERS[decimalToken];
      if (decimal !== undefined && decimal >= 0 && decimal <= 9) {
        current += decimal / 10;
        consumed += 2;
      }
    }
    break;
  }

  if (consumed === 0) return null;
  return { value: total + current, length: consumed };
};

const extractNumber = (command: string, productName: string): number | null => {
  const normalizedProduct = normalizeVoiceText(productName);
  const withoutProduct = ` ${command} `.replace(` ${normalizedProduct} `, ' ').trim();
  const tokens = withoutProduct.split(' ').filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    const parsed = parseNumberAt(tokens, index);
    if (parsed && parsed.value > 0) return parsed.value;
  }

  return null;
};

export const parsePosVoiceCommand = <T extends PosVoiceProduct>(transcript: string, products: T[]): PosVoiceCommand => {
  const command = normalizeVoiceText(transcript);
  if (!command) return { type: 'error', message: 'Command dobara bolain.' };

  const savePatterns = ['save entry', 'entry save', 'save sale', 'sale save', 'save bill', 'bill save'];
  if (savePatterns.some(pattern => command.includes(pattern))) return { type: 'save' };

  const cancelPatterns = ['cancel command', 'command cancel', 'cancel karo', 'bas cancel'];
  if (cancelPatterns.some(pattern => command.includes(pattern))) return { type: 'cancel' };

  const productMatch = findProduct(command, products);
  if (productMatch.ambiguous?.length) {
    return {
      type: 'error',
      message: `Product clear nahi hai: ${productMatch.ambiguous.join(' ya ')} bolain.`
    };
  }
  if (!productMatch.product) {
    return { type: 'error', message: 'Product nahi mila. Product ka poora naam dobara bolain.' };
  }

  const value = extractNumber(command, productMatch.product.name);
  if (value === null || value <= 0) {
    return { type: 'error', message: `${productMatch.product.name} ke sath quantity ya rupees bolain.` };
  }

  const tokens = new Set(command.split(' '));
  const hasAmountWord = [...AMOUNT_WORDS].some(word => tokens.has(word));
  const hasQuantityWord = [...QUANTITY_WORDS].some(word => tokens.has(word));
  const mode: 'amount' | 'quantity' = hasAmountWord
    ? 'amount'
    : hasQuantityWord
      ? 'quantity'
      : productMatch.product.pos_primary_mode === 'amount'
        ? 'amount'
        : 'quantity';

  return {
    type: 'add',
    product: productMatch.product,
    mode,
    value
  };
};
