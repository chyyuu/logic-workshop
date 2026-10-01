import { describe, expect, it } from 'vitest';
import { architectureLibrary, architectureReferenceCircuit } from './architecture-fixtures';
import { getPorts, validateCircuit, validateLibrary } from '../src/model';
import { encapsulateSelection, expandComponent, packageCircuit } from '../src/components';
import { judge, replaySequence } from '../src/simulator';
import { architecturePrograms, encodeInstruction } from '../src/architectureSpec';
import type { ComponentLibrary, SimulationStep } from '../src/contracts';

function expandedSize(key: string, library: ComponentLibrary): { nodes: number; wires: number; depth: number } {
  const d = library[key]; let nodes = d.graph.nodes.length, wires = d.graph.wires.length, depth = 1;
  for (const n of d.graph.nodes.filter(n => n.type === 'COMPONENT')) {
    const child = expandedSize(n.componentKey!, library);
    nodes += child.nodes; wires += child.wires; depth = Math.max(depth, child.depth + 1);
  }
  return { nodes, wires, depth };
}

describe('inspectable architecture circuits', () => {
  const library = architectureLibrary();
  it('provides deterministic definitions whose dependencies and graph budgets are legal', () => {
    expect(architectureLibrary()).toEqual(library);
    expect(validateLibrary(library)).toEqual([]);
    for (const [key, definition] of Object.entries(library)) {
      expect(definition.graph.nodes.length).toBeLessThanOrEqual(200);
      expect(definition.graph.wires.length).toBeLessThanOrEqual(400);
      const size = expandedSize(key, library);
      expect(size.nodes).toBeLessThanOrEqual(2000); expect(size.wires).toBeLessThanOrEqual(5000); expect(size.depth).toBeLessThanOrEqual(16);
      expect(definition.sourceLevel).toBeGreaterThan(0);
      expect(definition.graph.nodes.every(n => ['INPUT', 'OUTPUT', 'COMPONENT', 'NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'SPLIT', 'JOIN', 'CONST', 'DFF', 'ROM', 'RAM'].includes(n.type))).toBe(true);
    }
  });
  for (let id = 33; id <= 44; id++) {
    it(`lesson ${id} reference passes the independent lesson tests`, () => {
      const circuit = architectureReferenceCircuit(id);
      expect(validateCircuit(circuit, library)).toEqual([]);
      const result = judge(circuit, library);
      expect(result.error).toBeUndefined(); expect(result.failure).toBeUndefined(); expect(result.passed).toBe(true);
    }, 180000);
  }
  it('CPU visibly consists of independent phase, PC, IR, controller, data path and memory blocks', () => {
    const circuit = architectureReferenceCircuit(44), ids = circuit.nodes.map(n => n.id);
    expect(ids).toEqual(expect.arrayContaining(['phase', 'pc', 'instruction-register', 'controller', 'datapath', 'program', 'memory']));
    expect(circuit.nodes.find(n => n.id === 'program')).toMatchObject({ type: 'ROM', bits: 16, words: architecturePrograms[0].words });
    expect(circuit.nodes.find(n => n.id === 'memory')).toMatchObject({ type: 'RAM', bits: 8 });
    expect(circuit.nodes.find(n => n.id === 'Memory')).toMatchObject({ type: 'OUTPUT', bits: 8 });
    expect(circuit.wires.find(w => w.target === 'Memory')).toMatchObject({ source: 'memory', sourceHandle: 'q', targetHandle: 'in' });
    const rectangles = circuit.nodes.map(n => {
      const p = getPorts(n, library);
      return { id: n.id, x: n.position.x, y: n.position.y,
        width: ['COMPONENT', 'ROM', 'RAM', 'DFF'].includes(n.type) ? 180 : 130,
        height: Math.max(106, 46 + Math.max(p.inputs.length, p.outputs.length) * 25) };
    });
    expect(Math.max(...rectangles.map(r => r.x + r.width))).toBeLessThan(1900);
    expect(Math.max(...rectangles.map(r => r.y + r.height))).toBeLessThan(1400);
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
        `${a.id} overlaps ${b.id}`).toBe(true);
    }
  });
  it('expanding and packaging the data path preserves sequential behavior across feedback boundaries', () => {
    const circuit = architectureReferenceCircuit(43), expanded = expandComponent(circuit, 'reference', library);
    const words = [encodeInstruction(1, 0, 255), encodeInstruction(1, 1, 1), encodeInstruction(2), encodeInstruction(8), encodeInstruction(3), encodeInstruction(8), 0xa000, encodeInstruction(1, 0, 99)];
    const steps: SimulationStep[] = words.map(Instruction => ({ inputs: { Instruction, Data: 0, Exec: 1, R: 0 }, tick: true }));
    steps.push({ inputs: { Instruction: 0, Data: 0, Exec: 0, R: 1 }, tick: true });
    const expected = replaySequence(circuit, library, steps);
    expect(replaySequence(expanded, library, steps).trace).toEqual(expected.trace);
    const packaged = packageCircuit(expanded, '数据通路验收封装', library);
    expect(validateLibrary(packaged.library)).toEqual([]);
    expect(packaged.definition.dependencies).toContain('architecture-controller@1');
    const selected = expanded.nodes.filter(n => !['INPUT', 'OUTPUT'].includes(n.type)).map(n => n.id);
    const encapsulated = encapsulateSelection(expanded, selected, '可回放数据通路', library);
    expect(replaySequence(encapsulated.circuit, encapsulated.library, steps).trace).toEqual(expected.trace);
  }, 30_000);
});
