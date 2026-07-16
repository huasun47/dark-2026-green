/**
 * 保亮度色相旋转的核心色彩数学。
 *
 * 为什么不能直接把蓝换成绿：WCAG 相对亮度公式里绿通道权重 0.7152，
 * 蓝通道只有 0.0722 —— 相差近 10 倍。只旋转色相而不动 lightness，
 * 同一个"数值上的深浅"到了绿区会显著变亮，UI 层级就塌了。
 * 所以这里反过来做：锁定原色的相对亮度，反解出绿区该用的 lightness。
 *
 * saturation 全程原样保留 —— Dark 2026 用同一色相的多个饱和度档位承载 UI 层级，
 * 动了饱和度就等于毁掉层级本身。
 */

/** 8bit 整数通道，0-255 */
export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** h: 0-360，s/l: 0-1 */
export interface Hsl {
	h: number;
	s: number;
	l: number;
}

export interface ParsedColor {
	rgb: Rgb;
	/** 原始 alpha 的十六进制文本，已归一到两位；无 alpha 时为 null。纯透传，不参与任何计算 */
	alphaHex: string | null;
}

/** 旋转判定与目标值 —— 全部集中在这里，方便调档 */
export const TARGET_HUE = 145;
export const BLUE_HUE_MIN = 190;
export const BLUE_HUE_MAX = 220;
/** 低于此饱和度视为中性灰，不碰 —— 避免误伤带蓝味的灰 */
export const MIN_SATURATION = 0.15;
/** 相对亮度允许的最大偏差 */
export const LUM_TOLERANCE = 0.002;

const HEX_RE = /^#([0-9a-f]+)$/i;

/**
 * 解析 #RGB / #RGBA / #RRGGBB / #RRGGBBAA 四种形式，大小写不敏感。
 * 非法或非十六进制色值返回 null（调用方据此原样跳过）。
 */
export function parseHex(input: string): ParsedColor | null {
	if (typeof input !== "string") return null;
	const m = HEX_RE.exec(input.trim());
	if (!m) return null;
	const h = m[1];

	let rr: string;
	let gg: string;
	let bb: string;
	let aa: string | null = null;

	switch (h.length) {
		case 3: // #RGB
			rr = h[0] + h[0];
			gg = h[1] + h[1];
			bb = h[2] + h[2];
			break;
		case 4: // #RGBA -> 每个 nibble 按 CSS 规则复制成两位
			rr = h[0] + h[0];
			gg = h[1] + h[1];
			bb = h[2] + h[2];
			aa = h[3] + h[3];
			break;
		case 6: // #RRGGBB
			rr = h.slice(0, 2);
			gg = h.slice(2, 4);
			bb = h.slice(4, 6);
			break;
		case 8: // #RRGGBBAA
			rr = h.slice(0, 2);
			gg = h.slice(2, 4);
			bb = h.slice(4, 6);
			aa = h.slice(6, 8);
			break;
		default:
			return null; // 5/7 位不是合法 CSS 十六进制色
	}

	return {
		rgb: { r: parseInt(rr, 16), g: parseInt(gg, 16), b: parseInt(bb, 16) },
		alphaHex: aa === null ? null : aa.toUpperCase(),
	};
}

export function formatHex(rgb: Rgb, alphaHex: string | null): string {
	const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
	return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}${alphaHex ?? ""}`;
}

/** sRGB 单通道逆伽马。c 为 0-1 的归一化通道值 */
function linearize(c: number): number {
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 相对亮度。接受浮点通道（0-255），因此二分过程可以在未量化的连续域上跑。
 * alpha 不参与计算 —— 它只影响合成结果，不影响色值本身的亮度。
 */
export function relativeLuminanceFloat(r: number, g: number, b: number): number {
	return (
		0.2126 * linearize(r / 255) +
		0.7152 * linearize(g / 255) +
		0.0722 * linearize(b / 255)
	);
}

export function relativeLuminance({ r, g, b }: Rgb): number {
	return relativeLuminanceFloat(r, g, b);
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const d = max - min;
	const l = (max + min) / 2;

	if (d === 0) return { h: 0, s: 0, l }; // 纯灰：色相无定义，饱和度为 0

	const s = d / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === rn) h = 60 * (((gn - bn) / d) % 6);
	else if (max === gn) h = 60 * ((bn - rn) / d + 2);
	else h = 60 * ((rn - gn) / d + 4);
	if (h < 0) h += 360;

	return { h, s, l };
}

/** HSL -> RGB，返回未量化的浮点通道（0-255） */
function hslToRgbFloat({ h, s, l }: Hsl): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = ((((h % 360) + 360) % 360) / 60);
	const x = c * (1 - Math.abs((hp % 2) - 1));

	let r1: number;
	let g1: number;
	let b1: number;
	if (hp < 1) [r1, g1, b1] = [c, x, 0];
	else if (hp < 2) [r1, g1, b1] = [x, c, 0];
	else if (hp < 3) [r1, g1, b1] = [0, c, x];
	else if (hp < 4) [r1, g1, b1] = [0, x, c];
	else if (hp < 5) [r1, g1, b1] = [x, 0, c];
	else [r1, g1, b1] = [c, 0, x];

	const m = l - c / 2;
	return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

export function hslToRgb(hsl: Hsl): Rgb {
	const [r, g, b] = hslToRgbFloat(hsl);
	return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

/** 判定：落在蓝区且不是中性灰，才旋转 */
export function shouldRotate(hsl: Hsl): boolean {
	return hsl.h >= BLUE_HUE_MIN && hsl.h <= BLUE_HUE_MAX && hsl.s >= MIN_SATURATION;
}

export interface RotationResult {
	rgb: Rgb;
	/** 新色相对亮度 - 原色相对亮度，带符号 */
	lumDelta: number;
	/** 反解出的 lightness */
	l: number;
}

/**
 * 把颜色旋转到 targetHue，保留 saturation，并反解 lightness 使相对亮度与原色一致。
 *
 * 固定 H/S 时，三个通道各自随 L 单调递增（L=0 为黑、L=1 为白），量化只是把
 * 连续曲线切成台阶，不破坏单调性 —— 所以直接在"量化后亮度"上二分找目标的跨越点，
 * 收敛后 lo/hi 分别是目标亮度下方最亮、上方最暗的两个可达色，取更近的那个。
 * 这样得到的是 hue=145 / 同 sat 这条线上可表示色中的最优解，无需再做窗口扫描。
 */
export function rotateHuePreservingLuminance(rgb: Rgb, targetHue = TARGET_HUE): RotationResult {
	const target = relativeLuminance(rgb);
	const { s } = rgbToHsl(rgb);
	const lumAt = (l: number) => relativeLuminance(hslToRgb({ h: targetHue, s, l }));

	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		if (lumAt(mid) < target) lo = mid;
		else hi = mid;
	}

	// lo 侧严格低于目标、hi 侧不低于目标，二者是夹住目标的相邻可达色
	const cands: { l: number; rgb: Rgb }[] = [
		{ l: lo, rgb: hslToRgb({ h: targetHue, s, l: lo }) },
		{ l: hi, rgb: hslToRgb({ h: targetHue, s, l: hi }) },
	];
	let best = cands[0];
	let bestErr = Number.POSITIVE_INFINITY;
	for (const c of cands) {
		const err = Math.abs(relativeLuminance(c.rgb) - target);
		if (err < bestErr) {
			bestErr = err;
			best = c;
		}
	}

	return { rgb: best.rgb, lumDelta: relativeLuminance(best.rgb) - target, l: best.l };
}
