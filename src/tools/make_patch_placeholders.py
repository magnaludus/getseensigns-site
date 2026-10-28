# Draws the Custom Patches stand-in images (no photo exists yet). Plain brand graphics: black #14161A and yellow #FFD100.
# Replace these files with real product photos when Scott has them, keeping the same names:
#   assets/img/p-19-custom-patches.jpg / .webp / -sm.webp   (1024 px and 400 px)
#   assets/img/g-19-custom-patches-2.jpg / .webp / -sm.webp (900 px and 480 px)
# Run: python3 src/tools/make_patch_placeholders.py   (needs pillow)
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'img')
INK = (20, 22, 26)
YEL = (255, 209, 0)
WHITE = (255, 255, 255)
FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
SS = 2


def dashed_round_rect(d, box, radius, dash, gap, width, fill):
    x0, y0, x1, y1 = [v * SS for v in box]
    r = radius * SS
    # straight edges as dashes, corners as short arcs
    def hline(y, xa, xb):
        x = xa
        while x < xb:
            d.line([(x, y), (min(x + dash * SS, xb), y)], fill=fill, width=width * SS)
            x += (dash + gap) * SS
    def vline(x, ya, yb):
        y = ya
        while y < yb:
            d.line([(x, y), (x, min(y + dash * SS, yb))], fill=fill, width=width * SS)
            y += (dash + gap) * SS
    hline(y0, x0 + r, x1 - r)
    hline(y1, x0 + r, x1 - r)
    vline(x0, y0 + r, y1 - r)
    vline(x1, y0 + r, y1 - r)
    for (ax, ay, start) in ((x0, y0, 180), (x1 - 2 * r, y0, 270), (x1 - 2 * r, y1 - 2 * r, 0), (x0, y1 - 2 * r, 90)):
        d.arc([ax, ay, ax + 2 * r, ay + 2 * r], start, start + 90, fill=fill, width=width * SS)


def hero(size=1024):
    im = Image.new('RGB', (size * SS, size * SS), INK)
    d = ImageDraw.Draw(im)
    s = size / 1024
    cx = size / 2
    pw, ph = 720 * s, 480 * s
    box = (cx - pw / 2, 250 * s, cx + pw / 2, 250 * s + ph)
    d.rounded_rectangle([v * SS for v in box], radius=90 * s * SS, fill=YEL)
    inset = 30 * s
    dashed_round_rect(d, (box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset), 62 * s, 22 * s, 14 * s, max(1, round(7 * s)), INK)
    d2 = ImageDraw.Draw(im)
    f1 = ImageFont.truetype(FONT, int(128 * s * SS))
    centered_s(d2, cx, 325 * s, 'Custom', f1, INK)
    centered_s(d2, cx, 455 * s, 'patches', f1, INK)
    f2 = ImageFont.truetype(FONT, int(40 * s * SS))
    centered_s(d2, cx, 130 * s, 'GET SEEN SIGNS', f2, YEL)
    centered_s(d2, cx, 800 * s, 'PVC and embroidered', f2, WHITE)
    return im.resize((size, size), Image.LANCZOS)


def centered_s(d, cx, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text((cx * SS - w / 2, y * SS), text, font=f, fill=fill)


def pricing(size=900):
    im = Image.new('RGB', (size * SS, size * SS), INK)
    d = ImageDraw.Draw(im)
    s = size / 900
    cx = size / 2
    fh = ImageFont.truetype(FONT, int(76 * s * SS))
    fs = ImageFont.truetype(FONT, int(30 * s * SS))
    fl = ImageFont.truetype(FONT, int(34 * s * SS))
    fp = ImageFont.truetype(FONT, int(72 * s * SS))
    centered_s(d, cx, 70 * s, 'GET SEEN SIGNS', fs, YEL)
    centered_s(d, cx, 120 * s, 'Custom patches', fh, WHITE)
    rows = [('50 PVC patches, 3 in', '$329'), ('50 embroidered patches', '$239'), ('100 embroidered patches', '$309')]
    y = 270 * s
    for label, price in rows:
        d.rounded_rectangle([90 * s * SS, y * SS, (size - 90 * s) * SS, (y + 150 * s) * SS], radius=26 * s * SS, fill=YEL)
        d.text((130 * s * SS, (y + 58 * s) * SS), label, font=fl, fill=INK)
        pw = d.textlength(price, font=fp)
        d.text(((size - 130 * s) * SS - pw, (y + 34 * s) * SS), price, font=fp, fill=INK)
        y += 175 * s
    centered_s(d, cx, 810 * s, 'Free shipping in the lower 48', fs, WHITE)
    return im.resize((size, size), Image.LANCZOS)


def save(im, base, small):
    im.save(os.path.join(OUT, base + '.jpg'), quality=88, optimize=True)
    im.save(os.path.join(OUT, base + '.webp'), quality=82, method=6)
    im.resize((small, small), Image.LANCZOS).save(os.path.join(OUT, base + '-sm.webp'), quality=80, method=6)


if __name__ == '__main__':
    save(hero(1024), 'p-19-custom-patches', 400)
    save(pricing(900), 'g-19-custom-patches-2', 480)
    print('wrote p-19-custom-patches and g-19-custom-patches-2')
