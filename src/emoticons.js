// Pure text→emoji emoticon transform for chat messages (Yahoo Messenger style).
//
// IMPORTANT: run this on RAW message text, BEFORE HTML-escaping, then escape the
// result — that way `<3` is turned into ❤️ before `<` would be escaped to `&lt;`,
// and the substituted emoji survive escaping untouched. See renderMsgText().
//
// The set is deliberately conservative (only well-known tokens at word
// boundaries) to avoid mangling ordinary text like "option B) do this".

export const EMOTICONS = [
  [":')", '🥲'],
  [":'(", '😢'],
  [':-)', '🙂'], [':)', '🙂'],
  [':-D', '😄'], [':D', '😄'],
  [';-)', '😉'], [';)', '😉'],
  [':-(', '🙁'], [':(', '🙁'],
  [':-P', '😛'], [':P', '😛'], [':-p', '😛'], [':p', '😛'],
  [':-O', '😮'], [':O', '😮'], [':-o', '😮'], [':o', '😮'],
  [':|', '😐'],
  ['<3', '❤️'],
];

// Replace emoticon tokens that sit at a boundary (start/space before; space, end
// or sentence punctuation after). Longer tokens are tried first so ":-)" wins
// over ":)". Returns the transformed string.
export function applyEmoticons(text) {
  if (!text) return text || '';
  let out = String(text);
  for (const [token, emoji] of EMOTICONS) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\s)${esc}(?=\\s|$|[.,!?])`, 'g');
    out = out.replace(re, `$1${emoji}`);
  }
  return out;
}
