# Draws the stand-in Metal Business Cards images (no photo exists yet). Plain brand graphics: black #14161A and yellow #FFD100,
# with flat colored cards labeled by finish. They are not photos and make no claim about how the cards look.
# Replace these files with real product photos when there are some, keeping the same names:
#   assets/img/p-20-metal-business-cards.jpg / .webp / -sm.webp   (1024 px and 400 px)
#   assets/img/g-20-metal-business-cards-2.jpg / .webp / -sm.webp (900 px and 480 px)
# Run: python3 src/tools/make_card_placeholders.py   (needs pillow)
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'img')
INK = (20, 22, 26)
YEL = (255, 209, 0)
WHITE = (255, 255, 255)
FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
SS = 2
FINISHES = [('Stainless steel', (190, 194, 200), INK), ('Black', (38, 40, 46), WHITE), ('Gold', (214, 174, 72), INK), ('Rose gold', (214, 150, 132), INK)]


def font(px, s):
    return ImageFont.truetype(FONT, int(px * s * SS))


def centered(d, cx, y, text, f, fill, s):
    w = d.textlength(text, font=f)
    d.text((cx * SS - w / 2, y * SS), text, font=f, fill=fill)


def hero(size=1024):
    s = size / 1024
    im = Image.new('RGB', (size * SS, size * SS), INK)
    d = ImageDraw.Draw(im)
    cx = size / 2
    centered(d, cx, 110 * s, 'GET SEEN SIGNS', font(40, s), YEL, s)
    centered(d, cx, 170 * s, 'Metal business cards', font(84, s), WHITE, s)
    cw, ch = 560 * s, 125 * s
    y = 315 * s
    for i, (name, fill, ink) in enumerate(FINISHES):
        x0 = cx - cw / 2 + (i % 2) * 40 * s - 20 * s
        d.rounded_rectangle([x0 * SS, y * SS, (x0 + cw) * SS, (y + ch) * SS], radius=18 * s * SS, fill=fill, outline=YEL if name == 'Black' else None, width=int(4 * s * SS))
        f = font(46, s)
        w = d.textlength(name, font=f)
        d.text(((x0 + cw / 2) * SS - w / 2, (y + ch / 2 - 26 * s) * SS), name, font=f, fill=ink)
        y += ch + 24 * s
    return im.resize((size, size), Image.LANCZOS)


def pricing(size=900):
    s = size / 900
    im = Image.new('RGB', (size * SS, size * SS), INK)
    d = ImageDraw.Draw(im)
    cx = size / 2
    centered(d, cx, 40 * s, 'GET SEEN SIGNS', font(28, s), YEL, s)
    centered(d, cx, 80 * s, 'Metal business cards', font(64, s), WHITE, s)
    rows = [('50 stainless steel cards', '$249'), ('100 stainless steel cards', '$299'), ('250 stainless steel cards', '$499'), ('50 black cards', '$359'),
            ('100 black cards', '$449'), ('100 gold cards', '$329'), ('100 rose gold cards', '$329')]
    fl, fp = font(32, s), font(46, s)
    y = 190 * s
    for label, price in rows:
        d.rounded_rectangle([90 * s * SS, y * SS, (size - 90 * s) * SS, (y + 74 * s) * SS], radius=18 * s * SS, fill=YEL)
        d.text((120 * s * SS, (y + 20 * s) * SS), label, font=fl, fill=INK)
        pw = d.textlength(price, font=fp)
        d.text(((size - 120 * s) * SS - pw, (y + 12 * s) * SS), price, font=fp, fill=INK)
        y += 86 * s
    centered(d, cx, 810 * s, '0.5 mm, 1 color plus laser etch on both sides', font(28, s), WHITE, s)
    centered(d, cx, 850 * s, 'Free shipping in the lower 48', font(28, s), WHITE, s)
    return im.resize((size, size), Image.LANCZOS)


def save(im, base, small):
    im.save(os.path.join(OUT, base + '.jpg'), quality=88, optimize=True)
    im.save(os.path.join(OUT, base + '.webp'), quality=82, method=6)
    im.resize((small, small), Image.LANCZOS).save(os.path.join(OUT, base + '-sm.webp'), quality=80, method=6)


if __name__ == '__main__':
    save(hero(1024), 'p-20-metal-business-cards', 400)
    save(pricing(900), 'g-20-metal-business-cards-2', 480)
    print('wrote p-20-metal-business-cards and g-20-metal-business-cards-2')
