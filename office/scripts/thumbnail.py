"""Noir thumbnail: darken a video frame, add a gold Art Deco frame and a title. Usage: thumbnail.py in.png out.png "Title" """
import sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

src, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 1280, 720
GOLD, AMBER, INK = (201, 162, 39), (255, 176, 0), (10, 10, 12)

img = ImageOps.fit(Image.open(src).convert('RGB'), (W, H))
img = ImageEnhance.Color(img).enhance(0.35)  # noir: drain most of the colour
img = ImageEnhance.Brightness(ImageEnhance.Contrast(img).enhance(1.35)).enhance(0.5)
d = ImageDraw.Draw(img, 'RGBA')
d.rectangle([0, H - 260, W, H], fill=(*INK, 200))
for inset, width in ((18, 4), (32, 1)):
    d.rectangle([inset, inset, W - inset, H - inset], outline=GOLD, width=width)
for cx, cy in ((32, 32), (W - 32, 32), (32, H - 32), (W - 32, H - 32)):  # stepped deco corners
    for r in (10, 20, 30):
        d.rectangle([cx - r, cy - r, cx + r, cy + r], outline=GOLD, width=1)


def font(size):
    for name in ('Limelight-Regular.ttf', 'DejaVuSerif-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
                 '/System/Library/Fonts/Supplemental/Georgia Bold.ttf', 'C:/Windows/Fonts/georgiab.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


words, lines, size = title.upper().split(), [], 84
f = font(size)
for w in words:  # greedy wrap to the frame width
    if lines and d.textlength(lines[-1] + ' ' + w, font=f) < W - 140:
        lines[-1] += ' ' + w
    else:
        lines.append(w)
lines = lines[:2]
y = H - 70 - len(lines) * (size + 10)
for line in lines:
    x = (W - d.textlength(line, font=f)) / 2
    d.text((x + 4, y + 4), line, font=f, fill=(0, 0, 0, 230))
    d.text((x, y), line, font=f, fill=AMBER)
    y += size + 10
d.line([W / 2 - 120, H - 50, W / 2 + 120, H - 50], fill=GOLD, width=3)
img.save(out)
