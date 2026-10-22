"""Helpers for cutting outlined sprites out of the reference sheets.

Every asset in the reference art has a thick dark-brown outline (#211912).
On the flat brown sheets we find that outline, fill everything inside it and
keep the result as the sprite's alpha. The ground shadow and the background
sit outside the outline, so they fall away.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def load_rgb(path: str) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB"))


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def outline_mask(rgb: np.ndarray, dark: float = 62, close: int = 2) -> np.ndarray:
    """Pixels inside (and on) the dark outline of each drawn object."""
    m = luminance(rgb.astype(np.float32)) < dark
    if close:
        m = ndi.binary_closing(m, structure=np.ones((3, 3)), iterations=close)
    return ndi.binary_fill_holes(m)


def bg_distance_mask(rgb: np.ndarray, bg: tuple[int, int, int], tol: float) -> np.ndarray:
    """Pixels that differ from a flat background colour by more than tol."""
    d = np.sqrt(((rgb.astype(np.float32) - np.array(bg, np.float32)) ** 2).sum(-1))
    return d > tol


def components(mask: np.ndarray, min_area: int) -> list[tuple[slice, slice, np.ndarray]]:
    """Connected components larger than min_area as (ys, xs, sub-mask)."""
    lab, n = ndi.label(mask)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None:
            continue
        sub = lab[sl] == i
        if sub.sum() >= min_area:
            out.append((sl[0], sl[1], sub))
    return out


def soften(alpha: np.ndarray, grow: int = 1) -> np.ndarray:
    """Grow the hard mask by a pixel and feather it so edges are not jagged."""
    a = alpha.astype(np.float32)
    if grow:
        grown = ndi.binary_dilation(alpha, iterations=grow).astype(np.float32)
        a = np.maximum(a, grown * 0.55)
    return np.clip(ndi.gaussian_filter(a, 0.6) * 1.15, 0, 1)


def cutout(rgb: np.ndarray, ys: slice, xs: slice, mask: np.ndarray, pad: int = 2) -> Image.Image:
    """RGBA image of rgb[ys, xs] using mask as alpha, padded on every side."""
    h, w = mask.shape
    y0, x0 = max(ys.start - pad, 0), max(xs.start - pad, 0)
    y1, x1 = min(ys.stop + pad, rgb.shape[0]), min(xs.stop + pad, rgb.shape[1])
    full = np.zeros(rgb.shape[:2], bool)
    full[ys, xs] = mask
    alpha = soften(full[y0:y1, x0:x1])
    rgba = np.dstack([rgb[y0:y1, x0:x1], (alpha * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def trim(img: Image.Image) -> Image.Image:
    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return img.crop(bbox) if bbox else img


def polygon_mask(shape: tuple[int, int], points: list[tuple[float, float]], offset=(0, 0)) -> np.ndarray:
    """Boolean mask of a polygon given in source-image coordinates."""
    from PIL import ImageDraw

    img = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(img).polygon([(x - offset[0], y - offset[1]) for x, y in points], fill=255)
    return np.array(img) > 0


def greyness(rgb: np.ndarray) -> np.ndarray:
    """0 for neutral greys, rising with colour saturation."""
    f = rgb.astype(np.float32)
    return (f.max(-1) - f.min(-1)) / (f.max(-1) + 1)


def segment_prop(
    rgb: np.ndarray,
    box: tuple[int, int, int, int],
    poly: list[tuple[float, float]] | None = None,
    exclude: list[list[tuple[float, float]]] = (),
    mode: str = "outline",
    dark: float = 62,
    grey: float = 0.45,
    keep: str = "centre",
) -> tuple[slice, slice, np.ndarray]:
    """Cut one prop that sits on painted terrain.

    mode "outline": fill inside the dark outline (wooden props, structures).
    mode "grey":    low-saturation pixels plus outline (rocks).
    mode "poly":    the polygon itself is the mask (soft objects with no
                    closed outline, like sails or flames).
    The optional polygon clips away neighbours whose outlines touch.
    """
    x0, y0, x1, y1 = box
    sub = rgb[y0:y1, x0:x1]
    h, w = sub.shape[:2]
    clip = polygon_mask((h, w), poly, (x0, y0)) if poly else np.ones((h, w), bool)
    for ex in exclude:
        clip &= ~polygon_mask((h, w), ex, (x0, y0))
    if mode == "poly":
        m = clip
    else:
        dk = luminance(sub.astype(np.float32)) < dark
        if mode == "grey":
            warm = sub[..., 0].astype(np.int16) >= sub[..., 1].astype(np.int16) - 3  # not sea teal
            dk |= (greyness(sub) < grey) & (luminance(sub.astype(np.float32)) < 150) & warm
        dk &= clip
        dk = ndi.binary_closing(dk, structure=np.ones((3, 3)), iterations=2)
        m = ndi.binary_fill_holes(dk) & clip
        m = ndi.binary_opening(m, structure=np.ones((3, 3)))
        lab, n = ndi.label(m)
        if keep == "centre":
            ids = set(np.unique(lab[h // 3 : 2 * h // 3, w // 3 : 2 * w // 3])) - {0}
        else:
            sizes = ndi.sum(m, lab, range(1, n + 1))
            ids = {i + 1 for i, s in enumerate(sizes) if s > float(keep)}
        m = np.isin(lab, list(ids))
    return slice(y0, y1), slice(x0, x1), m


def chroma_mask(rgb: np.ndarray, bg: tuple[int, int, int], tol: float = 0.035, dark: float = 62) -> np.ndarray:
    """Objects on a flat sheet background: dark outline plus anything whose
    hue differs from the background. Ground shadows are just darker
    background, so they share its chromaticity and drop out."""
    f = rgb.astype(np.float32) + 1
    c = f / f.sum(-1, keepdims=True)
    b = np.array(bg, np.float32) + 1
    b = b / b.sum()
    far = np.sqrt(((c - b) ** 2).sum(-1)) > tol
    m = far | (luminance(f) < dark)
    m = ndi.binary_opening(m, structure=np.ones((2, 2)))
    m = ndi.binary_closing(m, structure=np.ones((3, 3)), iterations=2)
    return ndi.binary_fill_holes(m)
