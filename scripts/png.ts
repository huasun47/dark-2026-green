/**
 * 最小 PNG 编解码器，只覆盖本项目需要的格式：8 位深 / RGBA(颜色类型 6) / 非隔行。
 *
 * 手写而不是拉图像库：只为了给图标换个色引入一整套原生依赖不划算，
 * 而这个子集的 PNG 规范很小 —— 无非是 IHDR/IDAT/IEND 三个 chunk 加 5 种行过滤器。
 * 遇到不支持的格式一律显式报错，不做静默降级。
 */

import { deflateSync, inflateSync } from "node:zlib";

export interface Bitmap {
	width: number;
	height: number;
	/** RGBA，每通道 1 字节，长度 = width * height * 4 */
	pixels: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BPP = 4; // RGBA8

// CRC32：PNG 每个 chunk 都要带，标准多项式 0xEDB88320
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Bitmap {
	if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("不是 PNG 文件");

	let width = 0;
	let height = 0;
	const idat: Buffer[] = [];
	let offset = 8;

	while (offset < file.length) {
		const len = file.readUInt32BE(offset);
		const type = file.subarray(offset + 4, offset + 8).toString("ascii");
		const data = file.subarray(offset + 8, offset + 8 + len);

		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			const [depth, colorType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
			if (depth !== 8) throw new Error(`只支持 8 位深，实际 ${depth}`);
			if (colorType !== 6) throw new Error(`只支持 RGBA(颜色类型 6)，实际 ${colorType}`);
			if (interlace !== 0) throw new Error("不支持隔行 PNG");
		} else if (type === "IDAT") {
			idat.push(Buffer.from(data));
		} else if (type === "IEND") {
			break;
		}
		offset += 12 + len; // 长度(4) + 类型(4) + 数据 + CRC(4)
	}

	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * BPP;
	const pixels = Buffer.alloc(height * stride);

	// 逐行反过滤：每行开头一字节标明该行用的过滤器
	let src = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[src++];
		for (let x = 0; x < stride; x++) {
			const cur = raw[src + x];
			const a = x >= BPP ? pixels[y * stride + x - BPP] : 0; // 左
			const b = y > 0 ? pixels[(y - 1) * stride + x] : 0; // 上
			const c = x >= BPP && y > 0 ? pixels[(y - 1) * stride + x - BPP] : 0; // 左上
			let v: number;
			switch (filter) {
				case 0: v = cur; break;
				case 1: v = cur + a; break;
				case 2: v = cur + b; break;
				case 3: v = cur + ((a + b) >> 1); break;
				case 4: v = cur + paeth(a, b, c); break;
				default: throw new Error(`第 ${y} 行出现未知过滤器 ${filter}`);
			}
			pixels[y * stride + x] = v & 0xff;
		}
		src += stride;
	}

	return { width, height, pixels };
}

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData), 0);
	return Buffer.concat([len, typeAndData, crc]);
}

export function encodePng({ width, height, pixels }: Bitmap): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // 位深
	ihdr[9] = 6; // 颜色类型 RGBA
	ihdr[10] = 0; // 压缩方法
	ihdr[11] = 0; // 过滤方法
	ihdr[12] = 0; // 非隔行

	// 全部用 filter 0(None)：纯色块图压缩率已经足够，不值得为几百字节做过滤器选优
	const stride = width * BPP;
	const raw = Buffer.alloc(height * (1 + stride));
	for (let y = 0; y < height; y++) {
		raw[y * (1 + stride)] = 0;
		pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
	}

	return Buffer.concat([
		SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
