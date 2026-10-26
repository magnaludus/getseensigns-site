"""Dev only. Writes tests/unit/fixtures/font-advances.json: per-character advance widths (in em) of the
designer fonts, so node tests can measure text without a browser. Needs: pip install fonttools brotli."""
import json, os, sys
from fontTools.ttLib import TTFont

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
catalog = json.load(open(os.path.join(root, 'src', 'design_catalog.json'), encoding='utf-8'))
out = {}
for font in catalog['fonts']:
    tt = TTFont(os.path.join(root, font['file'].lstrip('/')))
    upm = tt['head'].unitsPerEm
    cmap = tt.getBestCmap()
    hmtx = tt['hmtx']
    adv = {}
    for code in range(32, 127):
        name = cmap.get(code)
        if name:
            adv[chr(code)] = round(hmtx[name][0] / upm, 4)
    out[font['id']] = {'adv': adv, 'fallback': round(sum(adv.values()) / len(adv), 4)}
dest = os.path.join(root, '.design-dev', 'tests', 'unit', 'fixtures', 'font-advances.json')
json.dump(out, open(dest, 'w'), separators=(',', ':'))
print('wrote', dest, os.path.getsize(dest), 'bytes')
