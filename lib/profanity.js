/* Shared name language filter — used on the server and in the plaza UI.
 * Names are public in the office, on badges, and in email, so keep them clean. */

export const NAME_BLOCKED_MESSAGE = 'That name is not allowed — keep it friendly for the office.';

/* Whole-token hits: split on spaces and punctuation. Short words only block
   when they are the whole token, not buried inside a longer name. */
const TOKEN_BLOCK = new Set([
  'ass', 'arse', 'balls', 'bastard', 'bitch', 'bloody', 'bollocks', 'boner',
  'boob', 'boobs', 'bullshit', 'clit', 'cock', 'coon', 'crap', 'cum', 'cunt',
  'damn', 'dick', 'dildo', 'douche', 'dyke', 'fag', 'faggot', 'fuck', 'fuk',
  'fucker', 'fucking', 'gook', 'hell', 'hitler', 'hoe', 'honkey', 'jap',
  'kike', 'kunt', 'milf', 'molester', 'motherfucker', 'nazi', 'negro', 'nigga',
  'nigger', 'pedo', 'pedophile', 'piss', 'prick', 'pussy', 'rape', 'rapist',
  'retard', 'retarded', 'schlong', 'shit', 'shite', 'slut', 'spic', 'tit',
  'tits', 'twat', 'wank', 'wanker', 'wetback', 'whore', 'wtf'
]);

/* Embedded hits: safe to scan inside a compacted name because they rarely
   appear inside innocent words (class, therapist, cockburn, etc.). */
const EMBED_BLOCK = [
  'asshole', 'asshat', 'bitch', 'bullshit', 'chink', 'cocksuck', 'cunt',
  'dickhead', 'dickwad', 'dipshit', 'faggot', 'fuck', 'fucker', 'fucking',
  'hitler', 'kike', 'motherfuck', 'nigga', 'nigger', 'pedoph', 'rapist',
  'retard', 'shit', 'shithead', 'spick', 'tranny', 'wetback', 'whore'
];

/* Names that would trip a short token but are ordinary given names. */
const ALLOW = new Set([
  'dick', 'gay', 'fanny', 'randy', 'will', 'bill', 'chuck', 'hank', 'hancock'
]);

const LEET = [
  [/@4/g, 'a'],
  [/3/g, 'e'],
  [/[$5]/g, 's'],
  [/7/g, 't'],
  [/0/g, 'o'],
  [/[1!|]/g, 'i']
];

export function normalizeName(raw) {
  let s = String(raw || '').toLowerCase().normalize('NFKD');
  s = s.replace(/\p{M}/gu, '');
  for (const [re, ch] of LEET) s = s.replace(re, ch);
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/(.)\1+/g, '$1');
  return s.trim();
}

export function compactName(raw) {
  return normalizeName(raw).replace(/\s+/g, '');
}

export function nameTokens(raw) {
  return normalizeName(raw).split(/\s+/).filter(Boolean);
}

export function isCleanName(raw) {
  return !nameLanguageError(raw);
}

export function nameLanguageError(raw) {
  const name = String(raw || '').trim();
  if (!name) return null;

  const compact = compactName(name);
  if (!compact) return null;
  if (ALLOW.has(compact)) return null;

  for (const tok of nameTokens(name)) {
    if (ALLOW.has(tok)) continue;
    if (TOKEN_BLOCK.has(tok)) return NAME_BLOCKED_MESSAGE;
  }

  for (const bad of EMBED_BLOCK) {
    if (compact.includes(bad)) return NAME_BLOCKED_MESSAGE;
  }

  return null;
}
