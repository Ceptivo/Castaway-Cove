"""Paint the seamless ground textures the island terrain is built from.

Colours come from the palette in the game brief (sampled from images 06/07).
Every texture tiles: the noise is shaped in frequency space, which wraps.
The deep-water tile is cut from image 06 itself and made seamless.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SIZE = 512


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], np.float32)


def fbm(rng: np.random.Generator, size: int, beta: float, lo: float = 0.0) -> np.ndarray:
    """Tileable 1/f^beta noise normalised to 0..1. lo cuts the lowest frequencies."""
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx**2 + fy**2)
    r[0, 0] = 1
    amp = 1 / r**beta
    amp[r < lo] = 0
    amp[0, 0] = 0
    phase = rng.uniform(0, 2 * np.pi, (size, size))
    n = np.real(np.fft.ifft2(amp * np.exp(1j * phase)))
    return (n - n.min()) / (n.max() - n.min())


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def wrap_blur(a: np.ndarray, s: float) -> np.ndarray:
    return ndi.gaussian_filter(a, s, mode="wrap")


def blend(base: np.ndarray, colour: str | np.ndarray, mask: np.ndarray) -> np.ndarray:
    c = hexrgb(colour) if isinstance(colour, str) else colour
    return base * (1 - mask[..., None]) + c * mask[..., None]


def speckles(rng, size, count, rmin, rmax, squash=0.7) -> np.ndarray:
    """Soft elliptical dots, wrapped at the edges."""
    m = np.zeros((size, size), np.float32)
    yy, xx = np.mgrid[-8:9, -8:9]
    for _ in range(count):
        cx, cy = rng.integers(0, size, 2)
        r = rng.uniform(rmin, rmax)
        d = (xx / r) ** 2 + (yy / (r * squash)) ** 2
        dot = np.clip(1.4 - d, 0, 1)
        ys = (cy + yy) % size
        xs = (cx + xx) % size
        m[ys, xs] = np.maximum(m[ys, xs], dot)
    return m


def grain(rng, size, amount) -> np.ndarray:
    return (rng.random((size, size)).astype(np.float32) - 0.5) * amount


def paint_sand(rng, base="#AD8549", dark="#977140", light="#BE9A5D", speck="#6A4E2E", seed_speck=900):
    n1 = wrap_blur(fbm(rng, SIZE, 2.0, 0.004), 2)
    n2 = wrap_blur(fbm(rng, SIZE, 1.8, 0.008), 1.5)
    img = np.tile(hexrgb(base), (SIZE, SIZE, 1))
    img = blend(img, light, smoothstep(0.55, 0.62, n1) * 0.55)
    blot = smoothstep(0.58, 0.63, n2) * 0.55
    img = blend(img, dark, blot)
    rim = np.clip(smoothstep(0.56, 0.6, n2) - smoothstep(0.6, 0.66, n2), 0, 1)
    img = blend(img, dark, rim * 0.35)
    img = blend(img, speck, speckles(rng, SIZE, seed_speck, 0.8, 2.2) * 0.75)
    img = blend(img, "#D2B47A", speckles(rng, SIZE, seed_speck // 3, 0.6, 1.4) * 0.5)
    img += grain(rng, SIZE, 14)[..., None]
    return img


def paint_grass(rng):
    n1 = wrap_blur(fbm(rng, SIZE, 2.0, 0.004), 2)
    n2 = wrap_blur(fbm(rng, SIZE, 1.6, 0.01), 1.2)
    img = np.tile(hexrgb("#585322"), (SIZE, SIZE, 1))
    img = blend(img, "#3F3C18", smoothstep(0.5, 0.62, n1) * 0.45)
    img = blend(img, "#6B6A2B", smoothstep(0.6, 0.66, n2) * 0.5)
    # short leaf strokes
    strokes = np.zeros((SIZE, SIZE), np.float32)
    for _ in range(2600):
        x, y = rng.integers(0, SIZE, 2)
        ang = rng.uniform(-1.1, 1.1) - np.pi / 2
        ln = rng.uniform(3, 8)
        for t in np.linspace(0, ln, int(ln * 2)):
            px = int(x + np.cos(ang) * t) % SIZE
            py = int(y + np.sin(ang) * t) % SIZE
            strokes[py, px] = 1
    strokes = wrap_blur(strokes, 0.6)
    img = blend(img, "#7D7A34", np.clip(strokes * 1.4, 0, 1) * 0.55)
    img = blend(img, "#2E2C12", speckles(rng, SIZE, 700, 0.8, 1.8) * 0.6)
    img += grain(rng, SIZE, 12)[..., None]
    return img



def seamless_patch(patch: np.ndarray) -> np.ndarray:
    """Cross-fade a square patch with its half-rolled copy so it tiles."""
    n = patch.shape[0]
    rolled = np.roll(np.roll(patch, n // 2, 0), n // 2, 1)
    t = np.abs(np.linspace(-1, 1, n))
    w1 = np.clip(1 - t, 0, 1) ** 0.8
    w = np.outer(w1, w1)
    w = np.clip(w * 2.2, 0, 1)[..., None]
    return patch * w + rolled * (1 - w)


def water_tile(ref_path: str) -> np.ndarray:
    src = np.array(Image.open(ref_path).convert("RGB")).astype(np.float32)
    patch = src[2:230, 1162:1390]
    tile = seamless_patch(patch)
    return np.array(Image.fromarray(np.clip(tile, 0, 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS)).astype(
        np.float32
    )


def save(img: np.ndarray, path: str) -> None:
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, optimize=True)


def main(out_dir: str, ref_dir: str) -> None:
    rng = np.random.default_rng(20261022)
    save(paint_sand(rng), f"{out_dir}/sand.png")
    save(paint_grass(rng), f"{out_dir}/grass.png")
    save(water_tile(f"{ref_dir}/06-island-concept.png"), f"{out_dir}/water.png")


if __name__ == "__main__":
    import sys

    main(sys.argv[1], sys.argv[2])
