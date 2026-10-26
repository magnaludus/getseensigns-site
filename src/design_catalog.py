# Design-preview catalog. Products, templates and options live in design_catalog.json.
# Prices are NOT stored here. build_catalog() copies them from seo_products.py offer_rows
# (the same list the product pages and structured data use). The build fails if an
# offer string does not match exactly, so a price cannot drift or be invented.
import itertools, json, os
from seo_products import BY

def build_catalog():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'design_catalog.json')
    raw = json.load(open(path, encoding='utf-8'))
    if not raw.get('products') or not raw.get('fonts'):
        raise SystemExit('design catalog is missing products or fonts')
    seen_ids = set()
    for product in raw['products']:
        pid = product['id']
        if pid in seen_ids:
            raise SystemExit('duplicate design product id: ' + pid)
        seen_ids.add(pid)
        groups = product['groups']
        ids = [g['id'] for g in groups]
        choice_lists = []
        for g in groups:
            cids = [c['id'] for c in g['choices']]
            if len(cids) != len(set(cids)):
                raise SystemExit(f'duplicate choice in {pid} / {g["id"]}')
            choice_lists.append(cids)
        expected = [dict(zip(ids, combo)) for combo in itertools.product(*choice_lists)]
        rows = product['prices']
        seen = set()
        for row in rows:
            when = row.get('when') or {}
            if list(when.keys()) != ids:
                raise SystemExit(f'{pid} price when-keys must be {ids}, got {list(when.keys())}')
            key = tuple(when[i] for i in ids)
            if key in seen:
                raise SystemExit(f'duplicate price row {pid} {when}')
            seen.add(key)
            src = BY.get(row['source'])
            if not src:
                raise SystemExit(f'{pid} source slug not in seo_products: {row["source"]}')
            hit = [pair for pair in (src.get('offer_rows') or []) if pair[1] == row['offer']]
            if len(hit) != 1:
                have = [pair[1] for pair in (src.get('offer_rows') or [])]
                raise SystemExit(f'No exact price match for {pid}: {row["source"]} / {row["offer"]!r}. Have: {have}')
            row['price'] = hit[0][0]
            row['label'] = hit[0][1]
            if not isinstance(row['price'], int):
                raise SystemExit(f'price for {pid} {row["offer"]!r} is not an integer')
        if len(seen) != len(expected):
            missing = [exp for exp in expected if tuple(exp[i] for i in ids) not in seen]
            raise SystemExit(f'{pid} is missing a price for {missing}')
        layouts = {t.get('layout') for t in product['templates']}
        unknown = layouts - {'center', 'split', 'band', 'badge'}
        if unknown:
            raise SystemExit(f'{pid} has unknown layouts {unknown}')
        if not (3 <= len(product['templates']) <= 4):
            raise SystemExit(f'{pid} needs 3 or 4 templates')
        for t in product['templates']:
            cols = t.get('colors') or []
            if len(cols) != 3 or not all(isinstance(c, str) and len(c) == 7 and c.startswith('#') for c in cols):
                raise SystemExit(f'{pid} template {t.get("id")} needs 3 hex colors')
    return raw
