/**
 * Minimal ISO-BMFF (MP4) structural validator.
 *
 * Used twice: in the browser right after muxing (so the UI can prove it made a
 * real MP4 container and not a renamed WebM), and in the Node e2e test against
 * the file that was actually downloaded.
 */

export interface Mp4Inspection {
  valid: boolean;
  fileSize: number;
  brands: string[];
  boxes: string[];
  hasMoov: boolean;
  hasMdat: boolean;
  /** From mvhd, seconds. */
  durationSec: number | null;
  /** From tkhd (16.16 fixed point). */
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  errors: string[];
}

const MAX_HEADER_SCAN = 4 * 1024 * 1024;

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

export function inspectMp4(buffer: ArrayBuffer): Mp4Inspection {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const errors: string[] = [];
  const boxes: string[] = [];
  const brands: string[] = [];

  if (bytes.byteLength < 16) {
    return {
      valid: false,
      fileSize: bytes.byteLength,
      brands,
      boxes,
      hasMoov: false,
      hasMdat: false,
      durationSec: null,
      width: null,
      height: null,
      videoCodec: null,
      errors: ['文件过小，不是有效的 MP4'],
    };
  }

  const firstType = fourcc(bytes, 4);
  if (firstType !== 'ftyp') {
    errors.push(`首个 box 不是 ftyp，而是 "${firstType}"`);
  }

  let durationSec: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let videoCodec: string | null = null;

  // Walk top-level boxes.
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size = readU32(view, offset);
    const type = fourcc(bytes, offset + 4);
    boxes.push(`${type}:${size}`);
    if (type === 'ftyp') {
      const end = Math.min(offset + size, bytes.byteLength);
      for (let p = offset + 16; p + 4 <= end; p += 4) brands.push(fourcc(bytes, p));
    }
    if (size < 8) {
      errors.push(`box "${type}" 尺寸非法 (${size})`);
      break;
    }
    if (type === 'moov') {
      // Scan moov children shallowly for mvhd / tkhd / stsd codec.
      const end = Math.min(offset + size, bytes.byteLength);
      let p = offset + 8;
      while (p + 8 <= end) {
        const childSize = readU32(view, p);
        const childType = fourcc(bytes, p + 4);
        if (childSize < 8) break;
        if (childType === 'mvhd') {
          const version = bytes[p + 8] ?? 0;
          if (version === 1 && p + 40 <= end) {
            // v1: timescale @ +28 (u32), duration @ +32 (u64, read the low word)
            const timescale = readU32(view, p + 28);
            const dur = readU32(view, p + 36);
            if (timescale > 0) durationSec = dur / timescale;
          } else if (p + 28 <= end) {
            // v0: timescale @ +20 (u32), duration @ +24 (u32)
            const timescale = readU32(view, p + 20);
            const dur = readU32(view, p + 24);
            if (timescale > 0) durationSec = dur / timescale;
          }
        }
        if (childType === 'trak') {
          const trakEnd = Math.min(p + childSize, end);
          let q = p + 8;
          while (q + 8 <= trakEnd) {
            const grandSize = readU32(view, q);
            const grandType = fourcc(bytes, q + 4);
            if (grandSize < 8) break;
            if (grandType === 'tkhd') {
              const version = bytes[q + 8] ?? 0;
              // width/height are the last 8 bytes of tkhd, 16.16 fixed point.
              const base = q + grandSize;
              if (base - 8 <= trakEnd) {
                width = readU32(view, base - 8) / 65536;
                height = readU32(view, base - 4) / 65536;
              }
              void version;
            }
            q += grandSize;
          }
        }
        p += childSize;
      }
      // Codec fourcc lives in stsd; a byte scan inside moov is reliable enough.
      const scanLimit = Math.min(end, offset + MAX_HEADER_SCAN);
      for (let i = offset; i + 4 <= scanLimit; i += 1) {
        const tag = fourcc(bytes, i);
        if (tag === 'avc1' || tag === 'hvc1' || tag === 'hev1' || tag === 'vp09' || tag === 'av01') {
          videoCodec = tag;
          break;
        }
        if (tag === 'stsd') {
          // Continue scanning; avc1 sits a few dozen bytes later.
          continue;
        }
      }
    }
    offset += size;
  }

  const hasMoov = boxes.some((b) => b.startsWith('moov:'));
  const hasMdat = boxes.some((b) => b.startsWith('mdat:'));
  if (!hasMoov) errors.push('缺少 moov box');
  if (!hasMdat) errors.push('缺少 mdat box');
  if (durationSec === null) errors.push('无法从 mvhd 读取时长');
  if (width === null || height === null) errors.push('无法从 tkhd 读取分辨率');

  return {
    valid: errors.length === 0,
    fileSize: bytes.byteLength,
    brands,
    boxes,
    hasMoov,
    hasMdat,
    durationSec,
    width,
    height,
    videoCodec,
    errors,
  };
}

/** Quick structural check without full parse — used for UI assertions. */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength > 12 && fourcc(bytes, 4) === 'ftyp';
}

/** Reference helper so tests can assert the old WebM sniffing path is not used. */
export function looksLikeWebm(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

export function readU16At(buffer: ArrayBuffer, offset: number): number {
  return readU16(new DataView(buffer), offset);
}
