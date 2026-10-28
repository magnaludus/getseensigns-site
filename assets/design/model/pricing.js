// Live price from catalog.json only. catalog.json is built from seo_products.py offer_rows by
// src/design_catalog.py, and the build fails if a price drifts, so nothing here invents a number.
// The server uses this same file to recompute the total for a proof request.

export function productById(catalog, productId) {
  return catalog.products.find((p) => p.id === productId) || null;
}

export function priceRow(catalog, productId, choices) {
  const product = productById(catalog, productId);
  if (!product) return null;
  return (
    product.prices.find((row) => Object.keys(row.when).every((k) => String(row.when[k]) === String((choices || {})[k]))) || null
  );
}

export function piecePrice(catalog, piece) {
  const row = priceRow(catalog, piece.productId, piece.choices);
  if (!row) return null;
  const product = productById(catalog, piece.productId);
  const qty = product.qty ? Math.max(1, Math.min(product.qty.max, piece.qty || 1)) : 1;
  return { each: row.price, qty, total: row.price * qty, label: row.label, note: row.note || '', offer: row.offer };
}

export function projectTotal(catalog, doc) {
  const lines = [];
  let total = 0;
  for (const piece of doc.project.pieces) {
    const p = piecePrice(catalog, piece);
    if (!p) return { ok: false, total: 0, lines: [] };
    const product = productById(catalog, piece.productId);
    lines.push({ productId: piece.productId, name: product.name, short: product.short, ...p });
    total += p.total;
  }
  return { ok: true, total, lines, shipping: 'free' };
}

export function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Etsy's wording: arrives 3-8 business days after proof approval, tents and backdrops 5-10. A product can have its own
// range (`arrives`, set from seo_products.py).
export function productionText(product) {
  const days = String(product.arrives || '3-8').replace('-', ' to ');
  return days + ' business days after you approve the proof';
}
