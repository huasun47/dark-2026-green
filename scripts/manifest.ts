/**
 * package.json 是主题名与产出路径的唯一真相来源。
 *
 * build / verify 都从这里读，而不是各自硬编码一份 —— 否则改名时漏掉任何一处，
 * 都会变成"主题 JSON 生成到 A，package.json 指向 B"这种装上才发现的错。
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");

interface ThemeContribution {
	label: string;
	uiTheme: string;
	path: string;
}

interface Manifest {
	name: string;
	displayName: string;
	description: string;
	contributes?: { themes?: ThemeContribution[] };
}

const manifest: Manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const entry = manifest.contributes?.themes?.[0];
if (!entry) throw new Error("package.json 的 contributes.themes 为空，无法确定主题名与产出路径");

/** 主题在 Ctrl+K Ctrl+T 选择器里显示的名字 */
export const THEME_LABEL = entry.label;
/** 产出主题 JSON 的绝对路径，由 package.json 的 contributes.themes[0].path 决定 */
export const THEME_PATH = join(ROOT, entry.path);
export const DISPLAY_NAME = manifest.displayName;
