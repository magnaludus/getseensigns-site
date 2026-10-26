# Online designer data. Everything the page needs is built here from files in src/:
#   design_catalog.json      products, options, fonts, scenes, palettes (NO prices)
#   design_print_specs.json  true artwork sizes with a source or a status on every row
#   design_templates/*.json  one starting layout per product and template id
#   design_blocklist.txt     names that must never appear in a template
# Prices are NOT stored in those files. build_catalog() copies them from seo_products.py offer_rows
# (the same list the product pages and structured data use). The build fails if an offer string does
# not match exactly, a combination has no price, or any file below is malformed, so a price or a
# real-world name cannot slip in.
import glob, itertools, json, os, re
from seo_products import BY

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SPEC_STATUSES = {'TODO_SPEC', 'UX_DEFAULT'}
SLOTS = {'@primary', '@accent', '@ink'}
FIELDS = {'name', 'line2', 'phone', 'web'}
SHAPE_KINDS = {'rect', 'ellipse', 'triangle', 'star', 'chevron', 'badge'}
BASE_REGIONS = {'art', 'trim', 'safe'}
EXTRA_REGIONS = {'canopy': {'peak', 'valance', 'valancebar', 'roofarea'}, 'feather': {'head', 'body', 'foot'}}
CATEGORIES = {'business', 'campaign', 'team', 'events', 'holiday'}
# overlay name -> the variant key that carries its data (None = derived from the artboard)
OVERLAYS = {'trim': None, 'bleed': None, 'safe': None, 'valance_line': 'valance_line', 'roof': 'roof',
            'outline': 'outline', 'sleeve': 'pole_sleeve', 'grass_line': 'grass_line', 'grommets': 'grommets'}
HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')


def _fail(msg):
    raise SystemExit('design data: ' + msg)


def _load_json(name, folder=HERE):
    path = os.path.join(folder, name)
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError) as err:
        _fail(f'cannot read {name}: {err}')


def _color_ok(value):
    return isinstance(value, str) and (value in SLOTS or bool(HEX.match(value)))


def _check_money(text, label):
    # Specs and templates describe geometry and wording. Money figures live in seo_products.py only.
    hit = re.search(r'\$\s?\d|\b(cost|margin|profit|price|discount)\b', text, flags=re.I)
    if hit:
        _fail(f'{label} mentions money ({hit.group(0)!r}). Prices come from seo_products.py only.')


def build_catalog():
    raw = _load_json('design_catalog.json')
    if not raw.get('products') or not raw.get('fonts'):
        _fail('design_catalog.json is missing products or fonts')
    font_ids = set()
    for font in raw['fonts']:
        if font['id'] in font_ids:
            _fail('duplicate font id ' + font['id'])
        font_ids.add(font['id'])
        if not os.path.exists(ROOT + font['file']):
            _fail('font file missing: ' + font['file'])
        if not (0.4 < font['cap'] < 1.0):
            _fail(f'font {font["id"]} has an odd cap-height ratio {font["cap"]}')
        if font.get('license') not in ('OFL-1.1',):
            _fail(f'font {font["id"]} needs an open license (OFL-1.1)')
    scene_ids = {s['id'] for s in raw.get('scenes', [])}
    for scene in raw.get('scenes', []):
        # plate = base name of assets/design/scenes/<plate>-{1024,2048}.webp. Leave null until the images exist.
        plate = scene.get('plate')
        if plate:
            for size in (1024, 2048):
                if not os.path.exists(f'{ROOT}/assets/design/scenes/{plate}-{size}.webp'):
                    _fail(f'scene {scene["id"]} names plate {plate} but scenes/{plate}-{size}.webp is missing')
    if raw.get('sceneDefault') not in scene_ids:
        _fail('sceneDefault must be one of the scenes')
    if raw.get('rush', {}).get('enabled') is not False:
        _fail('rush must stay disabled until Scott sets rush prices')
    bundles = raw.get('bundles', {})
    if bundles.get('enabled') is not False or bundles.get('discount') is not None:
        _fail('bundles are Phase 2: keep bundles.enabled false and discount null until Scott sets them')
    for pal in raw.get('palettes', []):
        if not all(HEX.match(pal.get(k, '')) for k in ('primary', 'accent', 'ink')):
            _fail(f'palette {pal.get("id")} needs three hex colors')

    seen_ids = set()
    for product in raw['products']:
        pid = product['id']
        if pid in seen_ids:
            _fail('duplicate design product id: ' + pid)
        seen_ids.add(pid)
        groups = product['groups']
        ids = [g['id'] for g in groups]
        choice_lists = []
        for g in groups:
            cids = [c['id'] for c in g['choices']]
            if len(cids) != len(set(cids)):
                _fail(f'duplicate choice in {pid} / {g["id"]}')
            choice_lists.append(cids)
        expected = [dict(zip(ids, combo)) for combo in itertools.product(*choice_lists)]
        rows = product['prices']
        seen = set()
        for row in rows:
            when = row.get('when') or {}
            if list(when.keys()) != ids:
                _fail(f'{pid} price when-keys must be {ids}, got {list(when.keys())}')
            key = tuple(when[i] for i in ids)
            if key in seen:
                _fail(f'duplicate price row {pid} {when}')
            seen.add(key)
            src = BY.get(row['source'])
            if not src:
                _fail(f'{pid} source slug not in seo_products: {row["source"]}')
            hit = [pair for pair in (src.get('offer_rows') or []) if pair[1] == row['offer']]
            if len(hit) != 1:
                have = [pair[1] for pair in (src.get('offer_rows') or [])]
                _fail(f'No exact price match for {pid}: {row["source"]} / {row["offer"]!r}. Have: {have}')
            row['price'] = hit[0][0]
            row['label'] = hit[0][1]
            if not isinstance(row['price'], int):
                _fail(f'price for {pid} {row["offer"]!r} is not an integer')
        if len(seen) != len(expected):
            missing = [exp for exp in expected if tuple(exp[i] for i in ids) not in seen]
            _fail(f'{pid} is missing a price for {missing}')
        page_src = BY.get(rows[0]['source'])
        product['etsyId'] = str(page_src['etsy'])
        product['days'] = str(page_src['days'])
        qty = product.get('qty')
        if qty is not None and not (1 <= qty['min'] <= qty['max'] <= 20):
            _fail(f'{pid} qty must stay within 1 to 20')
        sides = product['sides']
        if sides['mode'] == 'by_choice':
            if sides['group'] not in ids:
                _fail(f'{pid} sides.group must be an option group')
            for g in groups:
                if g['id'] == sides['group']:
                    if set(sides['names']) != {c['id'] for c in g['choices']}:
                        _fail(f'{pid} sides.names must cover every {sides["group"]} choice')
        elif not sides.get('names'):
            _fail(f'{pid} sides.names is empty')
        if len(product['templates']) != len(set(product['templates'])) or len(product['templates']) < 4:
            _fail(f'{pid} needs at least 4 distinct template ids')
    return raw


def _walk_rows(node, inherited, path, problems):
    # A "row" is a dict that holds data (a number or a list of numbers). Every row needs a source URL
    # or one of the allowed statuses, either on itself or on an ancestor.
    if isinstance(node, dict):
        has_mark = bool(node.get('source')) or node.get('status') in SPEC_STATUSES
        ok = inherited or has_mark
        data = any(isinstance(v, (int, float)) and not isinstance(v, bool) or
                   (isinstance(v, list) and v and all(isinstance(x, (int, float, list)) for x in v))
                   for k, v in node.items() if k not in ('source', 'status'))
        if data and not ok:
            problems.append(path)
        if 'status' in node and node['status'] not in SPEC_STATUSES:
            problems.append(path + '.status=' + str(node['status']))
        for key, value in node.items():
            _walk_rows(value, ok, path + '.' + key, problems)


def _check_points(points, art, label):
    ok = isinstance(points, list) and len(points) >= 3 and all(
        isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p) for p in points)
    if not ok:
        _fail(f'{label} needs at least 3 [x, y] points in inches')
    tol = 0.01
    if not all(-tol <= x <= art['w'] + tol and -tol <= y <= art['h'] + tol for x, y in points):
        _fail(f'{label} points must sit inside the {art["w"]} x {art["h"]} in artboard')


def build_print_specs(catalog):
    text = open(os.path.join(HERE, 'design_print_specs.json'), encoding='utf-8').read()
    _check_money(text, 'design_print_specs.json')
    if re.search(r'https?://|www\.', text, re.I):
        _fail('design_print_specs.json has a link. The repo must not name printers or link to their pages; use "printer template" as the source')
    specs = json.loads(text)
    dpi = specs['dpi']
    if not (dpi['green_min'] > dpi['amber_min'] > 0):
        _fail('dpi thresholds must satisfy green_min > amber_min > 0')
    problems = []
    for key in ('dpi', 'read_rule'):
        _walk_rows(specs[key], False, key, problems)
    for product in catalog['products']:
        pid = product['id']
        spec = specs['products'].get(pid)
        if not spec:
            _fail(f'design_print_specs.json has no entry for {pid}')
        groups = {g['id']: [c['id'] for c in g['choices']] for g in product['groups']}
        by = spec['variant_by']
        for g in by:
            if g not in groups:
                _fail(f'{pid} variant_by group {g} is not an option group')
        keys = ['-'.join(c) for c in itertools.product(*[groups[g] for g in by])] if by else ['*']
        if set(spec['variants']) != set(keys):
            _fail(f'{pid} print-spec variants must be exactly {keys}, got {sorted(spec["variants"])}')
        for key, var in spec['variants'].items():
            where = f'{pid}/{key}'
            art = var['artboard']
            if not (art['w'] > 0 and art['h'] > 0):
                _fail(f'{where} artboard needs a positive size')
            if var['bleed']['in'] < 0:
                _fail(f'{where} bleed cannot be negative')
            for need in ('artboard', 'bleed', 'safe', 'dpi', 'min_cap_in'):
                if need not in var:
                    _fail(f'{where} is missing {need}')
            safe = var['safe']
            if not (all(k in safe for k in ('x', 'y', 'w', 'h')) or 'inset' in safe):
                _fail(f'{where} safe needs x/y/w/h or an inset')
            if safe.get('inset') is not None and not safe.get('status') and not safe.get('source'):
                _fail(f'{where} safe inset needs a source or status')
            if var['min_cap_in']['value'] <= 0:
                _fail(f'{where} min_cap_in must be positive')
            for ov in spec.get('overlays', []):
                if ov not in OVERLAYS:
                    _fail(f'{pid} lists an unknown overlay {ov}')
                need = OVERLAYS[ov]
                if need and need not in var:
                    _fail(f'{where} lists overlay {ov} but has no {need} data')
        _walk_rows(spec['variants'], False, pid + '.variants', problems)
        for extra in ('other_pieces', 'outline_shapes', 'template_sizes', 'profiles', 'table'):
            if extra in spec:
                _walk_rows(spec[extra], False, pid + '.' + extra, problems)
        for key, var in spec['variants'].items():
            where = f'{pid}/{key}'
            art = var['artboard']
            # An outline is either a named unit-square shape or the printer's points in inches.
            outline = var.get('outline') or {}
            shape = outline.get('shape')
            if shape:
                shapes = spec.get('outline_shapes', {})
                if shape not in shapes:
                    _fail(f'{where} outline shape {shape} is not defined')
                pts = shapes[shape]['points']
                if len(pts) < 3 or not all(0 <= x <= 1 and 0 <= y <= 1 for x, y in pts):
                    _fail(f'{where} outline {shape} points must be in the unit square')
            if outline.get('points') is not None:
                _check_points(outline['points'], art, f'{where} outline')
            roof = var.get('roof') or {}
            if roof.get('points') is not None:
                _check_points(roof['points'], art, f'{where} roof')
                if 'valance_line' not in var:
                    _fail(f'{where} has a roof outline but no valance_line')
                vy = var['valance_line']['y']
                if abs(roof['points'][0][1] - vy) > 0.05 or abs(roof['points'][-1][1] - vy) > 0.05:
                    _fail(f'{where} roof outline must start and end on the valance line (y {vy})')
            flutes = (var.get('flutes') or {}).get('direction')
            if flutes is not None and flutes != 'vertical':
                _fail(f'{where} flutes: only vertical is drawn in 3D (the cut top and bottom edges show the cross section)')
            safe = var['safe']
            if 'x' in safe and not (safe['x'] >= 0 and safe['y'] >= 0 and safe['x'] + safe['w'] <= art['w'] + 0.01 and safe['y'] + safe['h'] <= art['h'] + 0.01):
                _fail(f'{where} safe box must sit inside the artboard')
    if problems:
        _fail('print spec rows need a source or a status (TODO_SPEC, UX_DEFAULT): ' + ', '.join(problems[:12]))
    return specs


def _load_blocklist():
    terms = []
    for line in open(os.path.join(HERE, 'design_blocklist.txt'), encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#'):
            terms.append(line)
    if not terms:
        _fail('design_blocklist.txt is empty')
    return [re.compile(r'(?<![A-Za-z0-9])' + re.escape(t) + r'(?![A-Za-z0-9])', re.I) for t in terms], terms


PHONE = re.compile(r'(?<!\d)(?:\(?\d{3}\)?[-. ]?)?\d{3}[-. ]?\d{4}(?!\d)')


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def _check_wording(text, label, patterns, terms):
    for pat, term in zip(patterns, terms):
        if pat.search(text):
            _fail(f'{label} contains the blocklisted name {term!r}')
    for m in PHONE.finditer(text):
        digits = re.sub(r'\D', '', m.group(0))
        if len(digits) == 7:
            exch, line = digits[:3], digits[3:]
        else:
            exch, line = digits[3:6], digits[6:]
        if exch != '555' or not line.startswith('01'):
            _fail(f'{label} has a phone number that is not a 555-01xx sample: {m.group(0)!r}')
    if re.search(r'https?://|www\.', text, re.I):
        _fail(f'{label} has a real-looking web address. Use name.example')
    if re.search(r'[\w.+-]+@(?!example\.)[\w-]+\.[a-z]{2,}', text, re.I):
        _fail(f'{label} has an email address. Samples use only .example addresses')
    for m in re.finditer(r'\b[\w-]+\.(com|net|org|us|biz|info|co|io)\b', text, re.I):
        _fail(f'{label} has a real-looking domain {m.group(0)!r}. Use name.example')


def _check_box(box, label):
    if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box)):
        _fail(f'{label} box must be [x, y, w, h]')
    x, y, w, h = box
    if not (-0.2 <= x <= 1.2 and -0.2 <= y <= 1.2 and 0 < w <= 1.5 and 0 < h <= 1.5):
        _fail(f'{label} box {box} is out of range')


def build_templates(catalog):
    patterns, terms = _load_blocklist()
    fonts = {f['id'] for f in catalog['fonts']}
    files = sorted(glob.glob(os.path.join(HERE, 'design_templates', '*.json')))
    by_product = {p['id']: {} for p in catalog['products']}
    for path in files:
        base = os.path.basename(path)
        text = open(path, encoding='utf-8').read()
        _check_money(text, base)
        try:
            tpl = json.loads(text)
        except ValueError as err:
            _fail(f'{base} is not valid JSON: {err}')
        pid, tid = tpl.get('product'), tpl.get('id')
        if base != f'{pid}-{tid}.json':
            _fail(f'{base} must be named {pid}-{tid}.json')
        if pid not in by_product:
            _fail(f'{base} names an unknown product {pid}')
        listed = next(p for p in catalog['products'] if p['id'] == pid)['templates']
        if tid not in listed:
            _fail(f'{base}: {tid} is not in the {pid} template list in design_catalog.json')
        if tpl.get('category') not in CATEGORIES:
            _fail(f'{base}: category must be one of {sorted(CATEGORIES)}')
        pal = tpl.get('palette') or {}
        if not all(HEX.match(pal.get(k, '')) for k in ('primary', 'accent', 'ink')):
            _fail(f'{base}: palette needs primary, accent and ink as hex colors')
        sample = tpl.get('sample') or {}
        if set(sample) != FIELDS or not sample['name']:
            _fail(f'{base}: sample must have exactly {sorted(FIELDS)}')
        if tpl.get('font') not in fonts:
            _fail(f'{base}: unknown font {tpl.get("font")}')
        bg = tpl.get('bg') or {}
        if bg.get('type') == 'solid':
            if not _color_ok(bg.get('color')):
                _fail(f'{base}: bg color must be a hex or a palette slot')
        elif bg.get('type') == 'gradient':
            if not (_color_ok(bg.get('from')) and _color_ok(bg.get('to'))):
                _fail(f'{base}: gradient needs from and to colors')
        else:
            _fail(f'{base}: bg.type must be solid or gradient')
        regions = BASE_REGIONS | EXTRA_REGIONS.get(pid, set())
        elements = tpl.get('elements') or []
        if len(elements) < 3:
            _fail(f'{base}: needs at least 3 elements')
        for i, el in enumerate(elements):
            label = f'{base} element {i + 1}'
            kind = el.get('type')
            if kind not in ('text', 'shape', 'image'):
                _fail(f'{label}: type must be text, shape or image')
            if el.get('region') not in regions:
                _fail(f'{label}: region {el.get("region")!r} is not one of {sorted(regions)}')
            _check_box(el.get('box'), label)
            if el.get('square') is not None and el['square'] is not True:
                _fail(f'{label}: square must be true when present')
            if kind == 'shape':
                if el.get('kind') not in SHAPE_KINDS:
                    _fail(f'{label}: shape kind must be one of {sorted(SHAPE_KINDS)}')
                if not _color_ok(el.get('fill')):
                    _fail(f'{label}: fill must be a hex or a palette slot')
            elif kind == 'text':
                if not _color_ok(el.get('fill')):
                    _fail(f'{label}: fill must be a hex or a palette slot')
                if el.get('bind') is not None and el['bind'] not in FIELDS:
                    _fail(f'{label}: bind must be one of {sorted(FIELDS)}')
                if el.get('bind') is None and not el.get('text'):
                    _fail(f'{label}: static text needs text')
                if el.get('font') is not None and el['font'] not in fonts:
                    _fail(f'{label}: unknown font {el["font"]}')
                if el.get('align', 'center') not in ('left', 'center', 'right'):
                    _fail(f'{label}: align must be left, center or right')
                if el.get('valign', 'middle') not in ('top', 'middle', 'bottom'):
                    _fail(f'{label}: valign must be top, middle or bottom')
                if el.get('rot', 0) not in (0, 90, -90, 180):
                    _fail(f'{label}: text rotation must be 0, 90, -90 or 180')
            elif kind == 'image':
                if el.get('frame') != 'logo':
                    _fail(f'{label}: image elements are logo frames (frame: "logo")')
            if isinstance(el.get('stroke'), dict) and not _color_ok(el['stroke'].get('color')):
                _fail(f'{label}: stroke color must be a hex or a palette slot')
        for s in _strings(tpl):
            _check_wording(s, base, patterns, terms)
        if tid in by_product[pid]:
            _fail(f'duplicate template {pid}/{tid}')
        by_product[pid][tid] = tpl
    out = {}
    for product in catalog['products']:
        pid = product['id']
        missing = [t for t in product['templates'] if t not in by_product[pid]]
        if missing:
            _fail(f'{pid} is missing template files for {missing}')
        out[pid] = [by_product[pid][t] for t in product['templates']]
    return out


def build_design_assets():
    catalog = build_catalog()
    specs = build_print_specs(catalog)
    templates = build_templates(catalog)
    # The catalog's own wording (names, labels, notes) follows the same sample rules.
    patterns, terms = _load_blocklist()
    for s in _strings([catalog['products'], catalog['palettes']]):
        for pat, term in zip(patterns, terms):
            if pat.search(s):
                _fail(f'design_catalog.json contains the blocklisted name {term!r}')
    return catalog, specs, templates
