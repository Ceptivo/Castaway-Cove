"""Cut every sprite the game uses out of the reference images and pack atlases.

    python3 tools/build_assets.py

Reads art/reference/*.png, writes public/assets/. Re-run whenever a reference
image changes or a new sprite is added below. Requires numpy, scipy, Pillow.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(__file__))
import paint_textures  # noqa: E402
from sprite_cut import (  # noqa: E402
    chroma_mask,
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
    "rock_cluster_a": dict(box=(432, 182, 568, 268), mode="grey"),
    "rock_cluster_b": dict(box=(198, 245, 310, 325), mode="grey"),
    "rock_small": dict(box=(160, 405, 215, 455), mode="grey"),
    "rock_big": dict(box=(1245, 700, 1350, 805), mode="grey"),
    "rock_beach": dict(box=(1192, 828, 1282, 902), mode="grey"),
    "pebble_a": dict(box=(544, 491, 572, 513), mode="grey"),
    "pebble_b": dict(box=(464, 533, 508, 565), mode="grey"),
    "pebble_c": dict(box=(853, 860, 906, 902), mode="grey"),
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


def pack(frames: dict[str, Image.Image], name: str, max_size: int = 2048, pad: int = 2) -> dict:
    """Shelf-pack frames into one or more pages; write a Phaser multiatlas."""
    items = sorted(frames.items(), key=lambda kv: -kv[1].height)
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
            tframes.append(
                dict(
                    filename=fname,
                    rotated=False,
                    trimmed=False,
                    sourceSize=dict(w=w, h=h),
                    spriteSourceSize=dict(x=0, y=0, w=w, h=h),
                    frame=dict(x=px, y=py, w=w, h=h),
                )
            )
        image = f"{name}-{i}.png"
        sheet.save(os.path.join(OUT, image), optimize=True)
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
    pack(character, "character")
    pack(world, "world")
    paint_textures.main(os.path.join(OUT, "textures"), REF)
    for group, frames in (("character", character), ("world", world)):
        print(group)
        for k, v in frames.items():
            print(f"  {k:18s} {v.width}x{v.height}")


if __name__ == "__main__":
    main()
