// Short ids for elements, sides, pieces and logos. Seedable so tests are repeatable.
let counter = 0;
let seeded = false;

export function setIdSeed(n) {
  counter = n;
  seeded = true;
}

export function uid(prefix) {
  counter += 1;
  if (seeded) return prefix + counter;
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return prefix + counter.toString(36) + rand;
}
