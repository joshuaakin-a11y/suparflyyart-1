"""
cut-scene.py — split the balloon scene into layers so it can move in depth.

Input:  docs/design/balloon-scene.png (the artwork)
Output: public/scene/sky.webp      the scene with the balloon, man and canvas removed
        public/scene/balloon.webp  the balloon + basket on transparency
        public/scene/man.webp      the man on transparency
        public/scene/canvas.webp   the blank canvas he holds, on transparency
and prints each layer's box as percentages of the frame, for BalloonScene.tsx.

How:
 1. Find the balloon by colour (saturated red), fill its holes (the white S mark),
    and add the ropes/basket hanging beneath it.
 2. Repaint the sky under that area (OpenCV inpainting — the sky there is a
    smooth gradient, so this is invisible).
 3. Build a soft matte: inside the balloon's area, each pixel's opacity is how
    different it is from the repainted sky. Edges stay soft, sky between the
    ropes stays see-through.
 4. Upscale both layers to OUT_WIDTH px wide with Lanczos and a light unsharp
    mask, and save as WebP.

Steps 1-3 are the balloon. Step 5 cuts the man and his canvas with rembg
(two models: u2net gives the cleanest body, isnet-general-use also catches the
canvas) and repaints the plaza and sky behind them.

Usage: pip install opencv-python numpy rembg onnxruntime
       python scripts/cut-scene.py
Replace docs/design/balloon-scene.png with a higher-resolution version of the
same artwork and re-run for a sharper result.
"""

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "design" / "balloon-scene.png"
OUT = ROOT / "public" / "scene"
OUT_WIDTH = 2560  # wide enough for a 1440p screen without upscaling in the browser

img = cv2.imread(str(SRC))
if img is None:
    raise SystemExit(f"Could not read {SRC}")
H, W = img.shape[:2]
SCALE = max(1.0, OUT_WIDTH / W)
# Pixel sizes below were tuned on a 960 px wide source; scale them with the image.
f = W / 960


def px(n: float) -> int:
    return max(1, round(n * f))


def odd(n: float) -> int:
    return px(n) | 1


# 1 ─ Balloon mask by colour: the largest saturated-red region in the sky.
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
h, s, v = cv2.split(hsv)
red = (((h < 9) | (h > 168)) & (s > 110) & (v > 80)).astype(np.uint8) * 255
n, labels, stats, _ = cv2.connectedComponentsWithStats(red)
# Only regions entirely in the sky (upper 60%) count — the wet floor and the
# flower beds reflect red too.
in_sky = [i for i in range(1, n) if stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] < 0.6 * H]
balloon_id = max(in_sky, key=lambda i: stats[i, cv2.CC_STAT_AREA])
bx, by, bw, bh = stats[balloon_id, :4]
# The sunlit flank is orange, not red. Grow the red core's convex hull into warm,
# saturated pixels — but only within a narrow band around it, because the sunset
# sky is warm too. A balloon envelope is convex, so the final hull also swallows
# the white S printed on it.
core = (labels == balloon_id).astype(np.uint8) * 255
hull = np.zeros_like(red)
cv2.fillConvexPoly(hull, cv2.convexHull(cv2.findNonZero(core)), 255)
band = cv2.dilate(hull, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(0.16 * bw) | 1,) * 2))
warm = (((h < 22) | (h > 165)) & (s > 150) & (v > 120)).astype(np.uint8) * 255
grown = hull | (warm & band)
grown = cv2.morphologyEx(grown, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(grown)
keep = (lab2 == lab2[by + bh // 2, bx + bw // 2]).astype(np.uint8)
pts = cv2.findNonZero(keep)
envelope = np.zeros_like(red)
cv2.fillConvexPoly(envelope, cv2.convexHull(pts), 255)
bx, by, bw, bh = cv2.boundingRect(pts)

# Ropes and basket hang below the envelope's mouth: a narrow region under it.
region = envelope.copy()
cx = bx + bw // 2
basket_top, basket_bottom = by + bh - px(6), by + bh + int(0.18 * bh)
basket_half = max(px(10), int(0.12 * bw))
box = np.zeros_like(region)
cv2.rectangle(box, (cx - basket_half, basket_top), (cx + basket_half, basket_bottom), 255, cv2.FILLED)
# Within that box keep only the rigging itself: pixels clearly darker than the
# local sky (estimated by a wide median), so the hole hugs the ropes and basket.
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)
local_sky = cv2.medianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), odd(21)).astype(np.int16)
rig = ((local_sky - gray) > 22).astype(np.uint8) * 255 & box
rig = cv2.dilate(rig, np.ones((odd(3),) * 2, np.uint8))
region |= rig

# 2 ─ Repaint the sky under the balloon (with a margin for the soft edge).
# A sunset sky changes mostly top-to-bottom, so each column of the hole is filled
# by blending the sky just above it into the sky just below it, plus a touch of
# grain so the patch doesn't look airbrushed.
# The hole covers the envelope AND the rigging, so no column is filled from a
# dark basket pixel; a hair wider than both.
hole = cv2.dilate(envelope | region, np.ones((odd(5),) * 2, np.uint8))
sky = img.astype(np.float32).copy()
ring = px(4)  # average a few pixels outside the hole for stable end colours
for x in range(W):
    col = np.nonzero(hole[:, x])[0]
    if col.size == 0:
        continue
    top, bot = col.min(), col.max()
    a = img[max(0, top - ring) : top, x].astype(np.float32).mean(0) if top > 0 else img[bot + 1, x]
    b = img[bot + 1 : min(H, bot + 1 + ring), x].astype(np.float32).mean(0) if bot + 1 < H else a
    t = np.linspace(0, 1, bot - top + 1)[:, None]
    sky[top : bot + 1, x] = a * (1 - t) + b * t
# Smooth sideways so neighbouring columns agree, only inside the hole.
smooth = cv2.GaussianBlur(sky, (0, 0), sigmaX=6 * f, sigmaY=1.5 * f)
grain = np.random.default_rng(3).normal(0, 1.6, sky.shape).astype(np.float32)
# Feather the patch into the untouched sky so its outline never shows.
feather = cv2.GaussianBlur(cv2.dilate(hole, np.ones((odd(3),) * 2, np.uint8)).astype(np.float32) / 255, (0, 0), 1.5 * f)
feather = np.maximum(feather, (hole > 0).astype(np.float32))[..., None]
sky = img.astype(np.float32) * (1 - feather) + (smooth + grain) * feather
sky = np.clip(sky, 0, 255).astype(np.uint8)

# 3 ─ Soft matte: opacity = how unlike the sky each pixel is, inside the region.
# Only the balloon travels: the envelope (solid, with a 1px soft edge) and the
# ropes/basket — which are darker than the sky behind them. Bright sky and cloud
# pixels are left out, so nothing pale moves with the balloon.
env_soft = cv2.GaussianBlur((envelope > 0).astype(np.float32), (0, 0), 0.9 * f)
lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
sky_lum = cv2.cvtColor(sky, cv2.COLOR_BGR2GRAY).astype(np.float32)
darker = np.clip((sky_lum - lum - 18) / 30, 0, 1)
rigging = darker * ((region > 0) & (envelope == 0))
alpha = np.maximum(env_soft, cv2.GaussianBlur(rigging, (0, 0), 0.5 * f))


# 5 ─ The man and his canvas. rembg finds them in a crop around the figure.
from rembg import new_session, remove  # noqa: E402  (heavy import, only needed here)

fx0, fx1, fy0 = int(0.10 * W), int(0.37 * W), int(0.08 * H)
crop = img[fy0:, fx0:fx1]
body = remove(crop, session=new_session("u2net"))[:, :, 3].astype(np.float32) / 255
whole = remove(crop, session=new_session("isnet-general-use"))[:, :, 3].astype(np.float32) / 255

# The canvas: what isnet sees and u2net doesn't, on the left of the figure.
# It's a flat board, so its convex hull is the board (isnet sees through the
# pale surface in places).
cand = ((whole > 0.5) & (body < 0.3)).astype(np.uint8)
cand[:, int(0.55 * cand.shape[1]) :] = 0
cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((odd(5),) * 2, np.uint8))
n3, lab3, st3, _ = cv2.connectedComponentsWithStats(cand)
board = (lab3 == 1 + int(np.argmax(st3[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
board_hull = np.zeros_like(board)
cv2.fillConvexPoly(board_hull, cv2.convexHull(cv2.findNonZero(board)), 1)
canvas_a = cv2.GaussianBlur(board_hull.astype(np.float32), (0, 0), 0.7 * f)

# The man: u2net's body matte, minus anything below his shoes (wet-floor
# reflections) and minus the board.
rows = np.nonzero((body > 0.5).any(1))[0]
top, feet = rows.min(), rows.max()
# The shoes: u2net is unsure of the left shoe (it's lit like the wet floor and
# came out half see-through), so over the bottom eighth of the figure take
# whichever model is more confident.
low = top + int(0.87 * (feet - top))
body[low : feet + px(2)] = np.maximum(body[low : feet + px(2)], whole[low : feet + px(2)])
body[feet + px(2) :] = 0
# Solid core: everything clearly inside the figure is fully opaque, so no part
# of him is ever see-through; only the outermost edge stays soft.
solid = (body > 0.5).astype(np.uint8)
cnts, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
cv2.drawContours(solid, cnts, -1, 1, cv2.FILLED)  # fill holes
core = cv2.erode(solid, np.ones((odd(3),) * 2, np.uint8))
body = np.maximum(body, core.astype(np.float32))
man_a = body * (1 - np.clip(board_hull.astype(np.float32), 0, 1))

def place(a: np.ndarray) -> np.ndarray:
    full = np.zeros((H, W), np.float32)
    full[fy0:, fx0:fx1] = a
    return full

man_full, canvas_full = place(man_a), place(canvas_a)
figure = (np.maximum(man_full, canvas_full) > 0.04).astype(np.uint8) * 255
# Repaint the plaza and sky behind the figure. Only a narrow strip next to his
# outline is ever revealed (the layers shift a few dozen pixels at most), so
# each row of the hole is filled by mirroring the real scene across the hole's
# edge: the left half from just left of it, the right half from just right of
# it. The fill is continuous with its surroundings and keeps their real detail
# (flowers, tiles, reflections) sharp — nothing is blurred or blended. Where
# the two halves meet (the middle of his body) is never seen.
fill = cv2.dilate(figure, np.ones((odd(7),) * 2, np.uint8)) > 0
src = sky.copy()
for y in np.nonzero(fill.any(1))[0]:
    row = fill[y]
    xs = np.nonzero(row)[0]
    # Contiguous runs of the hole on this row (e.g. each leg separately).
    breaks = np.nonzero(np.diff(xs) > 1)[0]
    for run in np.split(xs, breaks + 1):
        l, r = run[0], run[-1]
        mid = (l + r) // 2
        for x in range(l, r + 1):
            if x <= mid and l > 0:
                sx = l - 1 - (x - l)  # mirror of the left neighbour
            else:
                sx = r + 1 + (r - x)  # mirror of the right neighbour
            sx = int(np.clip(sx, 0, W - 1))
            # Never copy from inside another part of the hole.
            while fill[y, sx] and 0 < sx < W - 1:
                sx += -1 if sx < x else 1
            src[y, x] = sky[y, sx]
sky = src

# The man's layer keeps a few pixels of the original under the board's right
# edge (where his hand grips it) so the board can rock without opening a gap.
grip = cv2.dilate(board_hull, np.ones((odd(9),) * 2, np.uint8)) * (body > 0.3)
man_a = np.maximum(man_a, grip.astype(np.float32))

HORIZON = 0.785  # where the plaza meets the city, as a fraction of the height
print(f"feet at {100 * (fy0 + feet) / H:.2f}% of the height; horizon {100 * HORIZON:.1f}%")


def cut(color: np.ndarray, alpha: np.ndarray, name: str) -> None:
    """Crop a layer to its box (plus padding), upscale and save; print its box."""
    ys, xs = np.nonzero(alpha > 0.02)
    pad = px(6)
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
    rgba = np.dstack([color, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])[y0:y1, x0:x1]
    cv2.imwrite(str(OUT / f"{name}.webp"), upscale(rgba), [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(
        f"{name:8s} box (% of frame): left {100 * x0 / W:.3f}  top {100 * y0 / H:.3f}  "
        f"width {100 * (x1 - x0) / W:.3f}  height {100 * (y1 - y0) / H:.3f}"
    )


def upscale(a: np.ndarray) -> np.ndarray:
    size = (round(a.shape[1] * SCALE), round(a.shape[0] * SCALE))
    big = cv2.resize(a, size, interpolation=cv2.INTER_LANCZOS4)
    if big.shape[2] == 3:
        blur = cv2.GaussianBlur(big, (0, 0), 1.2)
        big = cv2.addWeighted(big, 1.35, blur, -0.35, 0)
    return big


OUT.mkdir(parents=True, exist_ok=True)
print(f"source {W}x{H} -> frame {round(W * SCALE)}x{round(H * SCALE)}")
cv2.imwrite(str(OUT / "sky.webp"), upscale(sky), [cv2.IMWRITE_WEBP_QUALITY, 84])
cut(img, alpha, "balloon")
cut(img, place(man_a), "man")
cut(img, canvas_full, "canvas")
for f_ in ("sky", "balloon", "man", "canvas"):
    print(f"{f_}.webp", (OUT / f"{f_}.webp").stat().st_size // 1024, "KB")
