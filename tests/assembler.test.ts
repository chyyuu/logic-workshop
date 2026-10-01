import { describe, expect, it } from 'vitest';
import { assemble, disassemble } from '../src/assembler';

describe('byte CPU assembler', () => {
  it('resolves forward labels and keeps source lines in its listing', () => {
    const result = assemble('; 开始\n  jmp later\nfirst: movi a, 0x2a ; 值\n MOVI B, 13\nlater: OUT\n jz first\n HLT');
    expect(result.words).toEqual([0x6003, 0x102a, 0x110d, 0x8000, 0x7001, 0x9000]);
    expect(result.labels).toEqual({ first: 1, later: 3 });
    expect(result.listing[1]).toEqual({ address: 1, word: 0x102a, line: 3, text: 'first: movi a, 0x2a ; 值' });
  });

  it('accepts empty source and the full 256-word address space', () => {
    expect(assemble(' ; 还没有程序\n')).toEqual({ words: [], listing: [], labels: {} });
    const source = Array(255).fill('NOP').concat('last: HLT').join('\n');
    expect(assemble(source).labels.last).toBe(255);
    expect(assemble(source).words).toHaveLength(256);
    expect(() => assemble(source + '\nNOP')).toThrow(/第 257 行/);
    expect(() => assemble(source + '\nend:')).toThrow(/第 257 行/);
  });

  it.each([
    'MOVI A, 256', 'MOVI B, -1', 'MOVI C, 2', 'MOVI A 2', 'LOAD 0x100',
    'JMP absent', 'NOP 1', 'ADD A', 'OUT,', 'UNKNOWN', 'JZ -2',
    'bad-label: NOP', 'x: NOP\nx: HLT', 'MOVI A, target\ntarget: HLT',
  ])('rejects invalid operands and labels with a source line: %s', source => {
    expect(() => assemble('; comment\n' + source)).toThrow(/第 \d+ 行/);
  });

  it('round trips every legal instruction word and rejects reserved encodings', () => {
    const words = [0, 0x1000, 0x10ff, 0x1100, 0x11ff, 0x2000, 0x3000, 0x4000, 0x40ff, 0x5000, 0x60ff, 0x70ff, 0x8000, 0x9000];
    expect(assemble(disassemble(words)).words).toEqual(words);
    for (const word of [0x0001, 0x1200, 0x2001, 0x41ff, 0xa000, -1, 65536, 1.5, NaN]) {
      expect(() => disassemble([word])).toThrow(/地址 0/);
    }
  });
});
