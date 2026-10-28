# Makes the smaller image files the pages use for phones, from the full-size files already in assets/:
#   - home hero images: hero-tent-480/768.webp, hero-banner-320/480.webp, hero-yard-320/480.webp
#   - product video posters: assets/video/<name>-poster.webp (from <name>-poster.jpg, same size)
# The full-size files stay as they are. Run after replacing a source file: python3 src/tools/make_responsive_images.py
import glob
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG = os.path.join(ROOT, 'assets', 'img')
VID = os.path.join(ROOT, 'assets', 'video')

HERO = {'hero-tent': (480, 768), 'hero-banner': (320, 480), 'hero-yard': (320, 480)}


def main():
    for name, widths in HERO.items():
        src = Image.open(os.path.join(IMG, name + '.webp')).convert('RGB')
        for w in widths:
            h = round(src.height * w / src.width)
            src.resize((w, h), Image.LANCZOS).save(os.path.join(IMG, f'{name}-{w}.webp'), quality=80, method=6)
    for jpg in sorted(glob.glob(os.path.join(VID, '*-poster.jpg'))):
        Image.open(jpg).convert('RGB').save(jpg[:-4] + '.webp', quality=70, method=6)
    print('hero variants and video posters written')


if __name__ == '__main__':
    main()
