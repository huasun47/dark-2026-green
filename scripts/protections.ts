/**
 * 保护名单：命中的 key 无论落在什么色相都不旋转。
 *
 * build 和 verify 共用同一份定义 —— 各自维护一份的话，
 * 加了规则却漏改另一边，verify 就会把正确的产物判为失败（或反过来放过错误）。
 */

export interface Protection {
	pattern: RegExp;
	reason: string;
}

export const PROTECTIONS: Protection[] = [
	{
		// 终端程序按标准色语义取色，改了会让 ls / vim 等配色错乱
		pattern: /^terminal\.ansi/i,
		reason: "terminal.ansi* 标准色语义",
	},
	{
		// 颜色本身承载"出错了"的含义，变绿等于抹掉语义
		pattern: /error|warning/i,
		reason: "error/warning 语义色",
	},
	{
		// 和 terminal.ansi* 同理：名字本身就是契约。
		// charts.* 是数据可视化的分类色板，不是 UI 强调色 —— charts.blue 转绿既名实不符，
		// 又会和同族的 charts.green 在图例里撞成两个绿。
		// 写成通用规则而非只挡 charts.blue，是为了兜住以后新增的 xxx.blue。
		pattern: /\.(blue|green|red|yellow|orange|purple|cyan|magenta)$/i,
		reason: "按颜色词命名，名字即契约",
	},
];

export function protectionFor(key: string): Protection | null {
	return PROTECTIONS.find((p) => p.pattern.test(key)) ?? null;
}
