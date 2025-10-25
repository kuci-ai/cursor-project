#!/usr/bin/env python3
"""
Thermal CSV End-to-End Processor
--------------------------------
- Loads FLUKE/FLIR-like CSV (with non-numeric headers, rows like: 1,27.4,27.3,...)
- Cleans, shapes (480x640 or 240x320), imputes
- Produces basic stats & visualizations
- Computes gradient map
- Detects hotspots via gradient-first, hottest-first ranking
- Exports images and hotspot_stats.csv

Usage:
    python thermal_pipeline.py /path/to/input.csv --outdir /path/to/out \
        [--shape-override 480 640] [--gaussian-sigma 1.0] [--grad-pctl 97] \
        [--region-min-area 50] [--ring-width 5] [--clip-lo 2] [--clip-hi 98]

Notes:
- Uses only matplotlib for plotting (no seaborn). Each chart is its own figure.
- Optional SciPy (for morphology & gaussian). Falls back to NumPy-only approximations.
"""

import os
import io
import csv
import math
import argparse
from typing import List, Tuple
import numpy as np
import matplotlib.pyplot as plt
import pandas as pd

# Optional SciPy for better image morphology & gaussian filtering
try:
    from scipy import ndimage as ndi
    SCIPY_AVAILABLE = True
except Exception:
    SCIPY_AVAILABLE = False


# ---------- Utilities ----------

def try_read_lines_with_encoding(path: str, encodings: List[str]) -> Tuple[str, List[str]]:
    """Return (encoding, lines) for the first encoding that parses consistently."""
    for enc in encodings:
        try:
            with open(path, "r", encoding=enc, errors="strict") as f:
                lines = f.read().splitlines()
            if len(lines) >= 3:
                return enc, lines
        except Exception:
            continue
    # Fallback: read with utf-8 ignoring errors
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.read().splitlines()
    return "utf-8 (ignore errors)", lines


def is_numeric_row(tokens: List[str]) -> bool:
    """First token int, second token float -> numeric row start."""
    if len(tokens) < 2:
        return False
    try:
        int(tokens[0])
        float(tokens[1])
        return True
    except Exception:
        return False


def safe_float(tok: str) -> float:
    try:
        return float(tok)
    except Exception:
        return np.nan


def gaussian_smooth(arr: np.ndarray, sigma: float) -> np.ndarray:
    if SCIPY_AVAILABLE:
        return ndi.gaussian_filter(arr, sigma=sigma)
    # Fallback separable Gaussian (simple 1D kernel)
    radius = max(1, int(math.ceil(3*sigma)))
    x = np.arange(-radius, radius+1)
    kernel = np.exp(-(x**2)/(2*sigma*sigma))
    kernel = kernel / kernel.sum()
    tmp = np.apply_along_axis(lambda m: np.convolve(m, kernel, mode="same"), axis=1, arr=arr)
    out = np.apply_along_axis(lambda m: np.convolve(m, kernel, mode="same"), axis=0, arr=tmp)
    return out


def maximum_filter(arr: np.ndarray, size: int) -> np.ndarray:
    # Naive 2D max filter (edge-padded) for fallback when SciPy absent
    H, W = arr.shape
    k = size
    pad = k // 2
    padded = np.pad(arr, pad, mode='edge')
    out = np.empty_like(arr)
    for r in range(H):
        for c in range(W):
            window = padded[r:r+k, c:c+k]
            out[r, c] = window.max()
    return out


def minimum_filter(arr: np.ndarray, size: int) -> np.ndarray:
    H, W = arr.shape
    k = size
    pad = k // 2
    padded = np.pad(arr, pad, mode='edge')
    out = np.empty_like(arr)
    for r in range(H):
        for c in range(W):
            window = padded[r:r+k, c:c+k]
            out[r, c] = window.min()
    return out


def binary_morphology(mask: np.ndarray) -> np.ndarray:
    """Closing (disk radius 2), then dilation (radius 1), then fill holes."""
    if SCIPY_AVAILABLE:
        def disk(r):
            y, x = np.ogrid[-r:r+1, -r:r+1]
            return (x*x + y*y) <= r*r
        se_close = disk(2)
        se_dil   = disk(1)
        closed   = ndi.binary_closing(mask, structure=se_close)
        dilated  = ndi.binary_dilation(closed, structure=se_dil)
        filled   = ndi.binary_fill_holes(dilated)
        return filled.astype(bool)
    else:
        # Fallback: approximate with min/max filters
        eroded  = minimum_filter(mask.astype(int), size=3) > 0
        dilated = maximum_filter(eroded.astype(int), size=3) > 0
        dilated = maximum_filter(dilated.astype(int), size=3) > 0  # extra dilation
        return dilated.astype(bool)


def label_components(mask: np.ndarray):
    if SCIPY_AVAILABLE:
        labeled, nlab = ndi.label(mask)
        return labeled, nlab
    else:
        # Simple BFS (4-connected) fallback
        labeled = np.zeros(mask.shape, dtype=int)
        current = 0
        h, w = mask.shape
        for r in range(h):
            for c in range(w):
                if mask[r, c] and labeled[r, c] == 0:
                    current += 1
                    stack = [(r, c)]
                    labeled[r, c] = current
                    while stack:
                        rr, cc = stack.pop()
                        for dr, dc in [(1,0),(-1,0),(0,1),(0,-1)]:
                            nr, nc = rr+dr, cc+dc
                            if 0 <= nr < h and 0 <= nc < w and mask[nr, nc] and labeled[nr, nc] == 0:
                                labeled[nr, nc] = current
                                stack.append((nr, nc))
        return labeled, current


def remove_small_components(labeled: np.ndarray, min_area: int) -> np.ndarray:
    mask = labeled > 0
    if not np.any(mask):
        return mask
    labels = np.unique(labeled[mask])
    keep = np.zeros_like(labeled, dtype=bool)
    for lab in labels:
        if np.sum(labeled == lab) >= min_area:
            keep |= (labeled == lab)
    return keep


def dilate_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    if SCIPY_AVAILABLE:
        y, x = np.ogrid[-radius:radius+1, -radius:radius+1]
        se = (x*x + y*y) <= radius*radius
        return ndi.binary_dilation(mask, structure=se)
    else:
        out = mask.copy()
        for _ in range(radius):
            out = maximum_filter(out.astype(int), size=3) > 0
        return out


def ensure_outdir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def save_fig(outdir: str, fname: str) -> str:
    path = os.path.join(outdir, fname)
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    return path


# ---------- Core Pipeline ----------

def load_and_clean_csv(input_path: str,
                       standard_shapes=((480,640), (240,320)),
                       shape_override=None):
    enc, lines = try_read_lines_with_encoding(input_path, ["utf-8", "utf-16", "utf-16-le", "utf-16-be"])

    # find first numeric row
    start_idx = None
    for i, line in enumerate(lines):
        tokens = [t.strip() for t in line.split(",")]
        if is_numeric_row(tokens):
            start_idx = i
            break
    if start_idx is None:
        raise RuntimeError("No numeric data rows found in the CSV.")

    rows = []
    for line in lines[start_idx:]:
        toks = [t.strip() for t in line.split(",")]
        if not is_numeric_row(toks):
            continue
        vals = [safe_float(t) for t in toks[1:]]  # drop index
        rows.append(vals)

    num_rows_observed = len(rows)
    if num_rows_observed == 0:
        raise RuntimeError("No numeric rows parsed.")
    median_cols = int(np.median([len(r) for r in rows]))

    # target shape
    if shape_override is not None:
        TARGET_SHAPE = tuple(shape_override)
    else:
        best = None
        best_score = None
        for tr, tc in standard_shapes:
            score = abs(num_rows_observed - tr) + abs(median_cols - tc)
            if best is None or score < best_score:
                best = (tr, tc); best_score = score
        TARGET_SHAPE = best

    target_rows, target_cols = TARGET_SHAPE

    # global median
    all_vals = [v for r in rows for v in r if not np.isnan(v)]
    global_median = float(np.median(all_vals)) if all_vals else 0.0

    processed_rows = []
    for r in rows[:target_rows]:
        if len(r) > target_cols:
            rr = r[:target_cols]
        else:
            rr = r + [np.nan] * (target_cols - len(r))
        row_vals = [v for v in rr if not np.isnan(v)]
        row_median = float(np.median(row_vals)) if row_vals else global_median
        rr = [row_median if np.isnan(v) else v for v in rr]
        processed_rows.append(rr)

    while len(processed_rows) < target_rows:
        processed_rows.append([global_median] * target_cols)

    T = np.array(processed_rows, dtype=float)

    # fill any remaining NaNs by row medians then global
    if np.isnan(T).any():
        for i in range(T.shape[0]):
            row = T[i]
            mask = np.isnan(row)
            if np.any(mask):
                vals = row[~mask]
                med = float(np.median(vals)) if vals.size > 0 else global_median
                row[mask] = med
                T[i] = row

    return enc, T, TARGET_SHAPE


def basic_stats(T: np.ndarray, clip_lo=2, clip_hi=98):
    pcts = np.percentile(T, [1,5,50,95,99])
    p_lo, p_hi = np.percentile(T, [clip_lo, clip_hi])
    stats_text = (
        f"Array shape: {T.shape[0]} x {T.shape[1]}\n"
        f"min(T)={np.min(T):.3f} °C, max(T)={np.max(T):.3f} °C\n"
        f"mean(T)={np.mean(T):.3f} °C, std(T)={np.std(T):.3f} °C\n"
        f"Percentiles: p1={pcts[0]:.3f}, p5={pcts[1]:.3f}, p50={pcts[2]:.3f}, p95={pcts[3]:.3f}, p99={pcts[4]:.3f}\n"
        f"Suggested clipping range: [{p_lo:.3f}, {p_hi:.3f}] °C\n"
    )
    return stats_text, p_lo, p_hi


def gradient_map(T: np.ndarray):
    gy, gx = np.gradient(T)
    G = np.sqrt(gx**2 + gy**2)
    g_stats = (
        f"Gradient stats: min(G)={np.min(G):.6f} °C/pixel, "
        f"max(G)={np.max(G):.6f} °C/pixel, "
        f"mean(G)={np.mean(G):.6f} ± {np.std(G):.6f} °C/pixel, "
        f"p95(G)={np.percentile(G,95):.6f} °C/pixel"
    )
    return G, g_stats


def hotspot_detection(T: np.ndarray, gaussian_sigma=1.0, grad_pctl=97, region_min_area=50, ring_width=5):
    T_s = gaussian_smooth(T, gaussian_sigma)
    gys, gxs = np.gradient(T_s)
    G_s = np.sqrt(gxs**2 + gys**2)
    tau = np.percentile(G_s, grad_pctl)
    M0 = G_s >= tau

    M = binary_morphology(M0)
    labeled, _ = label_components(M)
    M_clean = remove_small_components(labeled, region_min_area)
    labeled_clean, nlab = label_components(M_clean)

    H, W = T.shape
    regions = []
    for lab in range(1, nlab+1):
        coords = np.argwhere(labeled_clean == lab)
        if coords.size == 0:
            continue
        area = coords.shape[0]
        rr, cc = coords[:,0], coords[:,1]
        vals = T[rr, cc]
        Tmax = float(np.max(vals))
        max_idx = np.argmax(vals)
        rmax, cmax = int(rr[max_idx]), int(cc[max_idx])
        Tmean = float(np.mean(vals))

        mask_R = (labeled_clean == lab)
        dilated_R = dilate_mask(mask_R, ring_width)
        ring = np.logical_and(dilated_R, ~mask_R)
        ring_vals = T[ring]
        if ring_vals.size == 0 or np.all(np.isnan(ring_vals)):
            outside_vals = T[~mask_R]
            Tbg = float(np.median(outside_vals)) if outside_vals.size > 0 else float(np.median(T))
        else:
            Tbg = float(np.median(ring_vals))
        deltaT = Tmax - Tbg
        regions.append({
            "ID": lab,
            "area_px": int(area),
            "Tmax_C": Tmax,
            "Tmean_C": Tmean,
            "Tbg_C": Tbg,
            "DeltaT_C": float(deltaT),
            "row": rmax,
            "col": cmax,
        })

    regions_sorted = sorted(regions, key=lambda d: (-d["Tmax_C"], -d["DeltaT_C"]))
    return G_s, tau, M_clean, labeled_clean, regions_sorted


def plot_and_save_all(T, outdir, p2, p98, G, Gs, tau, M_clean, labeled_clean, regions_sorted):
    # 1) Histogram
    plt.figure()
    plt.hist(T.ravel(), bins=64)
    plt.xlabel("Temperature (°C)"); plt.ylabel("Frequency"); plt.title("Histogram of Temperature Values")
    save_fig(outdir, "histogram.png")

    # 2) Thermal (jet)
    plt.figure()
    im = plt.imshow(T, cmap="jet", origin="upper", vmin=p2, vmax=p98)
    plt.colorbar(im, label="°C"); plt.title("Thermal Image (jet)")
    save_fig(outdir, "thermal_jet.png")

    # 3) Thermal (inferno)
    plt.figure()
    im = plt.imshow(T, cmap="inferno", origin="upper", vmin=p2, vmax=p98)
    plt.colorbar(im, label="°C"); plt.title("Thermal Image (inferno)")
    save_fig(outdir, "thermal_inferno.png")

    # 4) Gradient map
    plt.figure()
    im = plt.imshow(G, cmap="inferno", origin="upper")
    plt.colorbar(im, label="°C/pixel"); plt.title("Thermal Gradient Magnitude Map")
    save_fig(outdir, "gradient_map.png")

    # 5) Gradient threshold overlay
    plt.figure()
    im = plt.imshow(Gs, cmap="inferno", origin="upper")
    plt.colorbar(im, label="°C/pixel")
    plt.contour(Gs, levels=[tau], linewidths=1.5)
    plt.title(f"Gradient Map with Threshold Overlay (τ={tau:.4f})")
    save_fig(outdir, "gradient_threshold_overlay.png")

    # 6) Binary mask
    plt.figure()
    plt.imshow(M_clean, origin="upper")
    plt.title("Candidate Hot Regions (Binary Mask)")
    save_fig(outdir, "binary_mask.png")

    # 7) Top hotspot overlay
    plt.figure()
    im = plt.imshow(T, cmap="inferno", origin="upper", vmin=p2, vmax=p98)
    plt.colorbar(im, label="°C"); plt.title("Top Hotspot Overlay")
    if len(regions_sorted) > 0:
        top = regions_sorted[0]
        top_id = top["ID"]
        top_mask = (labeled_clean == top_id).astype(float)
        plt.contour(top_mask, levels=[0.5], colors=["red"], linewidths=2.0)
        plt.plot(top["col"], top["row"], marker="o", markersize=6, markerfacecolor="none", markeredgecolor="white", linewidth=0)
        label = f"Tmax={top['Tmax_C']:.2f}°C, ΔT={top['DeltaT_C']:.2f}°C"
        plt.text(top["col"]+5, top["row"]+5, label, fontsize=9, color="white",
                 bbox=dict(facecolor="black", alpha=0.4, pad=2))
    save_fig(outdir, "thermal_hotspot_overlay.png")

    # 8) Top 3 overlay on mask
    plt.figure()
    plt.imshow(M_clean, origin="upper", alpha=0.3)
    plt.title("Top 3 Hotspots Overlay (hottest→coolest)")
    colors = ["red", "green", "blue"]
    for idx, reg in enumerate(regions_sorted[:3]):
        mask_i = (labeled_clean == reg["ID"]).astype(float)
        plt.contour(mask_i, levels=[0.5], colors=[colors[idx]], linewidths=2.0)
    save_fig(outdir, "top3_hotspots_mask.png")

    # 9) Top 3 over candidate mask
    plt.figure()
    plt.imshow(M_clean, origin="upper", alpha=0.4)
    plt.title("Top 3 Overlaid on Candidate Mask")
    for idx, reg in enumerate(regions_sorted[:3]):
        mask_i = (labeled_clean == reg["ID"]).astype(float)
        plt.contour(mask_i, levels=[0.5], colors=[["red","green","blue"][idx]], linewidths=2.0)
    save_fig(outdir, "overlay_candidate_hotspots.png")


def save_hotspot_csv(outdir: str, regions_sorted: list):
    df = pd.DataFrame(regions_sorted, columns=["ID","area_px","Tmax_C","Tmean_C","Tbg_C","DeltaT_C","row","col"])
    csv_path = os.path.join(outdir, "hotspot_stats.csv")
    df.to_csv(csv_path, index=False)
    return csv_path


# ---------- Main ----------

def main():
    parser = argparse.ArgumentParser(description="Process thermal CSV and detect hotspots.")
    parser.add_argument("input_csv", help="Path to input CSV exported from FLUKE/FLIR")
    parser.add_argument("--outdir", default=".", help="Output directory (default: current dir)")
    parser.add_argument("--shape-override", nargs=2, type=int, metavar=("ROWS","COLS"),
                        help="Override target shape, e.g., --shape-override 480 640")
    parser.add_argument("--gaussian-sigma", type=float, default=1.0, help="Gaussian smoothing sigma (default 1.0)")
    parser.add_argument("--grad-pctl", type=float, default=97, help="Gradient percentile threshold (default 97)")
    parser.add_argument("--region-min-area", type=int, default=50, help="Minimum region area in pixels (default 50)")
    parser.add_argument("--ring-width", type=int, default=5, help="Annulus ring width for local background (default 5)")
    parser.add_argument("--clip-lo", type=float, default=2, help="Histogram lower clip percentile (default 2)")
    parser.add_argument("--clip-hi", type=float, default=98, help="Histogram upper clip percentile (default 98)")
    args = parser.parse_args()

    ensure_outdir(args.outdir)

    # 1) Load & clean
    enc, T, shape = load_and_clean_csv(
        args.input_csv,
        standard_shapes=((480,640), (240,320)),
        shape_override=tuple(args.shape_override) if args.shape_override else None
    )

    # 2) Basic stats
    stats_text, p2, p98 = basic_stats(T, clip_lo=args.clip_lo, clip_hi=args.clip_hi)
    print(f"Encoding used: {enc}")
    print(stats_text)

    # 3) Visualizations happen later in plot_and_save_all()

    # 4) Gradient map
    G, g_stats = gradient_map(T)
    print(g_stats)

    # 5) Hotspots
    Gs, tau, M_clean, labeled_clean, regions_sorted = hotspot_detection(
        T,
        gaussian_sigma=args.gaussian_sigma,
        grad_pctl=args.grad_pctl,
        region_min_area=args.region_min_area,
        ring_width=args.ring_width
    )

    # 6) Visual outputs
    plot_and_save_all(T, args.outdir, p2, p98, G, Gs, tau, M_clean, labeled_clean, regions_sorted)

    # 7) CSV export
    csv_path = save_hotspot_csv(args.outdir, regions_sorted)

    # 8) Final summary
    print("\nTop 3 (hottest→coolest):")
    for i, reg in enumerate(regions_sorted[:3], start=1):
        print(f"{i}. ID={reg['ID']}, area={reg['area_px']} px, Tmax={reg['Tmax_C']:.3f}°C, "
              f"Tmean={reg['Tmean_C']:.3f}°C, Tbg={reg['Tbg_C']:.3f}°C, ΔT={reg['DeltaT_C']:.3f}°C, "
              f"row={reg['row']}, col={reg['col']}")

    note = (
        "\nNote: Gradient-based preselection (using the chosen percentile of the smoothed gradient magnitude) "
        "highlights sharp thermal transitions first. We then rank regions by absolute peak temperature (hottest-first) "
        "with ΔT relative to a local ring background as a tiebreaker. This reduces false positives from broad warm areas "
        "and improves hotspot localization consistency."
    )
    print(note)

    print("\nSaved files in:", os.path.abspath(args.outdir))
    for name in [
        "histogram.png",
        "thermal_jet.png",
        "thermal_inferno.png",
        "gradient_map.png",
        "gradient_threshold_overlay.png",
        "binary_mask.png",
        "thermal_hotspot_overlay.png",
        "top3_hotspots_mask.png",
        "overlay_candidate_hotspots.png",
        "hotspot_stats.csv",
    ]:
        print("-", name)


if __name__ == "__main__":
    main()
