import { describe, expect, it } from 'vitest';
import { chapters, getLevel, levels, testInputs, testSequences } from '../src/levels';
import { architectureOracle, architecturePrograms, decodeInstruction, encodeInstruction, instructionControl } from '../src/architectureSpec';
import { architectureLibrary, architectureReferenceCircuit } from '../src/architectureCircuits';
import { validateCircuit } from '../src/model';
import { judge, replaySequence } from '../src/simulator';

describe('architecture curriculum', () => {
  it('exposes the twelve architecture lessons with workable temporal scenarios', () => {
    expect(levels.map(level => level.id)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
    expect(chapters[5]).toBe('计算机架构');
    for (let id = 33; id <= 44; id++) {
      const level = getLevel(id);
      expect(level.chapter).toBe(6);
      if (level.mode === 'sequential') {
        const sequences = testSequences(id);
        expect(sequences.length).toBeGreaterThan(0);
        expect(sequences.some(s => s.steps.some(row => !row.tick))).toBe(true);
        expect(sequences.some(s => s.steps.some(row => row.tick && row.inputs.R === 1))).toBe(true);
        for (const sequence of sequences) for (const row of sequence.steps) {
          expect(Object.keys(row.inputs).sort()).toEqual(level.inputs.slice().sort());
          expect(Object.keys(row.expectedOutputs).sort()).toEqual(level.outputPorts.map(p => p.id).sort());
        }
      }
    }
  });

  it('bounds ALU sampling while testing every byte and exhausts instruction encoding', () => {
    for (const id of [33, 34]) {
      const cases = testInputs(id);
      expect(cases.length).toBeLessThan(20000);
      expect(new Set(cases.map(i => i.A)).size).toBe(256);
      expect(new Set(cases.map(i => i.B)).size).toBe(256);
    }
    expect(testInputs(37)).toHaveLength(65536);
    expect(testInputs(40).length).toBeLessThan(12000);
  });

  it('computes byte overflow and clears inactive flags', () => {
    expect(getLevel(33).expectedOutputs({ A: 255, B: 1, Sub: 0 })).toEqual({ Y: 0, Carry: 1, Borrow: 0, Z: 1 });
    expect(getLevel(33).expectedOutputs({ A: 0, B: 1, Sub: 1 })).toEqual({ Y: 255, Carry: 0, Borrow: 1, Z: 0 });
    expect(getLevel(34).expectedOutputs({ A: 255, B: 255, Op: 3 })).toEqual({ Y: 0, Carry: 0, Borrow: 0, Z: 1 });
  });

  it('rejects reserved instruction bits while splitting the complete sixteen-bit word', () => {
    expect(encodeInstruction(1, 1, 255)).toBe(0x11ff);
    expect(decodeInstruction(0x11ff)).toEqual({ opcode: 1, param: 1, imm: 255, valid: true, name: 'MOVI' });
    expect(decodeInstruction(0x40ff)).toEqual({ opcode: 4, param: 0, imm: 255, valid: true, name: 'LOAD' });
    expect(decodeInstruction(0xfabc)).toEqual({ opcode: 15, param: 10, imm: 188, valid: false, name: 'INVALID' });
    for (const word of [0x0001, 0x0100, 0x1200, 0x2001, 0x3100, 0x4100, 0x5100, 0x6100, 0x7100, 0x8001, 0x9001]) expect(decodeInstruction(word).valid).toBe(false);
    for (const word of [0, 0x1000, 0x1100, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000, 0x7000, 0x8000, 0x9000]) expect(decodeInstruction(word).valid).toBe(true);
  });

  it('gates controller signals by phase and validity and tests conditional zero', () => {
    const empty = { WA: 0, WB: 0, ALUOp: 0, MemWrite: 0, MemRead: 0, Jump: 0, OutWrite: 0, Halt: 0, Invalid: 0 };
    expect(instructionControl({ Instruction: 0x3000, Phase: 2, Z: 0 })).toEqual({ ...empty, WA: 1, ALUOp: 1 });
    expect(instructionControl({ Instruction: 0x11ff, Phase: 2, Z: 0 })).toEqual({ ...empty, WB: 1 });
    for (const Phase of [0, 1, 3]) expect(instructionControl({ Instruction: 0x3000, Phase, Z: 1 })).toEqual(empty);
    for (const Phase of [0, 1, 2, 3]) expect(instructionControl({ Instruction: 0x3001, Phase, Z: 1 })).toEqual({ ...empty, Invalid: 1 });
    expect(instructionControl({ Instruction: 0x70ff, Phase: 2, Z: 0 })).toEqual(empty);
    expect(instructionControl({ Instruction: 0x70ff, Phase: 2, Z: 1 })).toEqual({ ...empty, Jump: 1 });
  });

  it('executes three phases using old PC, old A, initial Z=0, and synchronous stopping/reset', () => {
    const run = architectureOracle(44, [0x7003, 0x1000, 0x7004, 0x1063, 0x8000, 0x9000]);
    const tick = () => run({ E: 1, R: 0 }, true);
    expect(run({ E: 0, R: 0 }, false)).toEqual({ PC: 0, IR: 0, Phase: 0, A: 0, B: 0, Z: 0, Out: 0, Halt: 0, Fault: 0, Memory: 0 });
    expect(tick()).toMatchObject({ PC: 0, IR: 0x7003, Phase: 1 });
    expect(tick()).toMatchObject({ PC: 0, Phase: 2 });
    expect(tick()).toMatchObject({ PC: 1, Phase: 0 });
    tick(); tick();
    expect(tick()).toMatchObject({ PC: 2, A: 0, Z: 1 });
    tick(); tick();
    expect(tick()).toMatchObject({ PC: 4, Phase: 0 });
    tick(); tick(); tick(); tick(); tick();
    const halted = tick();
    expect(halted).toMatchObject({ PC: 5, IR: 0x9000, Phase: 2, Halt: 1, Fault: 0 });
    expect(tick()).toEqual(halted);
    expect(run({ E: 0, R: 1 }, false)).toEqual(halted);
    expect(run({ E: 0, R: 1 }, true)).toEqual({ PC: 0, IR: 0, Phase: 0, A: 0, B: 0, Z: 0, Out: 0, Halt: 0, Fault: 0, Memory: 0 });
  });

  it('locks illegal datapath instructions without side effects and preserves combinational address outputs', () => {
    const run = architectureOracle(43);
    run({ Instruction: 0x1025, Data: 0, Exec: 1, R: 0 }, true);
    run({ Instruction: 0x1107, Data: 0, Exec: 1, R: 0 }, true);
    expect(run({ Instruction: 0x51ff, Data: 255, Exec: 1, R: 0 }, true)).toEqual({ A: 37, B: 7, Z: 0, Out: 0, Halt: 1, Fault: 1, Jump: 0, Target: 255, Addr: 255, Store: 37, MemWrite: 0, MemRead: 0 });
    expect(run({ Instruction: 0x1000, Data: 0, Exec: 1, R: 0 }, true)).toMatchObject({ A: 37, B: 7, Z: 0, Halt: 1, Fault: 1 });
    expect(run({ Instruction: 0x40fe, Data: 0, Exec: 1, R: 1 }, true)).toEqual({ A: 0, B: 0, Z: 0, Out: 0, Halt: 0, Fault: 0, Jump: 0, Target: 254, Addr: 254, Store: 0, MemWrite: 0, MemRead: 1 });
  });

  it('keeps CPU programs finite and includes wrap, high RAM, both conditional branches and fault isolation', () => {
    const sequences = testSequences(44);
    expect(sequences.reduce((sum, s) => sum + s.steps.length, 0)).toBeLessThan(1000);
    expect(getLevel(38).defaultProgram).toEqual(architecturePrograms[0].words);
    expect(getLevel(44).defaultProgram).toEqual(architecturePrograms[0].words);
    expect(sequences.map(s => s.program)).toEqual(architecturePrograms.map(p => p.words));
    const beforeReset = (index: number) => sequences[index].steps.slice(0, -6).filter(s => s.inputs.R === 0);
    expect(beforeReset(0).at(-1)!.expectedOutputs).toMatchObject({ Out: 12, Halt: 1, Fault: 0 });
    expect(beforeReset(2).some(s => s.expectedOutputs.PC === 1)).toBe(true);
    expect(beforeReset(2).some(s => s.expectedOutputs.PC === 5)).toBe(true);
    expect(beforeReset(3).some(s => s.expectedOutputs.Out === 165)).toBe(true);
    expect(beforeReset(3).some(s => s.expectedOutputs.Out === 90)).toBe(true);
    const wrap = beforeReset(4);
    expect(wrap.some(s => s.expectedOutputs.PC === 255 && s.expectedOutputs.IR === 0x8000)).toBe(true);
    expect(wrap.some(s => s.expectedOutputs.PC === 0 && s.expectedOutputs.Out === 77)).toBe(true);
    for (let index = 5; index < 9; index++) expect(beforeReset(index).at(-1)!.expectedOutputs).toMatchObject({ A: 23, Out: 0, Halt: 1, Fault: 1, Phase: 2, PC: 1 });
    const resetMemory = sequences.at(-1)!;
    expect(resetMemory.program).toEqual([0x40ff, 0x8000, 0x10a5, 0x50ff, 0x9000]);
    expect(resetMemory.steps.some(s => s.expectedOutputs.Memory === 165)).toBe(true);
    expect(resetMemory.steps.at(-1)!.expectedOutputs).toMatchObject({ IR: 0x40ff, A: 0, Memory: 0 });
  });

  it.each(['reset', 'enable'])('detects missing RAM %s wiring and replays its Memory counterexample', fault => {
    const library = architectureLibrary(), wrong = architectureReferenceCircuit(44);
    const ram = wrong.nodes.find(node => node.type === 'RAM')!;
    const wire = wrong.wires.find(w => w.target === ram.id && w.targetHandle === (fault === 'reset' ? 'rst' : 'we'))!;
    if (fault === 'reset') {
      wrong.nodes.push({ id: 'disabled-ram-reset', type: 'CONST', label: 'CONST', bits: 1, value: 0, position: { x: 0, y: 0 } });
      wire.source = 'disabled-ram-reset'; wire.sourceHandle = 'out';
    } else {
      const controller = wrong.nodes.find(node => node.type === 'COMPONENT' && node.componentKey === 'architecture-controller@1')!;
      wire.source = controller.id; wire.sourceHandle = 'MemWrite';
    }
    expect(validateCircuit(wrong, library)).toEqual([]);
    const result = judge(wrong, library), failure = result.failure!;
    expect(result.error).toBeUndefined();
    expect(result.passed).toBe(false);
    expect(failure.mismatches).toContain('Memory');
    if (fault === 'enable') expect(failure.inputs.E).toBe(0);
    const sequence = testSequences(44).find(s => s.id === failure.scenarioId)!;
    const prefix = sequence.steps.slice(0, failure.stepIndex! + 1);
    const replay = replaySequence(wrong, library, prefix, sequence.program);
    expect(replay.trace!.at(-1)!.outputs.Memory).toBe(failure.actualOutputs.Memory);
    const correct = replaySequence(architectureReferenceCircuit(44), library, prefix, sequence.program);
    expect(correct.trace!.at(-1)!.outputs.Memory).toBe(failure.expectedOutputs.Memory);
  }, 60000);

  it('replays a program counterexample with its program and full state prefix', () => {
    const wrong = architectureReferenceCircuit(44), library = architectureLibrary();
    const out = wrong.wires.find(w => w.target === 'Out')!;
    const a = wrong.wires.find(w => w.target === 'A')!;
    out.source = a.source; out.sourceHandle = a.sourceHandle;
    const result = judge(wrong, library), failure = result.failure!;
    expect(result.error).toBeUndefined();
    expect(failure).toBeDefined();
    expect(failure.stepIndex).toBeGreaterThan(0);
    const sequence = testSequences(44).find(s => s.id === failure.scenarioId)!;
    const prefix = sequence.steps.slice(0, failure.stepIndex! + 1);
    const first = replaySequence(wrong, library, prefix, sequence.program);
    expect(replaySequence(wrong, library, prefix, sequence.program)).toEqual(first);
    expect(first.trace!.at(-1)!.outputs).toEqual(failure.actualOutputs);
    expect(first.state!.cycle).toBe(failure.cycle);
    const correct = replaySequence(architectureReferenceCircuit(44), library, prefix, sequence.program);
    expect(correct.trace!.at(-1)!.outputs).toEqual(failure.expectedOutputs);
  }, 60000);
});
