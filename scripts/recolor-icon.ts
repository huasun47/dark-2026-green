/**
 * 把图标里某个色替换成另一个色，保留抗锯齿。
 *
 * 为什么不能直接按色值替换：绿条边缘的像素是"绿 × α + 底色 × (1-α)"混出来的中间色，
 * 逐色替换只会换掉纯色部分，留下一圈旧色的锯齿边。
 * 这里改为反解每个像素的混合比例 α，再用新色按同样的 α 重新混合 —— 边缘因此完好。
 *
 * 用法:
 *   bun scripts/recolor-icon.ts --from #398A51 --to #309D5D [--bg #191A1B] [--dry]
 *
 * 幂等保护：图标里找不到 --from 色就直接报错退出（多半是已经改过了），不会把图越改越歪。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodePng } from "./png";
import { formatHex, parseHex, type Rgb } from "./color";
import { ROOT } from "./manifest";

function arg(name: string, fallback?: string): string {
	const i = process.argv.indexOf(`--${name}`);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	if (fallback !== undefined) return fallback;
	throw new Error(`缺少必需参数 --${name}`);
}

const fromHex = arg("from");
const toHex = arg("to");
const bgHex = arg("bg", "#191A1B"); // 抗锯齿混合的另一端，默认取主题 sideBar.background
const dryRun = process.argv.includes("--dry");

const from = parseHex(fromHex)?.rgb;
const to = parseHex(toHex)?.rgb;
const bg = parseHex(bgHex)?.rgb;
if (!from || !to || !bg) throw new Error("--from / --to / --bg 必须是合法十六进制色");

const iconPath = join(ROOT, "icon.png");
const img = decodePng(readFileSync(iconPath));

// 把像素投影到 bg -> from 这条线上，求混合比例 α 及偏离该线的残差。
// 残差大的说明它压根不是这条线上的色（比如灰色文本线），不动。
const axis: Rgb = { r: from.r - bg.r, g: from.g - bg.g, b: from.b - bg.b };
const axisLenSq = axis.r ** 2 + axis.g ** 2 + axis.b ** 2;
if (axisLenSq === 0) throw new Error("--from 与 --bg 相同，无法定义混合轴");

const MAX_RESIDUAL = 12; // 允许的偏离（0-255 欧氏距离），够宽容 PNG 量化又不会误伤灰线
const MIN_ALPHA = 0.02; // 低于此比例视作纯背景，不动

let touched = 0;
const seenAlpha: number[] = [];

for (let i = 0; i < img.width * img.height; i++) {
	const o = i * 4;
	const px: Rgb = { r: img.pixels[o], g: img.pixels[o + 1], b: img.pixels[o + 2] };
	if (img.pixels[o + 3] === 0) continue; // 全透明，跳过

	const d: Rgb = { r: px.r - bg.r, g: px.g - bg.g, b: px.b - bg.b };
	const alpha = (d.r * axis.r + d.g * axis.g + d.b * axis.b) / axisLenSq;
	if (alpha < MIN_ALPHA || alpha > 1.2) continue;

	// 残差：像素到 bg + α·axis 这个投影点的距离
	const residual = Math.hypot(
		d.r - alpha * axis.r,
		d.g - alpha * axis.g,
		d.b - alpha * axis.b,
	);
	if (residual > MAX_RESIDUAL) continue;

	const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
	img.pixels[o] = clamp(bg.r + alpha * (to.r - bg.r));
	img.pixels[o + 1] = clamp(bg.g + alpha * (to.g - bg.g));
	img.pixels[o + 2] = clamp(bg.b + alpha * (to.b - bg.b));
	touched++;
	seenAlpha.push(alpha);
}

const solid = seenAlpha.filter((a) => a > 0.95).length;
console.log(`混合轴: ${formatHex(bg, null)} -> ${formatHex(from, null)}`);
console.log(`改写像素: ${touched} 个（其中纯色 ${solid} 个，抗锯齿 ${touched - solid} 个）`);

if (solid === 0) {
	console.error(`\n✗ 图标里找不到纯 ${fromHex} 的像素 —— 多半已经改过色了，中止以免越改越歪。`);
	process.exit(1);
}

if (dryRun) {
	console.log("\n--dry 模式，未写入。");
	process.exit(0);
}

writeFileSync(iconPath, encodePng(img));
console.log(`\n✓ 已写入 ${iconPath}：${fromHex} -> ${toHex}`);
