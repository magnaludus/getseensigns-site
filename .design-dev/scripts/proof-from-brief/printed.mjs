// Is a customer's field printed on the proof sheet? Pure, no imports: the browser (in-page.mjs) and the unit tests use it.
// `lines` is every printed line of the design, in print order (one entry per text line). A field counts as printed when
// its words are one line, or several consecutive lines, so a name set on two lines is not reported as missing.

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export function fieldIsPrinted(value, lines) {
  const want = norm(value);
  if (!want) return true;
  const ls = lines.map(norm).filter(Boolean);
  for (let i = 0; i < ls.length; i++) {
    let joined = '';
    for (let j = i; j < ls.length; j++) {
      joined = j === i ? ls[j] : `${joined} ${ls[j]}`;
      if (joined === want) return true;
      if (joined.length >= want.length) break;
    }
  }
  return false;
}
