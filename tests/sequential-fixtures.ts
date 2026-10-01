import type { Circuit, GateType } from '../src/contracts';
import { getLevel } from '../src/levels';

type Pin = { node: string; port: string };
class Builder {
  circuit: Circuit;
  private count = 0;
  private rowY = 60;
  private rowHeight = 120;
  constructor(id: number) {
    const level = getLevel(id);
    this.circuit = { levelId: id, revision: 0, wires: [], nodes: [
      ...level.inputPorts.map((p, index) => ({ id: p.id, label: p.id, type: 'INPUT' as const, bits: p.bits, position: { x: 70, y: 60 + index * 150 } })),
      ...level.outputPorts.map((p, index) => ({ id: p.id, label: p.id, type: 'OUTPUT' as const, bits: p.bits, position: { x: 1440, y: 80 + index * 160 } })),
    ] };
  }
  input(node: string, port = 'out'): Pin { return { node, port }; }
  wire(source: Pin, node: string, targetHandle: string) {
    this.circuit.wires.push({ id: `w${this.circuit.wires.length + 1}`, source: source.node, sourceHandle: source.port, target: node, targetHandle });
  }
  node(type: GateType, bits = 1, value?: number): string {
    const id = `g${++this.count}`;
    const column = (this.count - 1) % 5;
    if (column === 0 && this.count > 1) {
      this.rowY += this.rowHeight + 44;
      this.rowHeight = 120;
    }
    this.rowHeight = Math.max(this.rowHeight, type === 'JOIN' || type === 'SPLIT' ? bits * 25 + 46 : 120);
    this.circuit.nodes.push({ id, type, label: type, bits, ...(value === undefined ? {} : { value }),
      position: { x: 270 + column * 220, y: this.rowY } });
    return id;
  }
  output(source: Pin, id = 'Q') { this.wire(source, id, 'in'); }
  gate(type: GateType, a: Pin, b?: Pin, bits = 1): Pin {
    const node = this.node(type, bits);
    this.wire(a, node, 'a');
    if (b) this.wire(b, node, 'b');
    return this.input(node);
  }
  constant(value: number, bits = 1) { return this.input(this.node('CONST', bits, value)); }
  split(source: Pin, bits: number): Pin[] {
    const node = this.node('SPLIT', bits); this.wire(source, node, 'in');
    return Array.from({ length: bits }, (_, bit) => this.input(node, `out${bit}`));
  }
  join(values: Pin[]): Pin {
    const node = this.node('JOIN', values.length);
    values.forEach((source, bit) => this.wire(source, node, `in${bit}`));
    return this.input(node);
  }
  mux(a: Pin, b: Pin, select: Pin, bits = 1): Pin {
    const selected = bits === 1 ? select : this.join(Array(bits).fill(select) as Pin[]);
    const inverse = this.gate('NOT', selected, undefined, bits);
    return this.gate('OR', this.gate('AND', a, inverse, bits), this.gate('AND', b, selected, bits), bits);
  }
  register(bits: number, reset: Pin) {
    const node = this.node('DFF', bits); this.wire(reset, node, 'rst');
    return { node, q: this.input(node, 'q') };
  }
  enabled(bits: number, data: Pin, enable: Pin, reset: Pin): Pin {
    const { node, q } = this.register(bits, reset);
    this.wire(this.mux(q, data, enable, bits), node, 'd');
    return q;
  }
  increment(source: Pin, down = false): Pin {
    const q = this.split(source, 4), one = this.constant(1);
    let carry = one;
    const result = q.map((bit, index) => {
      const sum = this.gate('XOR', bit, carry);
      if (index !== 3) carry = this.gate('AND', down ? this.gate('NOT', bit) : bit, carry);
      return sum;
    });
    return this.join(result);
  }
  memory(size: number): Pin {
    const address = size === 2 ? [this.input('Addr')] : this.split(this.input('Addr'), 2);
    const inverse = address.map(bit => this.gate('NOT', bit));
    const cells = Array.from({ length: size }, (_, index) => {
      let select = index & 1 ? address[0] : inverse[0];
      if (size === 4) select = this.gate('AND', select, index & 2 ? address[1] : inverse[1]);
      return this.enabled(4, this.input('D'), this.gate('AND', select, this.input('W')), this.input('R'));
    });
    const lower = this.mux(cells[0], cells[1], address[0], 4);
    return size === 2 ? lower : this.mux(lower, this.mux(cells[2], cells[3], address[0], 4), address[1], 4);
  }
}

/** Legal test-only gate-and-DFF solutions; memory uses independent registers and decoded enables. */
export function sequentialReferenceCircuit(id: number): Circuit {
  const b = new Builder(id), reset = id === 21 ? b.constant(0) : b.input('R');
  if (id === 21 || id === 22) {
    const { node, q } = b.register(1, reset); b.wire(b.input('D'), node, 'd'); b.output(q);
  } else if (id === 23 || id === 24) b.output(b.enabled(id === 24 ? 8 : 1, b.input('D'), b.input('E'), reset));
  else if (id === 25) {
    const { node, q } = b.register(1, reset); b.wire(b.gate('XOR', q, b.input('T')), node, 'd'); b.output(q);
  } else if (id === 26 || id === 27) {
    const { node, q } = b.register(4, reset);
    const up = b.increment(q), next = id === 26 ? up : b.mux(up, b.increment(q, true), b.input('Down'), 4);
    b.wire(b.mux(q, next, b.input('E'), 4), node, 'd'); b.output(q);
  } else if (id === 28) {
    const { node, q } = b.register(4, reset), bits = b.split(q, 4);
    const shifted = b.join([b.input('In'), bits[0], bits[1], bits[2]]);
    b.wire(b.mux(q, shifted, b.input('E'), 4), node, 'd'); b.output(q);
  } else if (id === 29) {
    const first = b.enabled(4, b.input('D'), b.input('E'), reset);
    b.output(b.enabled(4, first, b.input('E'), reset));
  } else if (id >= 30 && id <= 32) {
    const memory = b.memory(id === 30 ? 2 : 4);
    b.output(memory, id === 32 ? 'Memory' : 'Q');
    if (id === 32) b.output(b.enabled(4, memory, b.input('Read'), reset), 'Out');
  } else throw new Error(`No sequential reference circuit for lesson ${id}`);
  return b.circuit;
}
