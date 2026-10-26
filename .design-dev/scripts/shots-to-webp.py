"""Dev only. Shrinks PNG screenshots to WebP for the pull request: python3 scripts/shots-to-webp.py <in dir> <out dir>.
Desktop shots (1440 wide) are scaled to 1200; phone shots (780 wide, 2x) are kept. Needs: pip install pillow."""
import os, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
total = 0
for name in sorted(os.listdir(src)):
    if not name.endswith('.png'):
        continue
    im = Image.open(os.path.join(src, name)).convert('RGB')
    if im.width > 1200:
        im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    out = os.path.join(dst, name[:-4] + '.webp')
    im.save(out, 'WEBP', quality=80, method=6)
    total += os.path.getsize(out)
print(f'{len(os.listdir(dst))} files, {total // 1024} KB in {dst}')
