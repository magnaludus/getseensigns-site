# Makes the responsive files for the /portfolio/ page from the untouched original photo.
#   python3 src/tools/make_portfolio_images.py /path/to/original.jpg
# The original JPG is saved byte for byte (no re-encode, no crop) and is the fallback <img>.
# The WebP files are straight resizes of it: same framing, nothing retouched or redrawn.
import os
import shutil
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'portfolio')
BASE = 'rhytec-industries-event-tent'
WIDTHS = (480, 768, 1200)


def main(src_path):
    os.makedirs(OUT, exist_ok=True)
    shutil.copyfile(src_path, os.path.join(OUT, BASE + '.jpg'))
    src = Image.open(src_path).convert('RGB')
    for w in WIDTHS:
        im = src if w == src.width else src.resize((w, round(src.height * w / src.width)), Image.LANCZOS)
        im.save(os.path.join(OUT, f'{BASE}-{w}.webp'), quality=76, method=6)
    print('portfolio images written to', OUT)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
