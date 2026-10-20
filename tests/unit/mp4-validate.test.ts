import { describe, expect, it } from 'vitest';
import { inspectMp4, looksLikeMp4, looksLikeWebm } from '@/lib/export/mp4-validate';

function ascii(value: string): number[] {
  return Array.from(value).map((char) => char.charCodeAt(0));
}

function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...ascii(type), ...payload];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Builds a minimal but structurally valid MP4 header set. */
function buildMp4({ width = 1080, height = 1920, durationSec = 5 } = {}): ArrayBuffer {
  const ftyp = box('ftyp', [...ascii('isom'), ...u32(512), ...ascii('isom'), ...ascii('mp41')]);

  // mvhd v0: version/flags(4) creation(4) modification(4) timescale(4) duration(4) + reserved
  const mvhdPayload = [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(1000), ...u32(durationSec * 1000)];
  while (mvhdPayload.length < 100) mvhdPayload.push(0);
  const mvhd = box('mvhd', mvhdPayload);

  // tkhd v0: width/height are the last 8 bytes as 16.16 fixed point.
  const tkhdPayload = [0, 0, 0, 0];
  while (tkhdPayload.length < 76) tkhdPayload.push(0);
  tkhdPayload.push(...u32(width * 65536), ...u32(height * 65536));
  const tkhd = box('tkhd', tkhdPayload);
  const trak = box('trak', tkhd);
  const stsd = box('stsd', [...ascii('avc1'), 0, 0, 0, 0]);
  const moov = box('moov', [...mvhd, ...trak, ...stsd]);
  const mdat = box('mdat', new Array(64).fill(7));

  return new Uint8Array([...ftyp, ...moov, ...mdat]).buffer;
}

describe('inspectMp4', () => {
  it('parses brands, duration and track size from a real-shaped header', () => {
    const report = inspectMp4(buildMp4({ width: 1080, height: 1920 }));
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.brands).toContain('isom');
    expect(report.brands).toContain('mp41');
    expect(report.durationSec).toBeCloseTo(5, 3);
    expect(report.width).toBe(1080);
    expect(report.height).toBe(1920);
    expect(report.videoCodec).toBe('avc1');
    expect(report.hasMoov).toBe(true);
    expect(report.hasMdat).toBe(true);
  });

  it('reports missing mdat instead of pretending success', () => {
    const buffer = buildMp4();
    const bytes = new Uint8Array(buffer);
    // Truncate the mdat box header.
    const truncated = bytes.slice(0, bytes.length - 72).buffer;
    const report = inspectMp4(truncated);
    expect(report.valid).toBe(false);
    expect(report.errors.some((message) => message.includes('mdat'))).toBe(true);
  });

  it('rejects a WebM file renamed to .mp4', () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(looksLikeWebm(webm)).toBe(true);
    expect(looksLikeMp4(webm)).toBe(false);
    const report = inspectMp4(webm.buffer);
    expect(report.valid).toBe(false);
    expect(report.errors[0]).toContain('ftyp');
  });

  it('rejects tiny buffers', () => {
    const report = inspectMp4(new Uint8Array([0, 0, 0, 8]).buffer);
    expect(report.valid).toBe(false);
  });
});
