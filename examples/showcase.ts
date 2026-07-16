/**
 * Showcase file — exists only to be screenshotted for the README.
 *
 * It is real, working code (a condensed form of scripts/color.ts) rather than
 * filler, so the screenshot shows what the theme actually does to real source.
 */

import { relativeLuminance, rgbToHsl, hslToRgb } from "../scripts/color";
import type { Hsl, Rgb } from "../scripts/color";

/** Hue band treated as "the accent blue", inclusive on both ends. */
const BLUE_RANGE = { min: 190, max: 220 } as const;

/** Below this saturation a colour is a neutral grey — leave it alone. */
const MIN_SATURATION = 0.15;

const TARGET_HUE = 145;
const TOLERANCE = 0.002;

export interface Rotation {
	readonly from: string;
	readonly to: string;
	readonly lumDelta: number;
}

/**
 * Green carries 0.7152 of perceived brightness, blue only 0.0722 — a naive hue
 * swap makes the whole UI visibly brighter. So instead of spinning the wheel and
 * hoping, we hold luminance fixed and solve for the lightness that preserves it.
 */
export function rotate(colour: Rgb, targetHue = TARGET_HUE): Rotation | null {
	const hsl: Hsl = rgbToHsl(colour);
	const isAccent =
		hsl.h >= BLUE_RANGE.min && hsl.h <= BLUE_RANGE.max && hsl.s >= MIN_SATURATION;

	if (!isAccent) {
		return null; // neutral grey, error red, terminal ansi — not ours to touch
	}

	const target = relativeLuminance(colour);
	const luminanceAt = (l: number) =>
		relativeLuminance(hslToRgb({ h: targetHue, s: hsl.s, l }));

	// Luminance rises monotonically with lightness, so binary search converges.
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		if (luminanceAt(mid) < target) lo = mid;
		else hi = mid;
	}

	const solved = hslToRgb({ h: targetHue, s: hsl.s, l: hi });
	const lumDelta = relativeLuminance(solved) - target;

	if (Math.abs(lumDelta) > TOLERANCE) {
		console.warn(`8-bit quantisation ceiling hit: Δ${lumDelta.toFixed(5)}`);
	}

	return { from: format(colour), to: format(solved), lumDelta };
}

const format = ({ r, g, b }: Rgb): string =>
	`#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

// The anchor case: same saturation, same brightness, different hue.
//   #377B9F  hue 201  sat 49%  luminance 0.1748
//   #2D8351  hue 145  sat 49%  luminance 0.1738
const anchor = rotate({ r: 0x37, g: 0x7b, b: 0x9f });
console.log(anchor?.to === "#2D8351" ? "✓ anchor holds" : "✗ formula broken");
