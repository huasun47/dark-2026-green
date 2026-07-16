import { describe, expect, test } from "bun:test";
import {
	BLUE_HUE_MAX,
	BLUE_HUE_MIN,
	formatHex,
	hslToRgb,
	LUM_TOLERANCE,
	MIN_SATURATION,
	parseHex,
	relativeLuminance,
	rgbToHsl,
	rotateHuePreservingLuminance,
	shouldRotate,
	TARGET_HUE,
} from "./color";

/**
 * 锚点用例：从 Dark 2026 实际截图量出的 button.border。
 * 这是整个变换的基准 —— 不过就是公式实现错了，别往下跑全量。
 */
describe("锚点：#377B9F -> #2D8351", () => {
	const parsed = parseHex("#377B9F")!;
	const hsl = rgbToHsl(parsed.rgb);

	test("原色测量值符合预期 hue 201 / sat 49% / L 0.1748", () => {
		expect(Math.round(hsl.h)).toBe(201);
		expect(Math.round(hsl.s * 100)).toBe(49);
		expect(relativeLuminance(parsed.rgb)).toBeCloseTo(0.1748, 4);
	});

	test("落在旋转判定区间内", () => {
		expect(shouldRotate(hsl)).toBe(true);
	});

	test("旋转结果精确等于 #2D8351", () => {
		const out = rotateHuePreservingLuminance(parsed.rgb);
		expect(formatHex(out.rgb, parsed.alphaHex)).toBe("#2D8351");
	});

	test("新色 hue 145 / sat 49% / L 0.1738，亮度差 <= 0.002", () => {
		const out = rotateHuePreservingLuminance(parsed.rgb);
		const newHsl = rgbToHsl(out.rgb);
		expect(Math.round(newHsl.h)).toBe(145);
		expect(Math.round(newHsl.s * 100)).toBe(49);
		expect(relativeLuminance(out.rgb)).toBeCloseTo(0.1738, 4);
		expect(Math.abs(out.lumDelta)).toBeLessThanOrEqual(LUM_TOLERANCE);
	});
});

describe("色值解析：四种十六进制形式 + alpha 透传", () => {
	test("#RGB", () => {
		expect(parseHex("#37b")).toEqual({
			rgb: { r: 0x33, g: 0x77, b: 0xbb },
			alphaHex: null,
		});
	});

	test("#RGBA -> alpha nibble 复制成两位", () => {
		expect(parseHex("#37b8")).toEqual({
			rgb: { r: 0x33, g: 0x77, b: 0xbb },
			alphaHex: "88",
		});
	});

	test("#RRGGBB", () => {
		expect(parseHex("#377B9F")!.rgb).toEqual({ r: 55, g: 123, b: 159 });
	});

	test("#RRGGBBAA -> alpha 原样记下", () => {
		expect(parseHex("#3994BCB3")!.alphaHex).toBe("B3");
	});

	test("大小写不敏感", () => {
		expect(parseHex("#3994bcb3")!.rgb).toEqual(parseHex("#3994BCB3")!.rgb);
	});

	test("非法形式返回 null", () => {
		for (const bad of ["#12345", "#1234567", "transparent", "", "#xyz"]) {
			expect(parseHex(bad)).toBeNull();
		}
	});

	test("alpha 不参与亮度计算", () => {
		const opaque = parseHex("#3994BC")!;
		const translucent = parseHex("#3994BC00")!;
		expect(relativeLuminance(opaque.rgb)).toBe(relativeLuminance(translucent.rgb));
	});

	test("alpha 原样写回", () => {
		const p = parseHex("#3994BCB3")!;
		const out = rotateHuePreservingLuminance(p.rgb);
		expect(formatHex(out.rgb, p.alphaHex).endsWith("B3")).toBe(true);
	});
});

describe("旋转判定边界", () => {
	test("hue 区间闭合于 [190, 220]", () => {
		expect(shouldRotate({ h: 190, s: 0.5, l: 0.5 })).toBe(true);
		expect(shouldRotate({ h: 220, s: 0.5, l: 0.5 })).toBe(true);
		expect(shouldRotate({ h: 189.9, s: 0.5, l: 0.5 })).toBe(false);
		expect(shouldRotate({ h: 220.1, s: 0.5, l: 0.5 })).toBe(false);
	});

	test("饱和度低于 15% 的中性色不动", () => {
		expect(shouldRotate({ h: 205, s: 0.15, l: 0.5 })).toBe(true);
		expect(shouldRotate({ h: 205, s: 0.1499, l: 0.5 })).toBe(false);
	});
});

/** 蓝区网格，供各扫描测试复用 */
function* blueGrid() {
	for (let h = BLUE_HUE_MIN; h <= BLUE_HUE_MAX; h += 2.5)
		for (let s = MIN_SATURATION; s <= 1.0001; s += 0.05)
			for (let l = 0.05; l <= 0.96; l += 0.05) yield { h, s, l };
}

describe("保亮度不变式：全蓝区扫描", () => {
	test("暗色区（亮度 <= 0.35，即暗色主题实际用色范围）亮度差 <= 0.002", () => {
		for (const { h, s, l } of blueGrid()) {
			const src = hslToRgb({ h, s, l });
			if (relativeLuminance(src) > 0.35) continue;
			const out = rotateHuePreservingLuminance(src);
			expect(Math.abs(out.lumDelta)).toBeLessThanOrEqual(LUM_TOLERANCE);
		}
	});

	test("亮色区超差是 8bit 量化天花板，不是算法失准：返回的必须是可达色里最优的那个", () => {
		// 高亮度处 dLum/dchannel 很大，绿通道跳一格就 ≈ 0.004 亮度 —— 比容差还宽。
		// 目标亮度落在两个可表示色中间时物理上够不到，此时唯一有意义的契约是
		// "在 hue=145 / 同 sat 这条线上，没有别的量化色比它更接近"。
		//
		// 注意：基准必须用 src 量化后的实测 sat（函数就是拿它做旋转的），
		// 不能用网格的理想 s —— 那是另一条线，比出来的"更优解"是假的。
		for (const { h, s, l } of blueGrid()) {
			const src = hslToRgb({ h, s, l });
			const target = relativeLuminance(src);
			const srcSat = rgbToHsl(src).s;
			const out = rotateHuePreservingLuminance(src);
			const gotErr = Math.abs(out.lumDelta);

			let bestErr = Number.POSITIVE_INFINITY;
			for (let i = 0; i <= 20000; i++) {
				const cand = hslToRgb({ h: TARGET_HUE, s: srcSat, l: i / 20000 });
				bestErr = Math.min(bestErr, Math.abs(relativeLuminance(cand) - target));
			}
			expect(gotErr).toBeLessThanOrEqual(bestErr + 1e-9);
		}
	}, 30_000); // 全域穷举对拍，比默认 5s 慢

	test("色度足够时 hue 落在 145、sat 守恒", () => {
		// hue/sat 只有在色度够大时才测得准：色度小的色本身就接近灰，
		// 通道极差只有几级，round 一下 hue 就能飘十几度 —— 8bit 的固有限制，
		// 不是变换的问题。所以按实际通道极差门控，而不是按 L/S 猜。
		// 同样，基准是 src 的实测 sat，不是网格 s。
		for (const { h, s, l } of blueGrid()) {
			const src = hslToRgb({ h, s, l });
			const srcSat = rgbToHsl(src).s;
			const out = rotateHuePreservingLuminance(src);
			const chroma =
				Math.max(out.rgb.r, out.rgb.g, out.rgb.b) -
				Math.min(out.rgb.r, out.rgb.g, out.rgb.b);
			if (chroma < 24) continue;

			const newHsl = rgbToHsl(out.rgb);
			expect(Math.abs(newHsl.h - TARGET_HUE)).toBeLessThan(2);

			// HSL 的 sat 在极端明暗处本身是病态的：s = chroma / (1 - |2L-1|)，
			// L 趋近 0/1 时分母趋零，会把 ±1 级的量化噪声放大成几个百分点的 sat 抖动。
			// 把这个放大因子乘回去做归一化，等价于校验"量化前的 chroma 误差在几级之内"，
			// 这样一个断言就能覆盖全区间，不用按明暗分支。
			//
			// 注意 chroma 本身不是本变换的不变量：等亮度的绿需要更低的 L，
			// 而 chroma = (1-|2L-1|)·S，L 一变它就跟着变。守恒的只有 sat。
			const conditioning = 1 - Math.abs(2 * newHsl.l - 1);
			expect(Math.abs(newHsl.s - srcSat) * conditioning).toBeLessThan(0.02);
		}
	});
});
