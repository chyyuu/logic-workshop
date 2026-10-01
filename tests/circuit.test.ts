import { describe, it, expect } from 'vitest';
import { createCircuit, connect, addGate, validateCircuit } from '../src/model';
import { simulate, judge } from '../src/simulator';

function solution(level: number) {
  let c = createCircuit(level);
  if (level === 1) return connect(c, 'A', 'out', 'Y', 'in');
  c = addGate(c, 'NAND', { x: 350, y: 160 }, 'g1');
  c = connect(c, 'A', 'out', 'g1', 'a');
  c = connect(c, level === 3 ? 'A' : 'B', 'out', 'g1', 'b');
  if (level === 4) {
    c = addGate(c, 'NOT', { x: 520, y: 160 }, 'g2');
    c = connect(c, 'g1', 'out', 'g2', 'a');
    return connect(c, 'g2', 'out', 'Y', 'in');
  }
  return connect(c, 'g1', 'out', 'Y', 'in');
}

describe('four lesson truth tables through DigitalJS', () => {
  for (const level of [1, 2, 3, 4]) {
    it(`passes all inputs for lesson ${level}`, () => {
      const result = judge(solution(level));
      expect(result.passed).toBe(true);
      expect(result.rows).toHaveLength(level === 1 || level === 3 ? 2 : 4);
    });
  }
  it('shows unconnected output as X', () => {
    expect(simulate(createCircuit(1), { A: 0 }).values.Y).toBe('X');
  });
  it('preserves NAND controlling-zero behavior with one unknown input', () => {
    let c = addGate(createCircuit(2), 'NAND', { x: 300, y: 120 }, 'g');
    c = connect(c, 'A', 'out', 'g', 'a');
    c = connect(c, 'g', 'out', 'Y', 'in');
    expect(simulate(c, { A: 0, B: 1 }).values.Y).toBe(1);
    expect(simulate(c, { A: 1, B: 0 }).values.Y).toBe('X');
    expect(judge(c).passed).toBe(false);
  });
  it('returns the actual failing input and independent expected output', () => {
    const wrong = connect(createCircuit(4), 'A', 'out', 'Y', 'in');
    const result = judge(wrong);
    expect(result.failure).toMatchObject({ inputs: { A: 1, B: 0 }, actual: 1, expected: 0 });
  });
  it('allows fan-out but rejects a second input driver', () => {
    let c = solution(2);
    expect(() => connect(c, 'A', 'out', 'g1', 'b')).toThrow(/已经/);
    c = addGate(c, 'NAND', { x: 400, y: 300 }, 'g2');
    expect(() => connect(c, 'A', 'out', 'g2', 'a')).not.toThrow();
  });
  it('rejects cycles before simulation', () => {
    let c = addGate(createCircuit(2), 'NAND', { x: 200, y: 100 }, 'g1');
    c = addGate(c, 'NAND', { x: 400, y: 100 }, 'g2');
    c = connect(c, 'g1', 'out', 'g2', 'a');
    expect(() => connect(c, 'g2', 'out', 'g1', 'a')).toThrow(/回路/);
  });
  it('rejects forbidden gates and missing mandatory ports on imported circuits', () => {
    expect(() => addGate(createCircuit(3), 'NOT', { x: 0, y: 0 })).toThrow();
    const c = createCircuit(1);
    c.nodes = c.nodes.filter(n => n.id !== 'Y');
    expect(validateCircuit(c).length).toBeGreaterThan(0);
  });
});
