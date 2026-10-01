import { describe, it, expect } from 'vitest';
import { parseProgramText, formatProgramText } from '../src/programEditor';

describe('ROM program editing', () => {
  it('round trips all 256 instruction words and preserves leading zero values', () => {
    const words = Array.from({ length: 256 }, (_, i) => i * 257);
    expect(parseProgramText(formatProgramText(words))).toEqual(words);
    expect(parseProgramText('0000\n0x10FF, 9000')).toEqual([0, 4351, 36864]);
  });
  it('rejects malformed, overflowing and excessive ROM content before a circuit commit', () => {
    for (const text of ['10000', '-1', '1.5', '0b1010', 'GGGG']) expect(() => parseProgramText(text)).toThrow();
    expect(() => parseProgramText(Array(257).fill('0000').join('\n'))).toThrow('256');
    expect(parseProgramText(' \n ')).toEqual([]);
  });
});
