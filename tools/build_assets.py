"""Cut every sprite the game uses out of the reference images and pack atlases.

    python3 tools/build_assets.py

Reads art/reference/*.png, writes public/assets/. Re-run whenever a reference
image changes or a new sprite is added below. Requires numpy, scipy, Pillow.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(__file__))
import paint_textures  # noqa: E402
from scipy import ndimage as ndi  # noqa: E402
from sprite_cut import (  # noqa: E402
    chroma_mask,
    luminance,
    polygon_mask,
    components,
    cutout,
    load_rgb,
    outline_mask,
    segment_prop,
    trim,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "art", "reference")
OUT = os.path.join(ROOT, "public", "assets")

# Image 03 labels, left to right, top row then bottom row.
POSE_LABELS = [0, 30, 45, 60, 90, 120, 135, 150, 180, 225, 240, 270, 300, 315, 330]
# Brief: these four are drawn facing the opposite way to their label (judge by
# the beard, not the backwards cap's brim). Mirror them.
POSE_MIRROR = {90, 150, 240, 270}


def cut_character() -> dict[str, Image.Image]:
    rgb = load_rgb(f"{REF}/03-character-15-angles.png")
    cs = components(outline_mask(rgb), 8000)
    cs.sort(key=lambda c: (c[0].start // 300, c[1].start))
    assert len(cs) == 15, f"expected 15 poses, found {len(cs)}"
    out = {}
    for label, (ys, xs, m) in zip(POSE_LABELS, cs):
        img = trim(cutout(rgb, ys, xs, m))
        if label in POSE_MIRROR:
            img = ImageOps.mirror(img)
        out[f"castaway_{label:03d}"] = img
    return out


def split_legs(poses: dict[str, Image.Image]) -> dict[str, Image.Image]:
    """Cut every pose into body, left leg and right leg so the game can step
    the legs in turn until real walk-cycle frames exist. Each part keeps the
    pose's full canvas, so all three share one origin and line up exactly.

    The legs start just above the crotch (found from the gap between the
    boots); the body keeps a few rows of overlap so a lifted leg slides up
    under it instead of opening a seam."""
    out = {}
    for name, img in poses.items():
        a = np.array(img)
        alpha = a[..., 3] > 128
        h, w = alpha.shape
        feet = alpha[int(h * 0.88) :].sum(0)
        cols = np.nonzero(feet)[0]
        lo, hi = cols[0], cols[-1]
        mid = slice(lo + (hi - lo) // 4, hi - (hi - lo) // 4)
        split_x = mid.start + int(np.argmin(feet[mid]))
        if feet[split_x] > feet[lo:hi].max() * 0.5:  # boots overlap: split the feet down the middle
            split_x = (lo + hi) // 2
        gap = ~alpha[:, max(0, split_x - 1) : split_x + 2].any(1)
        row = h - 1
        while row > h * 0.6 and (gap[row] or row > h - 4):
            row -= 1
        crotch = row + 1
        split_y = min(crotch - 6, int(h * 0.78)) if crotch < h - 10 else int(h * 0.74)
        top = a.copy()
        top[split_y + 8 :, :, 3] = 0
        left = a.copy()
        left[:split_y, :, 3] = 0
        left[:, split_x:, 3] = 0
        right = a.copy()
        right[:split_y, :, 3] = 0
        right[:, :split_x, 3] = 0
        out[f"{name}_body"] = Image.fromarray(top, "RGBA")
        out[f"{name}_legl"] = Image.fromarray(left, "RGBA")
        out[f"{name}_legr"] = Image.fromarray(right, "RGBA")
    return out


def cut_palms() -> dict[str, Image.Image]:
    rgb = load_rgb(f"{REF}/04-palm-trees.png")
    cs = components(chroma_mask(rgb, (133, 107, 84)), 3000)
    cs.sort(key=lambda c: (c[0].start // 200, c[1].start))
    assert len(cs) == 16, f"expected 16 palm parts, found {len(cs)}"
    names = (
        ["palm_000", "palm_045", "palm_090", "palm_135", "palm_crown", "palm_coconuts", "palm_trunk"]
        + ["palm_180", "palm_225", "palm_270", "palm_315"]
        + [f"palm_sway_{i}" for i in range(5)]
    )
    # Components sort row by row; in the top row the breakdown column's crown,
    # coconuts and trunk are stacked, so order them by their y.
    top, rest = cs[:7], cs[7:]
    angles = sorted(top[:4], key=lambda c: c[1].start)
    breakdown = sorted(top[4:], key=lambda c: c[0].start)
    ordered = angles + breakdown + rest
    out = {}
    for name, (ys, xs, m) in zip(names, ordered):
        img = trim(cutout(rgb, ys, xs, m))
        out[name] = img if name in ("palm_crown", "palm_coconuts") else centre_on_base(img)
    return out


def centre_on_base(img: Image.Image, rows: int = 14) -> Image.Image:
    """Pad sideways so the middle of the trunk's base is the image's centre.
    The game anchors trees at bottom-centre, so every angle and every sway
    frame then stands on the same spot."""
    a = np.array(img.getchannel("A")) > 128
    ys = np.nonzero(a.any(1))[0]
    base = a[ys[-1] - rows : ys[-1] + 1]
    cx = np.nonzero(base.any(0))[0].mean()
    shift = int(round(img.width / 2 - cx))
    w = img.width + abs(shift) * 2
    out = Image.new("RGBA", (w, img.height), (0, 0, 0, 0))
    out.paste(img, (abs(shift) + shift, 0))
    return trim_x_symmetric(out)


def trim_x_symmetric(img: Image.Image) -> Image.Image:
    a = np.array(img.getchannel("A")) > 8
    cols = np.nonzero(a.any(0))[0]
    margin = min(cols[0], img.width - 1 - cols[-1])
    return img.crop((margin, 0, img.width - margin, img.height))


# Props cut from image 06. Boxes and polygons are in image-06 pixels; image 06
# is drawn at the game's world scale (the castaway is ~150px tall in it).
PROPS = {
    "hut": dict(
        box=(780, 195, 1150, 550),
        poly=[(786, 368), (860, 286), (868, 268), (1050, 203), (1068, 212), (1082, 240), (1147, 352), (1125, 382),
              (1114, 450), (1117, 522), (1062, 548), (940, 550), (830, 537), (798, 512), (798, 470), (806, 450),
              (803, 385)],
    ),
    "dock": dict(
        box=(190, 660, 510, 875),
        poly=[(195, 797), (205, 765), (258, 736), (266, 668), (300, 660), (306, 688), (370, 666), (384, 670),
              (470, 722), (508, 770), (496, 784), (472, 772), (447, 792), (410, 800), (378, 802), (374, 852),
              (355, 858), (338, 850), (328, 830), (320, 872), (298, 872), (290, 843), (265, 848), (218, 842),
              (210, 812)],
        exclude=[[(296, 682), (340, 680), (342, 707), (318, 714), (296, 706)]],
        keep="300",
    ),
    "raft": dict(
        box=(60, 760, 360, 1055),
        poly=[(150, 768), (165, 768), (167, 790), (232, 850), (228, 862), (205, 852), (205, 880), (260, 880),
              (275, 860), (285, 870), (285, 890), (315, 905), (320, 925), (352, 935), (352, 967), (330, 977),
              (240, 1032), (222, 1047), (185, 1047), (100, 997), (68, 977), (68, 945), (125, 915), (130, 880),
              (128, 815), (145, 800)],
        keep="300",
        extra=dict(
            mode="poly",
            poly=[(150, 778), (170, 780), (228, 850), (232, 862), (212, 890), (185, 918), (150, 918), (132, 910),
                  (132, 860), (138, 808)],
        ),
    ),
    "chest": dict(box=(445, 315, 612, 465)),
    "crate": dict(box=(618, 335, 705, 415)),
    "map_sign": dict(box=(283, 512, 400, 660)),
    "barrel": dict(box=(398, 606, 446, 668)),
    "garden": dict(box=(780, 585, 1225, 860)),
    "campfire": dict(
        box=(560, 600, 700, 725),
        poly=[(566, 668), (600, 655), (660, 655), (694, 672), (694, 702), (668, 724), (600, 725), (566, 706)],
        keep="200",
        extra=dict(
            mode="poly",
            poly=[(598, 676), (600, 658), (612, 630), (626, 606), (638, 618), (652, 640), (664, 662), (660, 680)],
        ),
    ),
    "campfire_flame": dict(
        box=(560, 600, 700, 725),
        mode="poly",
        poly=[(600, 680), (600, 658), (612, 630), (626, 606), (638, 618), (652, 640), (662, 662), (658, 682)],
    ),
    "starfish": dict(
        box=(612, 836, 680, 890),
        mode="poly",
        poly=[(645, 839), (652, 853), (675, 856), (658, 866), (664, 887), (645, 875), (626, 887), (632, 866),
              (614, 856), (638, 853)],
    ),
    "fern": dict(
        box=(1082, 512, 1186, 592),
        mode="poly",
        poly=[(1087, 563), (1103, 538), (1120, 530), (1133, 515), (1150, 522), (1162, 525), (1172, 545), (1182, 562),
              (1160, 581), (1140, 587), (1110, 580)],
    ),
}


def cut_props() -> tuple[dict[str, Image.Image], dict[str, list[int]]]:
    """Props from image 06, plus where each one sits in image 06 (x0, y0,
    x1, y1) so the camp can be laid out exactly as the image shows it."""
    rgb = load_rgb(f"{REF}/06-island-concept.png")
    out, rects = {}, {}
    for name, spec in PROPS.items():
        spec = dict(spec)
        extra = spec.pop("extra", None)
        ys, xs, m = segment_prop(rgb, **spec)
        if extra:
            _, _, m2 = segment_prop(rgb, box=spec["box"], **extra)
            m = m | m2
        out[name] = trim(cutout(rgb, ys, xs, m))
        rows, cols = np.nonzero(m)
        rects[name] = [int(xs.start + cols.min()), int(ys.start + rows.min()), int(xs.start + cols.max() + 1),
                       int(ys.start + rows.max() + 1)]
    return out, rects


# Image 10's rows, top to bottom, and how much each is scaled to sit at the
# castaway's size (a big cluster ends up about 1.5 times his width).
ROCK_ROWS = [("rock_cluster", 0.62), ("rock_cluster", 0.62), ("rock_medium", 0.6), ("rock_small", 0.55), ("pebble", 0.5)]


def cut_rocks() -> tuple[dict[str, Image.Image], dict[str, list[dict]]]:
    """Rocks from image 10. Its background is a smooth blurred gradient as
    bright as the rocks in places, so rocks are found by their painted
    texture and outline instead of by colour."""
    rgb = load_rgb(f"{REF}/10-rocks.png")
    lum = luminance(rgb.astype(np.float32))
    mean = ndi.uniform_filter(lum, 5)
    std = np.sqrt(np.clip(ndi.uniform_filter(lum * lum, 5) - mean * mean, 0, None))
    m = ndi.binary_closing(std > 6, np.ones((3, 3)), iterations=3)
    m = ndi.binary_opening(ndi.binary_fill_holes(m), np.ones((5, 5)))
    cs = components(m, 250)
    # Group into rows by vertical centre, then left to right.
    cs.sort(key=lambda c: (c[0].start + c[0].stop) / 2)
    rows: list[list] = []
    for c in cs:
        cy = (c[0].start + c[0].stop) / 2
        if rows and cy - (rows[-1][-1][0].start + rows[-1][-1][0].stop) / 2 < 70:
            rows[-1].append(c)
        else:
            rows.append([c])
    assert len(rows) == len(ROCK_ROWS), f"expected {len(ROCK_ROWS)} rows of rocks, found {len(rows)}"
    out: dict[str, Image.Image] = {}
    groups: dict[str, list[dict]] = {}
    counters: dict[str, int] = {}
    for row, (group, scale) in zip(rows, ROCK_ROWS):
        for ys, xs, sub in sorted(row, key=lambda c: c[1].start):
            sub = ndi.binary_erosion(sub, iterations=2)  # shed the background's glow
            img = trim(cutout(rgb, ys, xs, sub))
            img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
            i = counters.get(group, 0)
            counters[group] = i + 1
            name = f"{group}_{i}"
            out[name] = img
            groups.setdefault(group, []).append({"frame": name, "w": img.width, "h": img.height})
    return out, groups


def rounded_rect(x0: float, y0: float, x1: float, y1: float, r: float) -> list[tuple[float, float]]:
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for t in range(0, 91, 10):
            a = math.radians(a0 + t)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def circle(cx: float, cy: float, r: float) -> list[tuple[float, float]]:
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in range(0, 360, 6)]


def not_sea(rgb: np.ndarray) -> np.ndarray:
    """Everything except the teal sea the mock-up's HUD sits on."""
    f = rgb.astype(np.int16)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    sea = (np.abs(g - b) < 35) & (g > r + 12) & (luminance(rgb.astype(np.float32)) < 150)
    return ~sea


def inpaint(rgb: np.ndarray, boxes: list[tuple[int, int, int, int]], select) -> np.ndarray:
    """Paint text out of a panel: pixels chosen by select() inside the boxes
    are filled from their surroundings."""
    import cv2

    mask = np.zeros(rgb.shape[:2], np.uint8)
    for x0, y0, x1, y1 in boxes:
        sub = select(rgb[y0:y1, x0:x1])
        mask[y0:y1, x0:x1] |= sub.astype(np.uint8)
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, mask * 255, 5, cv2.INPAINT_TELEA)
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


# HUD pieces from image 08 (the island HUD mock-up), in image-08 pixels.
HUD_SHAPES = {
    "minimap": rounded_rect(20, 27, 238, 262, 3),
    "portrait": circle(301, 77.5, 50),
    "bar": rounded_rect(400, 66, 563, 99, 6),
    "settings": rounded_rect(1457, 18, 1517, 78, 6),
    "quest_panel": rounded_rect(1232, 97, 1521, 215, 4),
    "button_map": rounded_rect(847, 852, 1001, 993, 11),
    "button_create": rounded_rect(1032, 852, 1183, 993, 11),
    "button_inventory": rounded_rect(1212, 852, 1361, 993, 11),
    "button_hand": circle(1462, 926, 61),
}
HUD_ICONS = {
    "icon_health": (362, 63, 401, 102),
    "icon_food": (361, 114, 401, 151),
    "icon_water": (364, 162, 398, 201),
    "icon_coin": (362, 212, 403, 253),
    "button_plus": (466, 213, 508, 256),
}


def cut_hud() -> tuple[dict[str, Image.Image], dict]:
    rgb = load_rgb(f"{REF}/08-island-hud-mockup.png")
    dark = lambda sub: luminance(sub.astype(np.float32)) < 110  # noqa: E731
    light = lambda sub: luminance(sub.astype(np.float32)) > 165  # noqa: E731
    # The quest panel's words and count, and the health bar's numbers.
    clean = inpaint(rgb, [(1281, 118, 1450, 150), (1244, 168, 1408, 197), (1472, 168, 1508, 197)], dark)
    clean = inpaint(clean, [(465, 69, 560, 97)], light)

    out: dict[str, Image.Image] = {}
    for name, poly in HUD_SHAPES.items():
        xs_, ys_ = [p[0] for p in poly], [p[1] for p in poly]
        box = (int(min(xs_)) - 1, int(min(ys_)) - 1, int(max(xs_)) + 2, int(max(ys_)) + 2)
        ys, xs, m = segment_prop(clean, box=box, poly=poly, mode="poly")
        out[name] = trim(cutout(clean, ys, xs, m, pad=1))
    for name, box in HUD_ICONS.items():
        x0, y0, x1, y1 = box
        sub = rgb[y0:y1, x0:x1]
        m = ndi.binary_fill_holes(ndi.binary_opening(not_sea(sub), np.ones((2, 2))))
        lab, _ = ndi.label(m)
        h, w = m.shape
        m = lab == lab[h // 2, w // 2]
        out[name] = trim(cutout(rgb, slice(y0, y1), slice(x0, x1), m, pad=1))

    # The bar splits into an empty track and a grey fill the game tints with
    # each stat's colour, keeping the painted shading of image 08.
    bar = np.array(out.pop("bar")).astype(np.float32)
    rgbf, alpha = bar[..., :3], bar[..., 3]
    fill = (rgbf[..., 0] > rgbf[..., 1] + 45) & (alpha > 200)
    fill = ndi.binary_fill_holes(ndi.binary_closing(fill, np.ones((3, 3)), iterations=2))
    lum = luminance(rgbf)
    grey = np.clip(lum / np.percentile(lum[fill], 92), 0, 1) * 255
    # The right of the bar held the numbers, so rebuild the fill from its clean
    # left end: the left cap, its middle repeated, and the cap mirrored.
    x0, x1 = np.nonzero(fill.any(0))[0][[0, -1]]
    clean_cols = list(range(x0, x0 + 60))
    middle = clean_cols[12:]
    order = clean_cols[:12]
    while len(order) < (x1 - x0 + 1) - 12:
        order += middle if (len(order) // len(middle)) % 2 == 0 else middle[::-1]
    order = order[: (x1 - x0 + 1) - 12] + clean_cols[:12][::-1]
    for arr in (grey, alpha):
        arr[:, x0 : x1 + 1] = arr[:, order]
    fill[:, x0 : x1 + 1] = fill[:, order]
    fill_rgba = np.dstack([grey, grey, grey, np.where(fill, alpha, 0)]).astype(np.uint8)
    track = rgbf.copy()
    track[fill] = np.array([42, 35, 27], np.float32) * (0.75 + 0.5 * (lum[fill, None] / 255))
    out["bar_fill"] = Image.fromarray(fill_rgba, "RGBA")
    out["bar_track"] = Image.fromarray(np.dstack([track, alpha]).astype(np.uint8), "RGBA")
    rows, cols = np.nonzero(fill)
    layout = {"barFill": [int(cols.min()), int(rows.min()), int(cols.max() + 1), int(rows.max() + 1)]}

    # Image 08 has no energy bar; its lightning icon comes from image 07's HUD.
    fp = load_rgb(f"{REF}/07-fishing-pov.png")
    ys, xs, m = segment_prop(fp, box=(20, 298, 64, 350))
    out["icon_energy"] = trim(cutout(fp, ys, xs, m, pad=1))

    out["minimap"] = clean_minimap(out["minimap"], clean)
    return out, layout


def clean_minimap(img: Image.Image, clean: np.ndarray) -> Image.Image:
    """Swap the painted island inside the mock-up's map for plain parchment,
    taken from the quest panel and matched to the map's aged colour, so the
    game can draw the real island there. The torn border, the pins and the
    north arrow stay."""
    a = np.array(img).astype(np.float32)
    h, w = a.shape[:2]
    rng = np.random.default_rng(6)
    edge = a[6:16, 20:-20, :3].reshape(-1, 3)
    base = np.median(edge, 0) * 1.1
    mottle = ndi.gaussian_filter(rng.random((h, w)), 9)
    mottle = (mottle - mottle.mean()) / mottle.std()
    grain = ndi.gaussian_filter(rng.random((h, w)), 0.7) - 0.5
    paper = base * (1 + 0.05 * mottle[..., None] + 0.08 * grain[..., None])
    inner = np.zeros((h, w), np.float32)
    inner[16 : h - 14, 14 : w - 14] = 1
    inner[10:60, w - 64 : w - 14] = 0  # keep the N and its arrow
    inner = ndi.gaussian_filter(inner, 5)
    a[..., :3] = a[..., :3] * (1 - inner[..., None]) + paper * inner[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


# Image 07 (first-person fishing off the dock), in its own pixels.
# The hand, reel and sleeve: a loose outline; the sprite is whatever the
# painted outline encloses inside it.
HAND_POLY = [
    (748, 998), (790, 986), (800, 960), (862, 960), (868, 1000), (905, 1012), (925, 1030), (958, 1100),
    (972, 1150), (1020, 1168), (1086, 1192), (1086, 1448), (935, 1448), (905, 1330), (888, 1385), (866, 1385),
    (845, 1300), (838, 1225), (818, 1215), (803, 1190), (793, 1155), (788, 1120), (780, 1100), (765, 1110),
    (742, 1095), (732, 1060), (736, 1020),
]
FISHING_UI = {
    "panel": rounded_rect(294, 50, 787, 271, 4),
    "power_bar": rounded_rect(296, 1181, 809, 1234, 12),
    "button_big": rounded_rect(229, 1259, 851, 1386, 18),
    "close_x": rounded_rect(957, 30, 1057, 131, 9),
}
FISHING_HUD_BOXES = [(0, 0, 282, 468), (288, 44, 793, 278), (798, 178, 1082, 292), (950, 24, 1064, 138)]
FISHING_LINES = [[(640, 352), (649, 352), (604, 840), (596, 840)], [(694, 545), (704, 545), (742, 990), (733, 990)]]


def cut_fishing() -> tuple[dict[str, Image.Image], dict]:
    """The first-person fishing view from image 07: the rod and hand as one
    sprite, the UI pieces, and the scene behind them with the painted HUD,
    words, rod and line taken out."""
    import cv2

    rgb = load_rgb(f"{REF}/07-fishing-pov.png")
    h, w = rgb.shape[:2]
    out: dict[str, Image.Image] = {}

    # The rod: its near-black outline found row by row, then smoothed with a
    # gentle curve so stray dark water can't make the edges ragged.
    lum = luminance(rgb.astype(np.float32))
    ys_, lefts, rights = [], [], []
    for y in range(352, 930):
        cx = 647 + 0.2813 * (y - 345)
        x0 = int(cx - 34)
        idx = np.nonzero(lum[y, x0 : x0 + 68] < 30)[0]
        if len(idx) >= 2 and idx[-1] - idx[0] > 8:
            ys_.append(y)
            lefts.append(x0 + idx[0])
            rights.append(x0 + idx[-1])
    fl, fr = np.polyfit(ys_, lefts, 2), np.polyfit(ys_, rights, 2)
    yy_ = np.arange(342, 1001, 4)
    rod_poly = [(np.polyval(fl, y) - 0.5, y) for y in yy_] + [(np.polyval(fr, y) + 1.5, y) for y in yy_[::-1]]
    rod_mask = polygon_mask((h, w), rod_poly)
    yy, xx = np.mgrid[0:h, 0:w]
    rod_mask |= (xx - 647) ** 2 + (yy - 343) ** 2 <= 8.5**2  # rounded tip
    # The hand, reel and sleeve: the loose outline minus the sea behind them.
    hand = polygon_mask((h, w), HAND_POLY) & not_sea(rgb)
    hand = ndi.binary_opening(hand, np.ones((3, 3)))
    lab, _ = ndi.label(hand)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    rod_mask |= ndi.binary_fill_holes(lab == sizes.argmax())
    for name in ("power_bar", "button_big"):
        rod_mask &= ~polygon_mask((h, w), FISHING_UI[name])
    out["rod_hand"] = cutout(rgb, slice(0, h), slice(0, w), rod_mask, pad=0)
    rows, cols = np.nonzero(rod_mask)
    rod_box = [int(cols.min()), int(rows.min()), int(cols.max() + 1), int(rows.max() + 1)]
    out["rod_hand"] = out["rod_hand"].crop(rod_box)

    # UI pieces.
    clean_ui = inpaint(rgb, [(312, 66, 770, 256)], lambda sub: luminance(sub.astype(np.float32)) < 120)
    clean_ui = inpaint(clean_ui, [(380, 1280, 700, 1370)], lambda sub: luminance(sub.astype(np.float32)) > 150)
    for name, poly in FISHING_UI.items():
        xs_, ys_ = [p[0] for p in poly], [p[1] for p in poly]
        box = (int(min(xs_)) - 1, int(min(ys_)) - 1, int(max(xs_)) + 2, int(max(ys_)) + 2)
        bys, bxs, bm = segment_prop(clean_ui, box=box, poly=poly, mode="poly")
        out[name] = trim(cutout(clean_ui, bys, bxs, bm, pad=1))
    # The big button as a grey the game tints: green to cast, orange to strike.
    b = np.array(out["button_big"]).astype(np.float32)
    lum = luminance(b[..., :3])
    face = (b[..., 1] > b[..., 0] + 20) & (b[..., 3] > 200)
    grey = np.clip(lum / np.percentile(lum[face], 90), 0, 1.15) * 255 / 1.15
    # Paint out what's left of the words: each row of the face's middle takes
    # the row's own shade from either side of the lettering.
    bw = grey.shape[1]
    mid = np.zeros_like(face)
    mid[:, int(bw * 0.18) : int(bw * 0.82)] = True
    for y in range(grey.shape[0]):
        side = face[y] & ~mid[y]
        if side.sum() > 10:
            grey[y, face[y] & mid[y]] = np.median(grey[y, side])
    out["button_big"] = Image.fromarray(np.dstack([grey, grey, grey, b[..., 3]]).clip(0, 255).astype(np.uint8), "RGBA")

    # The scene: lift out the distant island (the game shows one only when
    # there is land that way), then remove HUD, words, UI, rod, hand and lines.
    horizon = 568
    no_island, island, island_rect = lift_island(rgb, (85, 405, 448, 618), horizon, sea=(455, 600), avoid=FISHING_HUD_BOXES)
    out["distant_island"] = island
    mask = ndi.binary_dilation(rod_mask, iterations=5)
    for x0, y0, x1, y1 in FISHING_HUD_BOXES:
        mask[y0:y1, x0:x1] = True
    for poly in FISHING_LINES:
        mask |= ndi.binary_dilation(polygon_mask((h, w), poly), iterations=2)
    # The painted power bar stays (the game draws over the same spot); its
    # "POWER" label goes, since the game relabels the bar while reeling.
    mask |= ndi.binary_dilation(polygon_mask((h, w), FISHING_UI["button_big"]), iterations=8)
    mask[1186:1230, 170:288] = True
    os.makedirs(os.path.join(OUT, "fishing"), exist_ok=True)
    clean_scene(no_island, mask, horizon).save(os.path.join(OUT, "fishing", "dock.jpg"), quality=88)
    shore = cut_shore(rod_mask)

    layout = {
        "size": [w, h],
        "horizon": horizon,
        "rodBox": rod_box,
        "rodTip": [647, 343],
        "rodPivot": [850, 1110],
        "islandRect": island_rect,
        "shore": shore,
        "skyTop": [int(v) for v in np.median(rgb[0:6, 300:900].reshape(-1, 3), 0)],
        **{name: [int(min(p[0] for p in poly)), int(min(p[1] for p in poly)), int(max(p[0] for p in poly)),
                  int(max(p[1] for p in poly))] for name, poly in FISHING_UI.items()},
    }
    return out, layout


def fill_rows(img: np.ndarray, hole: np.ndarray, rows) -> None:
    """Fill each row's hole by blending between the clear pixels either side
    of it, so sky gradients and clouds carry straight across."""
    w = img.shape[1]
    for y in rows:
        cols = np.nonzero(hole[y])[0]
        if not len(cols):
            continue
        runs = np.split(cols, np.nonzero(np.diff(cols) > 1)[0] + 1)
        for r in runs:
            a, b = r[0] - 1, r[-1] + 1
            left = img[y, max(0, a - 3) : a + 1].mean(0) if a >= 0 else None
            right = img[y, b : min(w, b + 4)].mean(0) if b < w else None
            if left is None:
                left = right
            if right is None:
                right = left
            t = (np.arange(len(r)) + 1) / (len(r) + 1)
            img[y, r] = left[None] * (1 - t[:, None]) + right[None] * t[:, None]


def lift_island(rgb: np.ndarray, box, horizon: int, sea: tuple[int, int], avoid=()):
    """Take the distant island out of a fishing view. Returns the view
    without it, the island as a sprite, and where the sprite sat. Sea rows
    are refilled from a clear strip of the same rows (sea = its x range),
    and the sky by blending across from either side. avoid: boxes (the
    painted HUD) the sky blend must not borrow from."""
    h, w = rgb.shape[:2]
    # The island is whatever differs from the open sky or sea on either side
    # of it in the same row.
    x0, y0, x1, y1 = box
    f = rgb.astype(np.float32)
    land = np.zeros((h, w), bool)
    for y in range(y0, y1):
        ref = np.concatenate([f[y, max(0, x0 - 50) : x0], f[y, x1 : min(w, x1 + 50)]])
        d = np.sqrt(((f[y, x0:x1] - np.median(ref, 0)) ** 2).sum(-1))
        land[y, x0:x1] = d > 24
    land = ndi.binary_opening(land, np.ones((2, 2)))
    land = ndi.binary_fill_holes(ndi.binary_closing(land, np.ones((3, 3)), iterations=2))
    lab, _ = ndi.label(land)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    land = np.isin(lab, np.nonzero(sizes > 150)[0])
    rows, cols = np.nonzero(land)
    rect = [int(cols.min()), int(rows.min()), int(cols.max() + 1), int(rows.max() + 1)]
    sprite = trim(cutout(rgb, slice(0, h), slice(0, w), land, pad=1))
    hole = ndi.binary_dilation(land, iterations=4)
    # Its shadow, reflection and foam on the water just below it.
    hole[horizon - 2 : y1 + 45, max(0, x0 - 18) : x1 + 18] = True
    out = rgb.astype(np.float32).copy()
    s0, s1 = sea
    span = s1 - s0
    for y in range(horizon - 2, h):
        c = np.nonzero(hole[y])[0]
        if len(c):
            k = (c - c[0]) % (2 * span)
            out[y, c] = rgb[y, s0 + np.where(k < span, k, 2 * span - 1 - k)]  # ping-pong across the strip
    upper = hole.copy()
    for ax0, ay0, ax1, ay1 in avoid:
        upper[ay0:ay1, ax0:ax1] = True
    upper[horizon - 2 :] = False
    fill_rows(out, upper, range(0, horizon))
    fuzz = ndi.gaussian_filter(out, (2.5, 0, 0))
    out[upper] = fuzz[upper]
    # Soften the seam where the patch meets the painting.
    edge = ndi.binary_dilation(hole, iterations=3) & ~ndi.binary_erosion(hole, iterations=3)
    blurred = ndi.gaussian_filter(out, (1.2, 1.2, 0))
    out[edge] = blurred[edge]
    return np.clip(out, 0, 255).astype(np.uint8), sprite, rect


def clean_scene(rgb: np.ndarray, mask: np.ndarray, horizon: int) -> Image.Image:
    """Fill a fishing view's masked parts: sky rows from that row's own clear
    sky, everything below the horizon painted in from around it."""
    import cv2

    scene = rgb.astype(np.float32).copy()
    fill_rows(scene, mask, range(horizon))
    rng = np.random.default_rng(7)
    sky_mask = mask.copy()
    sky_mask[horizon:] = False
    scene[sky_mask] += (rng.random((int(sky_mask.sum()), 1)) - 0.5) * 3
    low = mask.copy()
    low[:horizon] = False
    bgr = cv2.cvtColor(np.clip(scene, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    bgr = cv2.inpaint(bgr, low.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


# Image 15 (fishing from the beach): same layout as image 07, its own rod.
SHORE_HUD_RECTS = [(14, 14, 246, 242), (18, 254, 266, 394), (16, 400, 180, 456), (288, 44, 793, 278), (798, 178, 1082, 292), (950, 24, 1064, 138)]
# Image 15's rod and hand match image 07's, moved this far (found by matching).
SHORE_ROD_OFFSET = (39, 16)
SHORE_LINES = [[(684, 358), (693, 358), (646, 998), (634, 998)], [(684, 358), (693, 358), (764, 998), (750, 998)]]


def cut_shore(rod_mask: np.ndarray) -> dict:
    rgb = load_rgb(f"{REF}/15-fishing-shore-pov.png")
    h, w = rgb.shape[:2]
    horizon = 537
    no_island, _, island_rect = lift_island(rgb, (322, 428, 575, 570), horizon, sea=(160, 318), avoid=SHORE_HUD_RECTS)
    mask = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in SHORE_HUD_RECTS:
        mask[y0:y1, x0:x1] = True
    # Exactly what the game's rod sprite will cover here, and a little more.
    dx, dy = SHORE_ROD_OFFSET
    moved = np.zeros((h, w), bool)
    moved[dy:, dx:] = rod_mask[: h - dy, : w - dx]
    mask |= ndi.binary_dilation(moved, iterations=9)
    for poly in SHORE_LINES:
        mask |= ndi.binary_dilation(polygon_mask((h, w), poly), iterations=2)
    mask |= ndi.binary_dilation(polygon_mask((h, w), FISHING_UI["button_big"]), iterations=8)
    mask[1186:1230, 170:288] = True
    # Above the horizon only open sky is refilled row by row; the palm under
    # the HUD on the left is painted in from around it instead.
    palm = np.zeros_like(mask)
    palm[330:460, 0:300] = mask[330:460, 0:300]
    scene = clean_scene(no_island, mask & ~palm, horizon)
    import cv2

    bgr = cv2.cvtColor(np.array(scene), cv2.COLOR_RGB2BGR)
    bgr = cv2.inpaint(bgr, palm.astype(np.uint8) * 255, 9, cv2.INPAINT_NS)
    Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).save(os.path.join(OUT, "fishing", "shore.jpg"), quality=88)
    # The dock's rod sprite stands in for this view's own, moved to match.
    sky = [int(v) for v in np.median(rgb[0:6, 300:900].reshape(-1, 3), 0)]
    return {"horizon": horizon, "islandRect": island_rect, "rodOffset": list(SHORE_ROD_OFFSET), "skyTop": sky}


# Image 14, row by row, left to right.
FISH_NAMES = [
    "sardine", "mackerel", "red_snapper", "yellowfin_tuna",
    "parrotfish", "clownfish", "sergeant_major", "grouper", "squirrelfish",
    "lionfish", "pufferfish", "sailfish", "mahi_mahi",
    "wahoo", "barracuda", "reef_shark",
    "flounder", "coral_trout", "golden_trevally", "blue_marlin",
]


def cut_fish() -> dict[str, Image.Image]:
    """The catches from image 14. Its background is a soft colour wash, dark
    navy in places, so each fish is found by how far it differs from a
    smooth estimate of that wash."""
    rgb = load_rgb(f"{REF}/14-fish.png")
    f = rgb.astype(np.float32)
    lum = luminance(f)
    mean = ndi.uniform_filter(lum, 5)
    std = np.sqrt(np.clip(ndi.uniform_filter(lum * lum, 5) - mean * mean, 0, None))
    m = ndi.binary_fill_holes(ndi.binary_closing((std > 7) | (lum < 45), np.ones((3, 3)), iterations=3))
    for _ in range(2):
        keep = ~ndi.binary_dilation(m, iterations=6)
        wsum = ndi.gaussian_filter(keep.astype(np.float32), 30) + 1e-3
        bg = np.stack([ndi.gaussian_filter(f[..., c] * keep, 30) for c in range(3)], -1) / wsum[..., None]
        m = np.sqrt(((f - bg) ** 2).sum(-1)) > 38
        m = ndi.binary_closing(m, np.ones((3, 3)), iterations=2)
        m = ndi.binary_opening(ndi.binary_fill_holes(m), np.ones((5, 5)))
    cs = components(m, 1500)
    cs.sort(key=lambda c: ((c[0].start + c[0].stop) // 2 // 200, c[1].start))
    assert len(cs) == len(FISH_NAMES), f"expected {len(FISH_NAMES)} fish, found {len(cs)}"
    return {f"fish_{name}": trim(cutout(rgb, ys, xs, ndi.binary_erosion(sub), pad=1)) for name, (ys, xs, sub) in zip(FISH_NAMES, cs)}


# Image 05 (the Bag), in its own pixels.
BAG_TEXT_BOXES = [
    (118, 156, 275, 202), (118, 556, 280, 600), (258, 818, 330, 886),  # section headers, amount
    (776, 55, 824, 102), (840, 58, 928, 104), (1296, 58, 1358, 104),  # level, name, coins
    (1003, 686, 1084, 734), (1159, 686, 1196, 734),  # attack, defence
    (826, 792, 910, 834), (984, 792, 1066, 834), (1146, 792, 1222, 834), (1316, 792, 1392, 834),  # meters
    (1438, 455, 1492, 625),  # "STATUS (2)"
    (936, 58, 978, 102),  # the pencil, redrawn after the name
]
# Equipment slots on the right panel: weapon, tool, backpack, accessory on
# the left; cap, hoodie, pants, boots on the right.
BAG_EQUIP_SLOTS = {
    "weapon": (776, 146, 906, 283), "tool": (776, 299, 906, 435), "backpack": (776, 448, 906, 584), "accessory": (776, 597, 906, 728),
    "cap": (1260, 146, 1399, 283), "hoodie": (1260, 299, 1399, 435), "pants": (1260, 448, 1399, 584), "boots": (1260, 597, 1399, 728),
}
BAG_METER_BARS = [(782, 849, 917, 866), (941, 849, 1075, 866), (1097, 849, 1234, 866), (1265, 849, 1400, 866)]
BAG_ICONS_05 = {
    "item_sack": (780, 302, 902, 428),
    "item_cap": (1263, 150, 1396, 282),
    "item_hoodie": (1263, 302, 1396, 418),
    "item_pants": (1263, 452, 1396, 580),
    "item_boots": (1263, 598, 1396, 726),
    "tab_backpack": (76, 18, 170, 124),
    "tab_hammer": (420, 28, 500, 110),
    "icon_attack": (952, 680, 1003, 740),
    "icon_defence": (1106, 680, 1160, 738),
    "meter_health": (780, 792, 818, 834),
    "meter_energy": (946, 786, 984, 836),
    "meter_water": (1100, 786, 1137, 834),
    "meter_food": (1262, 786, 1314, 836),
    "pencil": (938, 60, 976, 100),
}
BAG_ICONS_09 = {
    "item_stone_axe": (60, 252, 288, 498),
    "item_knife": (352, 258, 556, 498),
    "item_hammer": (642, 248, 848, 498),
    "item_fishing_rod": (912, 252, 1152, 502),
    "mat_wood": (60, 706, 124, 772),
    "mat_stone": (146, 708, 204, 770),
    "mat_rope": (226, 706, 292, 774),
    "mat_hide": (508, 706, 574, 772),
    "mat_scrap": (1220, 708, 1284, 772),
}


def outline_cut(rgb: np.ndarray, box: tuple[int, int, int, int], dark: float = 50) -> Image.Image:
    """An icon inside a box: everything its dark outline encloses, keeping
    the parts that reach the middle of the box."""
    x0, y0, x1, y1 = box
    sub = rgb[y0:y1, x0:x1]
    m = luminance(sub.astype(np.float32)) < dark
    m = ndi.binary_closing(m, np.ones((3, 3)), iterations=2)
    m = ndi.binary_opening(ndi.binary_fill_holes(m), np.ones((3, 3)))
    lab, n = ndi.label(m)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    big = sizes.argmax()
    keep = {big} | {i for i in range(1, n + 1) if sizes[i] > sizes[big] * 0.15}
    return trim(cutout(rgb, slice(y0, y1), slice(x0, x1), np.isin(lab, list(keep)), pad=1))


def panel_cut(rgb: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    """A whole panel: the largest shape its thick dark outline encloses."""
    x0, y0, x1, y1 = box
    sub = rgb[y0:y1, x0:x1]
    m = ndi.binary_closing(luminance(sub.astype(np.float32)) < 40, np.ones((3, 3)), iterations=2)
    m = ndi.binary_fill_holes(m)
    lab, _ = ndi.label(m)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return cutout(rgb, slice(y0, y1), slice(x0, x1), lab == sizes.argmax(), pad=0)


def paper_fill(rgb: np.ndarray, region: tuple[int, int, int, int], patch_box: tuple[int, int, int, int]) -> np.ndarray:
    """Cover a region with the panel's own paper texture: a clean strip,
    tiled with soft seams and blended in at the edges."""
    import cv2

    out = rgb.astype(np.float32).copy()
    px0, py0, px1, py1 = patch_box
    patch = out[py0:py1, px0:px1].copy()
    x0, y0, x1, y1 = region
    w, h = x1 - x0, y1 - y0
    ph = patch.shape[0]
    canvas = np.zeros((h, w, 3), np.float32)
    weight = np.zeros((h, w, 1), np.float32)
    ramp = np.minimum(1, np.minimum(np.arange(ph), np.arange(ph)[::-1]) / (ph * 0.3) + 0.05)[:, None, None]
    tile = cv2.resize(patch, (w, ph))
    y = -ph // 3
    while y < h:
        a, b = max(0, y), min(h, y + ph)
        if b > a:
            canvas[a:b] += tile[a - y : b - y] * ramp[a - y : b - y]
            weight[a:b] += ramp[a - y : b - y]
        y += int(ph * 0.6)
    canvas /= np.maximum(weight, 1e-3)
    mask = np.zeros((h, w), np.float32)
    mask[10:-10, 10:-10] = 1
    mask = ndi.gaussian_filter(mask, 5)[..., None]
    out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - mask) + canvas * mask
    return out


def cut_bag() -> tuple[dict[str, Image.Image], dict]:
    import cv2

    rgb = load_rgb(f"{REF}/05-inventory-ui.png")
    clean = rgb.copy()
    # The example axe and mallet in the pockets: copy an empty slot over them.
    empty = rgb[225:357, 358:486].copy()
    clean[225:357, 78:206] = empty
    clean[225:357, 218:346] = empty
    # Words and numbers the game draws live.
    # The lettering has a dark outline too, so the mask reaches past the light strokes.
    clean = inpaint(clean, BAG_TEXT_BOXES, lambda sub: ndi.binary_dilation(luminance(sub.astype(np.float32)) > 140, iterations=4))
    # Meter bars back to empty tracks.
    track = np.median(rgb[851:864, 1205:1230].reshape(-1, 3), 0)
    for x0, y0, x1, y1 in BAG_METER_BARS:
        clean[y0 + 2 : y1 - 2, x0 + 3 : x1 - 3] = track
    # The example character: paper texture in his place.
    clean = np.clip(paper_fill(clean, (912, 126, 1254, 668), (912, 600, 1254, 672)), 0, 255).astype(np.uint8)

    # Every equipment slot starts empty; the game draws what he wears.
    eq_empty = rgb[448:584, 773:908]
    for x0, y0, x1, y1 in BAG_EQUIP_SLOTS.values():
        clean[y0:y1, x0:x1] = cv2.resize(eq_empty, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    out: dict[str, Image.Image] = {}
    opaque = lambda a: Image.fromarray(np.dstack([a, np.full(a.shape[:2], 255, np.uint8)]).astype(np.uint8), "RGBA")  # noqa: E731
    paper = (912, 600, 1254, 672)
    # Plain panel areas the game draws its own content on: the scrolling
    # list on the left, the Status page on the right, and the bottom bar
    # without its buttons for the Craft tab.
    lx0, ly0, lx1, ly1 = 60, 138, 682, 778
    out["bag_list_bg"] = opaque(paper_fill(clean, (lx0, ly0, lx1, ly1), paper)[ly0:ly1, lx0:lx1])
    rx0, ry0, rx1, ry1 = 760, 126, 1432, 750
    out["bag_status_bg"] = opaque(paper_fill(clean, (rx0, ry0, rx1, ry1), paper)[ry0:ry1, rx0:rx1])
    bar = clean[812:892, 350:584]
    out["bag_bar_plain"] = opaque(cv2.resize(bar, (636, 112), interpolation=cv2.INTER_CUBIC))
    out["bag_header"] = opaque(clean[147:209, 68:676])
    out["bag_left"] = panel_cut(clean, (34, 14, 726, 926))
    # The right panel with its two side tabs (Loadout and Status) as one piece.
    out["bag_right"] = panel_cut(clean, (744, 24, 1510, 926))
    out["bag_close"] = outline_cut(rgb, (1448, 40, 1528, 120), dark=70)
    out["bag_slot"] = Image.fromarray(np.dstack([empty, np.full(empty.shape[:2], 255, np.uint8)]), "RGBA")
    eq = rgb[448:584, 773:908]
    out["bag_equip_empty"] = Image.fromarray(np.dstack([eq, np.full(eq.shape[:2], 255, np.uint8)]), "RGBA")
    # The same tile without its placeholder emblem.
    plain = eq.copy()
    m = np.zeros(plain.shape[:2], np.uint8)
    m[14:-14, 14:-14] = 255
    plain = cv2.cvtColor(cv2.inpaint(cv2.cvtColor(plain, cv2.COLOR_RGB2BGR), m, 9, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
    plain[14:-14, 14:-14] = ndi.uniform_filter(plain[14:-14, 14:-14].astype(np.float32), (9, 9, 1)).astype(np.uint8)
    out["bag_equip"] = Image.fromarray(np.dstack([plain, np.full(plain.shape[:2], 255, np.uint8)]), "RGBA")
    # Buttons from the bottom bar, used again on craft cards.
    for name, (x0, y0, x1, y1) in {"bag_use": (72, 808, 240, 897), "bag_amount": (252, 812, 337, 891), "bag_bin": (592, 806, 691, 899)}.items():
        out[name] = outline_cut(clean, (x0, y0, x1, y1), dark=45)
    # The green button without its word, so the game can label it Use, Equip or Craft.
    blank = inpaint(clean, [(110, 826, 205, 880)], lambda sub: ndi.binary_dilation(luminance(sub.astype(np.float32)) > 140, iterations=3))
    out["bag_button"] = outline_cut(blank, (72, 808, 240, 897), dark=45)
    for name, box in BAG_ICONS_05.items():
        if name != "pencil":
            out[name] = outline_cut(rgb, box)
    # The pencil is drawn in light lines with no dark outline.
    x0, y0, x1, y1 = BAG_ICONS_05["pencil"]
    sub = rgb[y0:y1, x0:x1].astype(np.float32)
    a = np.clip((luminance(sub) - 95) / 60, 0, 1)
    out["pencil"] = Image.fromarray(np.dstack([sub, a * 255]).astype(np.uint8), "RGBA")
    t09 = load_rgb(f"{REF}/09-tools-weapons.png")
    for name, box in BAG_ICONS_09.items():
        out[name] = outline_cut(t09, box)
    layout = {
        "left": [34, 14],
        "right": [744, 24],
        "listBg": [lx0, ly0, lx1, ly1],
        "statusBg": [rx0, ry0, rx1, ry1],
        "barPlain": [62, 798, 698, 910],
        "equip": {k: list(v) for k, v in BAG_EQUIP_SLOTS.items()},
        "trackColour": [int(v) for v in track],
    }
    return out, layout


def pack(frames: dict[str, Image.Image], name: str, max_size: int = 2048, pad: int = 2) -> dict:
    """Shelf-pack frames into one or more pages; write a Phaser multiatlas.
    Empty borders are trimmed off and recorded, so frames keep their size."""
    sources = {k: v.size for k, v in frames.items()}
    offsets = {}
    trimmed = {}
    for k, v in frames.items():
        box = v.getchannel("A").getbbox() or (0, 0, 1, 1)
        offsets[k] = box[:2]
        trimmed[k] = v.crop(box)
    items = sorted(trimmed.items(), key=lambda kv: -kv[1].height)
    pages: list[list[tuple[str, int, int, Image.Image]]] = [[]]
    x = y = shelf = 0
    for fname, img in items:
        w, h = img.width + pad * 2, img.height + pad * 2
        if x + w > max_size:
            x, y, shelf = 0, y + shelf, 0
        if y + h > max_size:
            pages.append([])
            x = y = shelf = 0
        pages[-1].append((fname, x + pad, y + pad, img))
        x += w
        shelf = max(shelf, h)
    textures = []
    for i, page in enumerate(pages):
        pw = max(px + img.width + pad for _, px, _, img in page)
        ph = max(py + img.height + pad for _, _, py, img in page)
        pw, ph = 1 << (pw - 1).bit_length(), 1 << (ph - 1).bit_length()
        sheet = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        tframes = []
        for fname, px, py, img in page:
            sheet.paste(img, (px, py))
            w, h = img.size
            sw, sh = sources[fname]
            ox, oy = offsets[fname]
            tframes.append(
                dict(
                    filename=fname,
                    rotated=False,
                    trimmed=(w, h) != (sw, sh),
                    sourceSize=dict(w=sw, h=sh),
                    spriteSourceSize=dict(x=ox, y=oy, w=w, h=h),
                    frame=dict(x=px, y=py, w=w, h=h),
                )
            )
        # High-quality WebP: a fraction of the PNG's size, which keeps the
        # self-contained web page well under its size limit.
        image = f"{name}-{i}.webp"
        sheet.save(os.path.join(OUT, image), quality=92, alpha_quality=100, method=6)
        textures.append(dict(image=image, format="RGBA8888", size=dict(w=pw, h=ph), scale=1, frames=tframes))
    atlas = dict(textures=textures, meta=dict(app="tools/build_assets.py"))
    with open(os.path.join(OUT, f"{name}.json"), "w") as f:
        json.dump(atlas, f, separators=(",", ":"))
    return atlas


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)
    character = cut_character()
    props, rects = cut_props()
    world = {**cut_palms(), **props}
    gen = os.path.join(ROOT, "src", "data", "generated")
    os.makedirs(gen, exist_ok=True)
    with open(os.path.join(gen, "image06-rects.json"), "w") as f:
        json.dump(rects, f, indent=1)
    rocks, rock_groups = cut_rocks()
    world.update(rocks)
    with open(os.path.join(gen, "rocks.json"), "w") as f:
        json.dump(rock_groups, f, indent=1)
    hud, hud_layout = cut_hud()
    with open(os.path.join(gen, "hud-layout.json"), "w") as f:
        json.dump(hud_layout, f, indent=1)
    pack({**character, **split_legs(character)}, "character")
    pack(world, "world")
    pack(hud, "hud")
    fishing, fishing_layout = cut_fishing()
    with open(os.path.join(gen, "fishing-layout.json"), "w") as f:
        json.dump(fishing_layout, f, indent=1)
    pack({**fishing, **cut_fish()}, "fishing")
    bag, bag_layout = cut_bag()
    with open(os.path.join(gen, "bag-layout.json"), "w") as f:
        json.dump(bag_layout, f, indent=1)
    pack(bag, "bag")
    paint_textures.main(os.path.join(OUT, "textures"), REF)
    for group, frames in (("character", character), ("world", world), ("hud", hud), ("fishing", fishing), ("bag", bag)):
        print(group)
        for k, v in frames.items():
            print(f"  {k:18s} {v.width}x{v.height}")


if __name__ == "__main__":
    main()
