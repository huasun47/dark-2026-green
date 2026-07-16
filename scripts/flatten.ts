/**
 * 沿 include 链拍平 VS Code 内置主题，产出完全自包含、不含 include 的主题 JSON。
 *
 * 为什么必须拍平：扩展包里的 include 只能是包内相对路径，没法引用内置主题目录，
 * 所以 2026-dark.json 那条 include 链在扩展里根本解析不了 —— 必须先在构建期摊平。
 *
 * 内置主题是 JSON with Comments（可能含 // 注释和尾逗号），
 * 不同 VS Code 版本有的压缩过有的没有，一律走 jsonc 解析器，不能用 JSON.parse。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

export interface RawTheme {
	include?: string;
	name?: string;
	type?: string;
	colors?: Record<string, string>;
	tokenColors?: unknown[];
	semanticTokenColors?: Record<string, unknown>;
	semanticHighlighting?: boolean;
	[key: string]: unknown;
}

export function readJsonc<T>(file: string): T {
	const errors: ParseError[] = [];
	const data = parseJsonc(readFileSync(file, "utf8"), errors, {
		allowTrailingComma: true,
		disallowComments: false,
	});
	if (errors.length > 0) {
		const detail = errors
			.map((e) => `${printParseErrorCode(e.error)}@offset ${e.offset}`)
			.join(", ");
		throw new Error(`解析 JSONC 失败: ${file}\n  ${detail}`);
	}
	if (data === undefined) throw new Error(`解析结果为空: ${file}`);
	return data as T;
}

export interface FlattenResult {
	theme: RawTheme;
	/** 实际参与合并的文件，父在前子在后 */
	chain: string[];
}

/**
 * 从入口沿 include 一路向上收集祖先，再按"父在前、子覆盖父"的顺序合并。
 */
export function flattenTheme(entry: string): FlattenResult {
	const chain: { file: string; theme: RawTheme }[] = [];
	const seen = new Set<string>();
	let cur = resolve(entry);

	while (true) {
		if (seen.has(cur)) {
			throw new Error(`include 链出现环: ${cur}`);
		}
		seen.add(cur);
		const theme = readJsonc<RawTheme>(cur);
		chain.unshift({ file: cur, theme }); // unshift -> 最远的祖先排在最前
		if (!theme.include) break;
		cur = resolve(dirname(cur), theme.include);
	}

	const merged: RawTheme = {};
	const colors: Record<string, string> = {};
	const tokenColors: unknown[] = [];
	const semanticTokenColors: Record<string, unknown> = {};

	for (const { theme } of chain) {
		// 除三类特殊字段外，其余标量字段一律子覆盖父；include 本身丢弃
		for (const [k, v] of Object.entries(theme)) {
			if (k === "include" || k === "colors" || k === "tokenColors" || k === "semanticTokenColors") {
				continue;
			}
			merged[k] = v;
		}
		// colors / semanticTokenColors: 浅合并，同名 key 子覆盖父
		Object.assign(colors, theme.colors ?? {});
		Object.assign(semanticTokenColors, theme.semanticTokenColors ?? {});
		// tokenColors: 数组拼接，父在前子在后（VS Code 里后出现的规则优先级更高）
		if (Array.isArray(theme.tokenColors)) tokenColors.push(...theme.tokenColors);
	}

	merged.colors = colors;
	merged.tokenColors = tokenColors;
	if (Object.keys(semanticTokenColors).length > 0) {
		merged.semanticTokenColors = semanticTokenColors;
	}

	return { theme: merged, chain: chain.map((c) => c.file) };
}
