# Makes the web images for the Oct 30, 2026 products from the full-size photos (2000 to 2667 px JPGs).
# Same conventions as the rest of assets/img:
#   p-<key>.jpg / .webp   1024 x 1024 main photo (center crop to square when the source is not square), plus p-<key>-sm.webp at 400 px
#   g-<key>-<n>.jpg / .webp  gallery photo, 900 px square or 1200 px on the long edge, plus g-<key>-<n>-sm.webp at 480 px wide
# JPG quality 86 (optimized, progressive), WebP 80 (method 6), small WebP 78. sRGB, no metadata.
# Usage: python3 src/tools/make_product_photos.py <folder with the source photos>
import os, sys
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'assets', 'img')

# (source file, output base, kind) kind: 'p' = main square photo, 'g' = gallery photo
JOBS = [
    ('aframe-1.jpg', 'p-21-metal-a-frame-sign', 'p'),
    ('aframe-2.jpg', 'g-21-metal-a-frame-sign-2', 'g'),
    ('aframe-3.jpg', 'g-21-metal-a-frame-sign-3', 'g'),
    ('aframe-specs.jpg', 'g-21-metal-a-frame-sign-specs', 'g'),
    ('aframe-how.jpg', 'g-21-metal-a-frame-sign-how', 'g'),
    ('tabletop-1.jpg', 'p-22-tabletop-retractable-banner', 'p'),
    ('tabletop-2.jpg', 'g-22-tabletop-retractable-banner-2', 'g'),
    ('tabletop-specs.jpg', 'g-22-tabletop-retractable-banner-specs', 'g'),
    ('tabletop-how.jpg', 'g-22-tabletop-retractable-banner-how', 'g'),
    ('runner-1.jpg', 'p-23-table-runner', 'p'),
    ('runner-2.jpg', 'g-23-table-runner-2', 'g'),
    ('runner-specs.jpg', 'g-23-table-runner-specs', 'g'),
    ('runner-how.jpg', 'g-23-table-runner-how', 'g'),
    ('deluxe-1.jpg', 'g-05-retractable-banner-deluxe', 'g'),
    ('stretch-1.jpg', 'g-09-table-throw-stretch', 'g'),
    ('stretch-2.jpg', 'g-09-table-throw-stretch-2', 'g'),
]


def square(im):
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def fit(im, long_edge):
    w, h = im.size
    k = long_edge / max(w, h)
    return im.resize((round(w * k), round(h * k)), Image.LANCZOS) if k < 1 else im


def save(im, base, small_w):
    im.save(os.path.join(OUT, base + '.jpg'), quality=86, optimize=True, progressive=True)
    im.save(os.path.join(OUT, base + '.webp'), quality=80, method=6)
    w, h = im.size
    im.resize((small_w, round(h * small_w / w)), Image.LANCZOS).save(os.path.join(OUT, base + '-sm.webp'), quality=78, method=6)


def main(src):
    for name, base, kind in JOBS:
        im = ImageOps.exif_transpose(Image.open(os.path.join(src, name))).convert('RGB')
        if kind == 'p':
            save(square(im).resize((1024, 1024), Image.LANCZOS), base, 400)
        else:
            save(fit(im, 900 if im.width == im.height else 1200), base, 480)
        print(base)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: make_product_photos.py <source folder>')
    main(sys.argv[1])
