# Self-serve ordering data: which choices on each product page map to which saved Stripe price (SKU).
# Prices are NOT written here. The build reads each choice's price from seo_products.py (the same
# offer_rows the product pages and structured data use) and stops if the SKU's amount in
# functions/_lib/catalog.js does not match it, if an offer string is missing, or if a priced offer
# on a product page has no SKU. Output: assets/order/catalog.json, which the order panel (browser) and
# the order endpoint (server) both read. The server still prices every order from catalog.js alone.
import json, os, re
from seo_products import BY

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAX_QTY = 20
SIZES_BANNER = {'2x4': '2×4 ft', '3x6': '3×6 ft', '4x8': '4×8 ft', '3x10': '3×10 ft'}
OFFER_13OZ = {'2x4': '2×4 ft with grommets', '3x6': '3×6 ft', '4x8': '4×8 ft', '3x10': '3×10 ft'}


def _fail(msg):
    raise SystemExit('order catalog: ' + msg)


def _server_prices():
    text = open(os.path.join(ROOT, 'functions', '_lib', 'catalog.js'), encoding='utf-8').read()
    rows = re.findall(r'"([\w.\-]+)": \{ name: "([^"]+)", priceId: "(\w*)", amount: (\d+) \}', text)
    if not rows:
        _fail('could not read functions/_lib/catalog.js')
    return {sku: {'name': name, 'amount': int(amount)} for sku, name, _pid, amount in rows}


def _banner_rows():
    rows = []
    for size in SIZES_BANNER:
        rows.append(({'size': size, 'material': '13oz'}, OFFER_13OZ[size], f'banner-13oz-{size}'))
        rows.append(({'size': size, 'material': '18oz'}, f'18 oz heavy duty, {SIZES_BANNER[size]}', f'banner-18oz-{size}'))
        rows.append(({'size': size, 'material': 'mesh'}, f'Mesh wind-through, {SIZES_BANNER[size]}', f'banner-mesh-{size}'))
    return rows


def _throw_rows():
    rows = []
    for length in ('6', '8'):
        rows.append(({'length': length, 'style': '3'}, f'{length} ft, 3-sided', f'throw-{length}ft-3sided'))
        rows.append(({'length': length, 'style': '4'}, f'{length} ft, 4-sided', f'throw-{length}ft-4sided'))
        rows.append(({'length': length, 'style': 'fitted'}, f'{length} ft fitted, closed back', f'fitted-{length}ft'))
    return rows


# slug -> panel definition.
#   groups: one choice per group is selected. `rows` lists the priced combinations: (when, offer, sku).
#   addons: optional extras, each its own SKU with its own quantity.
#   options: wording choices that never change the price (finish, style, layout). They are added to the order
#            line as a note; hide = {choice id: {group id: [group values the choice is hidden for]}}.
#   designer: the designer product id when the online designer covers this page, and which designer option
#            group each panel group maps to.
#   upload_only: no online designer; the customer uploads artwork or asks us to design it.
ORDER = {
    'bulk-campaign-signs': dict(
        qtyLabel='packs', designer='yard', designerMap={'pack': 'pack', 'print': 'print'},
        groups=[
            dict(id='pack', label='Pack size', choices=[('5', '5 signs'), ('10', '10 signs'), ('25', '25 signs'), ('50', '50 signs'), ('100', '100 signs')]),
            dict(id='print', label='Printing', choices=[('1', 'One side'), ('2', 'Two sides')]),
        ],
        rows=[({'pack': n, 'print': p}, f'{n} signs, {"one side" if p == "1" else "two sides"}, 18×24, stakes included', f'yardsign-{n}-{p}s')
              for p in ('1', '2') for n in ('5', '10', '25', '50', '100')],
    ),
    'vinyl-banners': dict(
        qtyLabel='banners', designer='banner', designerMap={'size': 'size', 'material': 'material'},
        groups=[
            dict(id='size', label='Size', choices=list(SIZES_BANNER.items())),
            dict(id='material', label='Material', choices=[('13oz', '13 oz standard'), ('18oz', '18 oz heavy duty'), ('mesh', 'Mesh wind-through')]),
        ],
        rows=_banner_rows(),
        options=[dict(id='finish', label='Finish', choices=[('grommets', 'Grommets'), ('pockets', 'Pole pockets')], hide={'pockets': {'material': ['mesh']}},
                      note='Pole pockets are available on 13 oz and 18 oz banners at the same price. Mesh comes with grommets.')],
    ),
    'feather-flags': dict(
        qtyLabel='kits', designer='feather', designerMap={'height': 'height', 'base': 'base'},
        groups=[
            dict(id='height', label='Height', choices=[('10.5', '10.5 ft'), ('14', '14 ft'), ('18', '18 ft')]),
            dict(id='base', label='Base', choices=[('spike', 'Ground spike'), ('cross', 'Cross base and water bag')]),
        ],
        rows=[({'height': h, 'base': b}, f'{h} ft with {"ground spike" if b == "spike" else "cross base"}', f'flag-{h}-{b}') for h in ('10.5', '14', '18') for b in ('spike', 'cross')],
    ),
    'retractable-banners': dict(
        qtyLabel='stands', designer='retractable', designerMap={'size': 'size'},
        groups=[dict(id='size', label='Size', choices=[('33x81', '33×81 in'), ('47x81', '47×81 in')])],
        rows=[({'size': '33x81'}, '33×81 in stand', 'retractable-33x81'), ({'size': '47x81'}, '47×81 in stand', 'retractable-47x81')],
    ),
    'car-magnets': dict(
        qtyLabel='pairs', designer='magnet', designerMap={'size': 'size'},
        groups=[dict(id='size', label='Size (sold as a pair)', choices=[('12x18', '12×18 in'), ('18x24', '18×24 in')])],
        rows=[({'size': '12x18'}, '12×18 in pair', 'magnet-12x18'), ({'size': '18x24'}, '18×24 in pair', 'magnet-18x24')],
    ),
    'real-estate-signs': dict(
        qtyLabel='signs',
        groups=[dict(id='material', label='Sign', choices=[('coroplast', '18×24 coroplast, H-stake included'), ('aluminum', '18×24 aluminum')])],
        rows=[({'material': 'coroplast'}, '18×24 coroplast with H-stake', 're-coroplast'), ({'material': 'aluminum'}, '18×24 aluminum', 're-aluminum')],
        addons=[dict(id='rider', label='6×24 rider', offer='6×24 rider', sku='re-rider'), dict(id='post', label='Post frame', offer='post frame', sku='re-post')],
    ),
    'step-and-repeat-backdrops': dict(
        qtyLabel='backdrops', designer='backdrop', designerMap={'size': 'size'},
        groups=[dict(id='size', label='Size (width × height)', choices=[('8x8', '8×8 ft'), ('10x8', '10×8 ft')])],
        rows=[({'size': '8x8'}, '8×8 ft with stand and case', 'backdrop-8x8'), ({'size': '10x8'}, '10×8 ft with stand and case', 'backdrop-10x8')],
    ),
    'table-throws': dict(
        qtyLabel='covers', designer='throw', designerMap={'length': 'length', 'style': 'style'},
        groups=[
            dict(id='length', label='Table', choices=[('6', '6 ft'), ('8', '8 ft')]),
            dict(id='style', label='Style', choices=[('3', '3-sided throw (open back)'), ('4', '4-sided throw'), ('fitted', 'Fitted cover (closed back)')]),
        ],
        rows=_throw_rows(),
    ),
    'custom-canopy-tents': dict(
        qtyLabel='tents', designer='canopy', designerMap={'package': 'package'},
        groups=[dict(id='package', label='Package', choices=[('valance', 'Standard'), ('back', 'Top, valance and back wall'), ('kit', 'Full kit: walls, feather flag and table throw')])],
        rows=[({'package': 'valance'}, '10×10 Standard', 'tent-standard'),
              ({'package': 'back'}, '10×10 top, valance and back wall', 'tent-top-wall'),
              ({'package': 'kit'}, 'Full kit: walls, feather flag and table throw', 'tent-full-kit')],
    ),
    'trade-show-booth-kit': dict(qtyLabel='kits', upload_only=True, groups=[], rows=[({}, None, 'booth-kit')]),
    'hard-hat-decals': dict(
        qtyLabel='packs', designer='decal', designerMap={'pack': 'pack'},
        groups=[dict(id='pack', label='Size and quantity', choices=[('2in100', '2 in, 100 decals'), ('2in250', '2 in, 250 decals'), ('2in500', '2 in, 500 decals'), ('3in250', '3 in, 250 decals'), ('3in500', '3 in, 500 decals')])],
        rows=[({'pack': k}, off, sku) for k, off, sku in (
            ('2in100', '2 in, 100 decals', 'decal-2in-100'), ('2in250', '2 in, 250 decals', 'decal-2in-250'), ('2in500', '2 in, 500 decals', 'decal-2in-500'),
            ('3in250', '3 in, 250 decals', 'decal-3in-250'), ('3in500', '3 in, 500 decals', 'decal-3in-500'))],
    ),
    'aluminum-safety-signs': dict(
        qtyLabel='packs', designer='safety', designerMap={'pack': 'pack'},
        groups=[dict(id='pack', label='Size and pack', choices=[('12x18_5', '12×18 in, 5 signs'), ('12x18_10', '12×18 in, 10 signs'), ('18x24_5', '18×24 in, 5 signs'), ('12x18_5hd', '12×18 in, 5 heavy duty (.063)')])],
        rows=[({'pack': '12x18_5'}, '12×18 in, 5 signs', 'safety-12x18-5'), ({'pack': '12x18_10'}, '12×18 in, 10 signs', 'safety-12x18-10'),
              ({'pack': '18x24_5'}, '18×24 in, 5 signs', 'safety-18x24-5'), ({'pack': '12x18_5hd'}, '12×18 in, 5 heavy duty (.063)', 'safety-12x18-5-063')],
        options=[dict(id='orient', label='Sign layout', choices=[('landscape', 'Landscape'), ('portrait', 'Portrait')], hide={},
                      note='Every sign in a pack can say something different. Put the wording for each sign in the notes.')],
    ),
    'challenge-coins': dict(
        qtyLabel='orders', upload_only=True,
        groups=[dict(id='qty', label='Quantity', choices=[('50', '50 coins'), ('100', '100 coins')])],
        rows=[({'qty': '50'}, '50 coins', 'coins-50'), ({'qty': '100'}, '100 coins', 'coins-100')],
    ),
    'custom-patches': dict(
        qtyLabel='orders', upload_only=True,
        groups=[dict(id='pack', label='Patch type and quantity', choices=[('pvc50', '50 PVC patches, 3 in'), ('emb50', '50 embroidered patches'), ('emb100', '100 embroidered patches')])],
        rows=[({'pack': 'pvc50'}, '50 PVC patches, 3 in', 'patch-pvc-3in-50'), ({'pack': 'emb50'}, '50 embroidered patches', 'patch-emb-50'),
              ({'pack': 'emb100'}, '100 embroidered patches', 'patch-emb-100')],
    ),
    'metal-business-cards': dict(
        qtyLabel='orders', upload_only=True,
        groups=[dict(id='pack', label='Metal and quantity', choices=[('ss50', '50 stainless steel cards'), ('ss100', '100 stainless steel cards'), ('ss250', '250 stainless steel cards'), ('blk50', '50 black cards'), ('blk100', '100 black cards'), ('gold100', '100 gold cards'), ('rosegold100', '100 rose gold cards')])],
        rows=[({'pack': 'ss50'}, '50 stainless steel cards', 'card-ss-50'), ({'pack': 'ss100'}, '100 stainless steel cards', 'card-ss-100'), ({'pack': 'ss250'}, '250 stainless steel cards', 'card-ss-250'),
              ({'pack': 'blk50'}, '50 black cards', 'card-blk-50'), ({'pack': 'blk100'}, '100 black cards', 'card-blk-100'),
              ({'pack': 'gold100'}, '100 gold cards', 'card-gold-100'), ({'pack': 'rosegold100'}, '100 rose gold cards', 'card-rosegold-100')],
    ),
    'senior-night-banners': dict(
        qtyLabel='banners',
        groups=[dict(id='size', label='Size', choices=[('2x3', '2×3 ft'), ('3x5', '3×5 ft'), ('4x6', '4×6 ft')])],
        rows=[({'size': '2x3'}, '2×3 ft', 'senior-2x3'), ({'size': '3x5'}, '3×5 ft', 'senior-3x5'), ({'size': '4x6'}, '4×6 ft', 'senior-4x6')],
    ),
    'holiday-yard-signs': dict(
        qtyLabel='signs',
        groups=[dict(id='item', label='Item', choices=[('xmas24', 'Christmas family name banner, 2×4 ft'), ('xmas36', 'Christmas family name banner, 3×6 ft'), ('thanks', 'Thanksgiving family name yard sign, 18×24 in with stake')])],
        rows=[({'item': 'xmas24'}, '2×4 ft banner', 'xmas-2x4'), ({'item': 'xmas36'}, '3×6 ft banner', 'xmas-3x6'), ({'item': 'thanks'}, None, 'thanks-18x24')],
        options=[dict(id='style', label='Style', note='The family name and the way it should read go in the notes.',
                      choices=[('classic', 'Christmas: Classic Red'), ('evergreen', 'Christmas: Evergreen'), ('plaid', 'Christmas: Plaid'), ('harvest', 'Thanksgiving: Harvest'), ('rustic', 'Thanksgiving: Rustic')],
                      hide={'classic': {'item': ['thanks']}, 'evergreen': {'item': ['thanks']}, 'plaid': {'item': ['thanks']},
                            'harvest': {'item': ['xmas24', 'xmas36']}, 'rustic': {'item': ['xmas24', 'xmas36']}})],
    ),
}


def _designer_ok(d, designer):
    if not d.get('designer'):
        return {}
    dp = designer.get(d['designer'])
    if not dp:
        _fail('designer product ' + d['designer'] + ' is not in design_catalog.json')
    out = {}
    for panel_group, designer_group in d['designerMap'].items():
        dg = [g for g in dp['groups'] if g['id'] == designer_group]
        if not dg:
            _fail(f'designer {d["designer"]} has no group {designer_group}')
        have = {c['id'] for c in dg[0]['choices']}
        out[panel_group] = [cid for cid, _l in [c for g in d['groups'] if g['id'] == panel_group for c in g['choices']] if cid in have]
    return out


def _page_price(slug, offer):
    page = BY[slug]
    if slug == 'holiday-yard-signs':
        for x in page['extra']:
            for pr, text in x.get('offer_rows') or []:
                if text == offer:
                    return pr
        if offer is None:
            return [x['price'] for x in page['extra'] if x['key'] == '14-thanksgiving-yard-sign'][0]
        _fail(f'holiday price not found for {offer}')
    if slug == 'trade-show-booth-kit':
        return page['price']
    hit = [pr for pr, text in (page.get('offer_rows') or []) if text == offer]
    if len(hit) != 1:
        _fail(f'{slug}: offer {offer!r} is not exactly one row of seo_products offer_rows')
    return hit[0]


def build_order_catalog():
    server = _server_prices()
    designer = {p['id']: p for p in json.load(open(os.path.join(HERE, 'design_catalog.json'), encoding='utf-8'))['products']}
    products = {}
    offer_sku = {}
    used = set()
    for slug, d in ORDER.items():
        page = BY.get(slug)
        if not page:
            _fail('unknown product page ' + slug)
        group_ids = [g['id'] for g in d['groups']]
        rows = []
        for when, offer, sku in d['rows']:
            if sku not in server:
                _fail(f'{slug}: sku {sku} is not in functions/_lib/catalog.js')
            price = _page_price(slug, offer)
            if server[sku]['amount'] != price * 100:
                _fail(f'{slug}: site price ${price} differs from the saved Stripe price ${server[sku]["amount"] / 100} for {sku}')
            if sorted(when) != sorted(group_ids):
                _fail(f'{slug}: row {when} must name groups {group_ids}')
            if sku in used:
                _fail(f'{slug}: sku {sku} is used twice')
            used.add(sku)
            rows.append(dict(when=when, sku=sku, price=price))
            if offer:
                offer_sku[f'{slug}|{offer}'] = sku
        for g in d['groups']:
            for cid, _label in g['choices']:
                if not any(r['when'].get(g['id']) == cid for r in rows):
                    _fail(f'{slug}: choice {g["id"]}={cid} has no priced row')
        addons = []
        for a in d.get('addons', []):
            price = _page_price(slug, a['offer'])
            if server[a['sku']]['amount'] != price * 100:
                _fail(f'{slug}: add-on {a["sku"]} price mismatch')
            if a['sku'] in used:
                _fail(f'{slug}: sku {a["sku"]} is used twice')
            used.add(a['sku'])
            addons.append(dict(id=a['id'], label=a['label'], sku=a['sku'], price=price))
            offer_sku[f'{slug}|{a["offer"]}'] = a['sku']
        if slug not in ('holiday-yard-signs', 'trade-show-booth-kit'):
            for _pr, text in page.get('offer_rows') or []:
                if f'{slug}|{text}' not in offer_sku:
                    _fail(f'{slug}: priced offer {text!r} has no SKU in order_catalog.py')
        products[slug] = dict(
            slug=slug, name=page['name'], short=page['short'], qtyLabel=d['qtyLabel'], maxQty=MAX_QTY,
            **({'etsy': str(page['etsy'])} if page.get('etsy') else {}),
            uploadOnly=bool(d.get('upload_only')), designer=d.get('designer'), designerMap=d.get('designerMap') or {},
            # panel choices the online designer also has; a choice outside this list has no designer path
            designerOk=_designer_ok(d, designer),
            groups=[dict(id=g['id'], label=g['label'], choices=[dict(id=i, label=l) for i, l in g['choices']]) for g in d['groups']],
            rows=rows, addons=addons,
            options=[dict(id=o['id'], label=o['label'], note=o.get('note', ''), hide=o.get('hide', {}), choices=[dict(id=i, label=l) for i, l in o['choices']]) for o in d.get('options', [])],
        )
    for p in BY.values():
        if p['slug'] not in products and (p.get('offer_rows') or p.get('price')):
            _fail(f'product page {p["slug"]} has prices but no order panel definition')
    return dict(
        schema=1,
        about='Generated by src/order_catalog.py from the prices in seo_products.py. Do not edit by hand.',
        maxQty=MAX_QTY,
        products=products,
        offers=offer_sku,
        skus={sku: dict(name=server[sku]['name']) for sku in sorted(used)},
    )
