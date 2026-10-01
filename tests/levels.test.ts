import { describe, expect, it } from 'vitest';
import { levels, getLevel, testInputs } from '../src/levels';
import { judge, simulate } from '../src/simulator';
import { validateCircuit } from '../src/model';
import { referenceCircuit } from './fixtures';

const caseCounts = [2, 4, 2, 4, 4, 4, 4, 8, 8, 4, 16, 512, 16, 256, 4, 8, 32, 512, 16, 256];

describe('all twenty lesson contracts and legal solutions', () => {
  it('has consecutive ids and enumerates every input exactly once', () => {
    expect(levels.map(level => level.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const level of levels) {
      const samples = testInputs(level.id);
      expect(samples).toHaveLength(caseCounts[level.id - 1]);
      expect(new Set(samples.map(sample => JSON.stringify(sample))).size).toBe(samples.length);
      for (const sample of samples) for (const port of level.inputPorts) {
        expect(sample[port.id]).toBeGreaterThanOrEqual(0);
        expect(sample[port.id]).toBeLessThan(2 ** port.bits);
      }
    }
  });

  for (let id = 1; id <= 20; id++) {
    it(`lesson ${id} has a legal solution for its entire truth table`, () => {
      const circuit = referenceCircuit(id);
      expect(validateCircuit(circuit)).toEqual([]);
      const result = judge(circuit);
      expect(result.error).toBeUndefined();
      expect(result.passed, JSON.stringify(result.failure)).toBe(true);
      expect(result.rows).toHaveLength(caseCounts[id - 1]);
      expect(result.rows.every(row => row.mismatches.length === 0)).toBe(true);
    }, 30000);
  }

  it('checks independent sum, carry, difference and borrow examples', () => {
    expect(getLevel(18).expectedOutputs({ A: 15, B: 15, Cin: 1 })).toEqual({ Sum: 15, Cout: 1 });
    expect(getLevel(19).expectedOutputs({ A: 15 })).toEqual({ Y: 0, Cout: 1 });
    expect(getLevel(20).expectedOutputs({ A: 0, B: 1 })).toEqual({ Diff: 15, Borrow: 1 });
    expect(getLevel(20).expectedOutputs({ A: 15, B: 0 })).toEqual({ Diff: 15, Borrow: 0 });
    expect(getLevel(10).expectedOutputs({ A: 1, S: 0 })).toEqual({ Y0: 1, Y1: 0 });
    expect(getLevel(10).expectedOutputs({ A: 1, S: 1 })).toEqual({ Y0: 0, Y1: 1 });
  });

  it('reproduces a multi-output counterexample with the reported inputs', () => {
    const wrong = referenceCircuit(18);
    wrong.wires = wrong.wires.filter(wire => wire.target !== 'Cout');
    const result = judge(wrong);
    expect(result.passed).toBe(false);
    expect(result.failure?.mismatches).toContain('Cout');
    const reproduced = simulate(wrong, result.failure!.inputs);
    for (const output of getLevel(18).outputPorts) {
      expect(reproduced.values[output.id]).toEqual(result.failure!.actualOutputs[output.id]);
    }
  });
});
