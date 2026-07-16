/**
 * 对拍 baseline.json 与产出主题，确认变换只动了该动的地方。
 * 这是构建后的独立体检，防止脚本改坏了却没人发现。
 *
 * 用法: bun scripts/verify.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BLUE_HUE_MAX,
	BLUE_HUE_MIN,
	LUM_TOLERANCE,
	MIN_SATURATION,
	parseHex,
	relativeLuminance,
	rgbToHsl,
	TARGET_HUE,
} from "./color";
import { ROOT, THEME_PATH } from "./manifest";
import { protectionFor } from "./protections";

const base = JSON.parse(readFileSync(join(ROOT, "baseline.json"), "utf8"));
const out = JSON.parse(readFileSync(THEME_PATH, "utf8"));

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
	if (!ok) failures.push(msg);
};

// 1. 语法高亮必须逐字节相同
check(
	JSON.stringify(base.tokenColors) === JSON.stringify(out.tokenColors),
	"tokenColors 被改动了 —— 语法高亮必须与 Dark 2026 完全一致",
);
check(
	JSON.stringify(base.semanticTokenColors ?? null) === JSON.stringify(out.semanticTokenColors ?? null),
	"semanticTokenColors 被改动了",
);

// 2. colors 的 key 集合不能增删
const baseKeys = Object.keys(base.colors).sort();
const outKeys = Object.keys(out.colors).sort();
check(JSON.stringify(baseKeys) === JSON.stringify(outKeys), "colors 的 key 集合发生了增删");

// 3. 产出不得残留 include
check(!("include" in out), "产出主题仍含 include 字段，扩展里解析不了");

// 4. 逐项核对：改了的必须是蓝区非保护色且保亮度；没改的必须本就不该改
let changedCount = 0;

for (const key of baseKeys) {
	const from = base.colors[key];
	const to = out.colors[key];
	const pf = parseHex(from);
	if (!pf) {
		check(from === to, `${key}: 非十六进制色值不该被改动`);
		continue;
	}
	const hsl = rgbToHsl(pf.rgb);
	const inBlue = hsl.h >= BLUE_HUE_MIN && hsl.h <= BLUE_HUE_MAX && hsl.s >= MIN_SATURATION;
	const isProtected = protectionFor(key) !== null;

	if (from === to) {
		// 没改的：必须确实不该改
		check(
			!inBlue || isProtected,
			`${key} = ${from} 落在蓝区(hue ${hsl.h.toFixed(1)}/sat ${(hsl.s * 100).toFixed(0)}%)且不在保护名单，却没被旋转`,
		);
		continue;
	}

	changedCount++;
	const pt = parseHex(to);
	check(pt !== null, `${key}: 新值 ${to} 解析失败`);
	if (!pt) continue;

	check(inBlue, `${key}: 原色不在蓝区却被改了`);
	check(!isProtected, `${key}: 保护名单里的色被改了`);
	check(pf.alphaHex === pt.alphaHex, `${key}: alpha 没有原样透传 (${pf.alphaHex} -> ${pt.alphaHex})`);

	const lumDelta = Math.abs(relativeLuminance(pt.rgb) - relativeLuminance(pf.rgb));
	check(
		lumDelta <= LUM_TOLERANCE,
		`${key}: 亮度差 ${lumDelta.toFixed(5)} 超出容差 ${LUM_TOLERANCE}`,
	);

	// 色度足够时才校验 hue/sat —— 极暗色量化后测不准，理由见 color.test.ts
	const nh = rgbToHsl(pt.rgb);
	const chroma = Math.max(pt.rgb.r, pt.rgb.g, pt.rgb.b) - Math.min(pt.rgb.r, pt.rgb.g, pt.rgb.b);
	if (chroma >= 24) {
		check(Math.abs(nh.h - TARGET_HUE) < 2, `${key}: 新 hue ${nh.h.toFixed(1)} 不是 ${TARGET_HUE}`);
		const conditioning = 1 - Math.abs(2 * nh.l - 1);
		check(
			Math.abs(nh.s - hsl.s) * conditioning < 0.02,
			`${key}: sat 未守恒 ${(hsl.s * 100).toFixed(0)}% -> ${(nh.s * 100).toFixed(0)}%`,
		);
	}
}

console.log(`核对了 ${baseKeys.length} 项 colors，其中改动 ${changedCount} 项`);
console.log(`tokenColors: ${out.tokenColors.length} 条规则，与 baseline 完全一致 ✓`);

if (failures.length > 0) {
	console.error(`\n✗ ${failures.length} 项校验失败:`);
	for (const f of failures) console.error("  - " + f);
	process.exit(1);
}
console.log("\n✓ 全部校验通过");
