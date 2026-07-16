/**
 * 构建主题：拍平内置 Dark 2026 -> 保亮度旋转 UI 强调色 -> 出体检报告。
 *
 * 主题名和产出路径都取自 package.json，见 ./manifest.ts。
 *
 * 用法: bun scripts/build.ts [VSCode主题目录]
 * 不传则自动探测本机 VS Code 安装位置。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { ROOT, THEME_LABEL, THEME_PATH } from "./manifest";
import {
	formatHex,
	LUM_TOLERANCE,
	parseHex,
	relativeLuminance,
	rgbToHsl,
	rotateHuePreservingLuminance,
	shouldRotate,
	TARGET_HUE,
	BLUE_HUE_MIN,
	BLUE_HUE_MAX,
	MIN_SATURATION,
} from "./color";
import { flattenTheme } from "./flatten";
import { protectionFor } from "./protections";

// ---------------------------------------------------------------------------
// 定位内置主题
// ---------------------------------------------------------------------------

const THEME_SUBPATH = join("resources", "app", "extensions", "theme-defaults", "themes");

function detectThemesDir(): string {
	const candidates: string[] = [];
	const home = process.env.USERPROFILE ?? "";
	if (home) candidates.push(join(home, "AppData", "Local", "Programs", "Microsoft VS Code"));
	candidates.push("C:\\Program Files\\Microsoft VS Code");
	candidates.push("C:\\Program Files (x86)\\Microsoft VS Code");

	// 用 where.exe 反推：bin/code -> 安装根目录
	try {
		const out = execFileSync("where.exe", ["code"], { encoding: "utf8" });
		for (const line of out.split(/\r?\n/).filter(Boolean)) {
			candidates.push(resolve(dirname(line.trim()), ".."));
		}
	} catch {
		// where.exe 找不到 code 就算了，继续试固定路径
	}

	for (const base of candidates) {
		const direct = join(base, THEME_SUBPATH);
		if (existsSync(join(direct, "2026-dark.json"))) return direct;
		// 新版安装目录会多一层版本哈希，扫一层子目录
		try {
			for (const sub of require("node:fs").readdirSync(base)) {
				const nested = join(base, sub, THEME_SUBPATH);
				if (existsSync(join(nested, "2026-dark.json"))) return nested;
			}
		} catch {
			// base 不存在或不可读，跳过
		}
	}
	throw new Error(
		"没找到内置主题目录。请手动传入，例如：\n" +
			'  bun scripts/build.ts "C:\\path\\to\\VS Code\\resources\\app\\extensions\\theme-defaults\\themes"',
	);
}

// ---------------------------------------------------------------------------
// 变换
// ---------------------------------------------------------------------------

interface ChangedRow {
	key: string;
	from: string;
	to: string;
	fromHue: number;
	fromSat: number;
	fromLum: number;
	toHue: number;
	toSat: number;
	toLum: number;
	lumDelta: number;
}

interface BorderRow {
	key: string;
	value: string;
	hue: number;
	sat: number;
}

interface Notice {
	key: string;
	value: string;
	hue: number;
	sat: number;
	reason: string;
}


function build() {
	const themesDir = process.argv[2] ?? detectThemesDir();
	const entry = join(themesDir, "2026-dark.json");
	if (!existsSync(entry)) throw new Error(`找不到 2026-dark.json: ${entry}`);

	const { theme, chain } = flattenTheme(entry);
	console.log("拍平的 include 链（父 -> 子）:");
	for (const f of chain) console.log("  " + f);

	// baseline：拍平后、未变换的完全自包含主题，供 diff
	writeFileSync(join(ROOT, "baseline.json"), JSON.stringify(theme, null, 2) + "\n", "utf8");

	const colors: Record<string, string> = { ...(theme.colors ?? {}) };
	const changed: ChangedRow[] = [];
	const borderline: BorderRow[] = [];
	const protectedInBlue: Notice[] = [];
	const overTolerance: ChangedRow[] = [];
	const unparsed: { key: string; value: string }[] = [];

	for (const [key, value] of Object.entries(colors)) {
		const parsed = parseHex(value);
		if (!parsed) {
			unparsed.push({ key, value });
			continue;
		}
		const hsl = rgbToHsl(parsed.rgb);
		const inBlue = hsl.h >= BLUE_HUE_MIN && hsl.h <= BLUE_HUE_MAX && hsl.s >= MIN_SATURATION;

		// 边界可疑：贴着蓝区两侧、没被旋转的，人工复核用。
		// 这里不按 sat 过滤 —— 目的就是把所有可能"漏网的蓝"摆出来给人眼判断，
		// sat 作为一列给出，由人来决定它是不是中性灰。
		if ((hsl.h >= 180 && hsl.h < BLUE_HUE_MIN) || (hsl.h > BLUE_HUE_MAX && hsl.h <= 235)) {
			borderline.push({ key, value, hue: hsl.h, sat: hsl.s });
		}

		const protection = protectionFor(key);
		if (protection) {
			// 保护名单命中且恰好落在蓝区 —— 这正是提示词要我列出来的情况
			if (inBlue) {
				protectedInBlue.push({ key, value, hue: hsl.h, sat: hsl.s, reason: protection.reason });
			}
			continue;
		}

		if (!shouldRotate(hsl)) continue;

		const out = rotateHuePreservingLuminance(parsed.rgb, TARGET_HUE);
		const next = formatHex(out.rgb, parsed.alphaHex);
		const newHsl = rgbToHsl(out.rgb);
		const row: ChangedRow = {
			key,
			from: value,
			to: next,
			fromHue: hsl.h,
			fromSat: hsl.s,
			fromLum: relativeLuminance(parsed.rgb),
			toHue: newHsl.h,
			toSat: newHsl.s,
			toLum: relativeLuminance(out.rgb),
			lumDelta: out.lumDelta,
		};
		colors[key] = next;
		changed.push(row);
		if (Math.abs(out.lumDelta) > LUM_TOLERANCE) overTolerance.push(row);
	}

	// 产出主题：只换 colors，tokenColors / semanticTokenColors 原样带出
	const outTheme = {
		$schema: "vscode://schemas/color-theme",
		name: THEME_LABEL,
		type: theme.type ?? "dark",
		semanticHighlighting: theme.semanticHighlighting ?? true,
		colors,
		tokenColors: theme.tokenColors ?? [],
		...(theme.semanticTokenColors ? { semanticTokenColors: theme.semanticTokenColors } : {}),
	};
	mkdirSync(dirname(THEME_PATH), { recursive: true });
	writeFileSync(THEME_PATH, JSON.stringify(outTheme, null, 2) + "\n", "utf8");

	report({ colors, changed, borderline, protectedInBlue, overTolerance, unparsed });
}

// ---------------------------------------------------------------------------
// 体检报告
// ---------------------------------------------------------------------------

const f2 = (n: number) => n.toFixed(2);
const f4 = (n: number) => n.toFixed(4);
const pct = (n: number) => `${Math.round(n * 100)}%`;

function report(d: {
	colors: Record<string, string>;
	changed: ChangedRow[];
	borderline: BorderRow[];
	protectedInBlue: Notice[];
	overTolerance: ChangedRow[];
	unparsed: { key: string; value: string }[];
}) {
	console.log(`\n${"=".repeat(100)}`);
	console.log(`表 A（已改）：共 ${d.changed.length} 项 / 全部 ${Object.keys(d.colors).length} 项 colors`);
	console.log("=".repeat(100));
	console.table(
		d.changed.map((r) => ({
			key: r.key,
			原值: r.from,
			新值: r.to,
			"原 h,s,L": `${f2(r.fromHue)}, ${pct(r.fromSat)}, ${f4(r.fromLum)}`,
			"新 h,s,L": `${f2(r.toHue)}, ${pct(r.toSat)}, ${f4(r.toLum)}`,
			亮度差: r.lumDelta.toFixed(5),
		})),
	);

	console.log(`\n${"=".repeat(100)}`);
	console.log(`表 B（边界可疑，未改，需人工看）：hue ∈ [180,190) 或 (220,235]，共 ${d.borderline.length} 项`);
	console.log("=".repeat(100));
	if (d.borderline.length === 0) {
		console.log("（无）");
	} else {
		console.table(
			d.borderline.map((r) => ({ key: r.key, 值: r.value, hue: f2(r.hue), sat: pct(r.sat) })),
		);
	}

	console.log(`\n${"=".repeat(100)}`);
	console.log("落在蓝区但被保护名单挡下的条目（提示词要求列出）");
	console.log("=".repeat(100));
	if (d.protectedInBlue.length === 0) {
		console.log("（无）—— 没有 error/warning 或 terminal.ansi* 色落在 hue [190,220] 且 sat ≥ 15% 的范围内");
	} else {
		console.table(
			d.protectedInBlue.map((r) => ({
				key: r.key,
				值: r.value,
				hue: f2(r.hue),
				sat: pct(r.sat),
				保护原因: r.reason,
			})),
		);
	}

	if (d.overTolerance.length > 0) {
		console.log(`\n${"!".repeat(100)}`);
		console.log(`亮度差超出 ${LUM_TOLERANCE} 容差的条目（8bit 量化天花板所致，已取可达最优）`);
		console.log("!".repeat(100));
		console.table(
			d.overTolerance.map((r) => ({ key: r.key, 原值: r.from, 新值: r.to, 亮度差: r.lumDelta.toFixed(5) })),
		);
	} else {
		console.log(`\n✓ 全部 ${d.changed.length} 项改动亮度差均 ≤ ${LUM_TOLERANCE}`);
	}

	if (d.unparsed.length > 0) {
		console.log("\n非十六进制色值（原样跳过）:");
		console.table(d.unparsed);
	}

	const maxDelta = d.changed.reduce((m, r) => Math.max(m, Math.abs(r.lumDelta)), 0);
	console.log(`\n最大亮度偏差: ${maxDelta.toFixed(5)}`);
}

build();
