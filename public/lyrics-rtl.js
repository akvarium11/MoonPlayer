const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LETTER_RE = /\p{L}/u;

function isRtlText(text) {
  const clean = String(text || '').replace(/<[^>]*>/g, '');
  for (const ch of clean) {
    if (!LETTER_RE.test(ch)) continue;
    return RTL_RE.test(ch);
  }
  return false;
}

if (typeof module !== 'undefined') module.exports = { isRtlText };
