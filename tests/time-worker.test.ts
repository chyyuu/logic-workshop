import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Circuit, ComponentLibrary, Inputs, Simulation } from '../src/contracts';
import { createCircuit } from '../src/model';
import { sequentialReferenceCircuit } from './sequential-fixtures';
import { testSequences } from '../src/levels';
import { referenceCircuit } from './fixtures';

let receive: (event: { data: Record<string, unknown> }) => void;
let response: { result?: Simulation; error?: string };
let requestId = 0;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('addEventListener', (_type: string, listener: typeof receive) => { receive = listener; });
  vi.stubGlobal('postMessage', (message: typeof response) => { response = structuredClone(message); });
  await import('../src/simulation.worker');
});
afterEach(() => vi.unstubAllGlobals());

function request(operation: string, circuit: Circuit, inputs: Inputs = {}, library: ComponentLibrary = {}, extra: Record<string, unknown> = {}): Simulation {
  receive({ data: { id: ++requestId, operation, circuit, inputs, library, sessionKey: 'session-a', ...extra } });
  if (response.error) throw new Error(response.error);
  return response.result!;
}

function registerFixture(): { circuit: Circuit; library: ComponentLibrary } {
  const circuit = createCircuit(21);
  circuit.nodes.push({ id: 'memory', type: 'COMPONENT', label: 'register', componentKey: 'register@1', position: { x: 300, y: 100 } });
  circuit.wires.push({ id: 'input', source: 'D', sourceHandle: 'out', target: 'memory', targetHandle: 'A' },
    { id: 'output', source: 'memory', sourceHandle: 'Y', target: 'Q', targetHandle: 'in' });
  const position = { x: 0, y: 0 };
  const library: ComponentLibrary = { 'register@1': { id: 'register', version: 1, name: 'register',
    inputs: [{ id: 'A', label: 'A', bits: 1 }], outputs: [{ id: 'Y', label: 'Y', bits: 1 }], dependencies: [],
    graph: { nodes: [{ id: 'A', type: 'INPUT', label: 'A', bits: 1, position },
      { id: 'Y', type: 'OUTPUT', label: 'Y', bits: 1, position },
      { id: 'ff', type: 'DFF', label: 'DFF', bits: 1, position },
      { id: 'zero', type: 'CONST', label: '0', bits: 1, value: 0, position }], wires: [
        { id: 'd', source: 'A', sourceHandle: 'out', target: 'ff', targetHandle: 'd' },
        { id: 'reset', source: 'zero', sourceHandle: 'out', target: 'ff', targetHandle: 'rst' },
        { id: 'q', source: 'ff', sourceHandle: 'q', target: 'Y', targetHandle: 'in' }] } } };
  return { circuit, library };
}

it('holds register state across input edits and discards it on reset or session change', () => {
  const { circuit, library } = registerFixture();
  expect(request('simulate', circuit, { D: 1 }, library).values.Q).toBe(0);
  const advanced = request('tick', circuit, { D: 1 }, library);
  expect(advanced.values.Q).toBe(1);
  expect(advanced.state?.cycle).toBe(1);
  const held = request('simulate', circuit, { D: 0 }, library);
  expect(held.values.Q).toBe(1);
  expect(held.state?.cycle).toBe(1);
  expect(held.trace?.at(-1)).toEqual({ cycle: 1, inputs: { D: 0 }, outputs: { Q: 1 }, tick: false });
  const cleared = request('reset', circuit, { D: 1 }, library);
  expect(cleared.values.Q).toBe(0);
  expect(cleared.state?.cycle).toBe(0);
  expect(cleared.trace).toHaveLength(1);
  request('tick', circuit, { D: 1 }, library);
  const changed = request('simulate', circuit, { D: 1 }, library, { sessionKey: 'new-electrical-graph' });
  expect(changed.values.Q).toBe(0);
  expect(changed.state?.cycle).toBe(0);
  expect(changed.trace).toHaveLength(1);
});

it('bounds traces to the last 64 observations and avoids identical input observation duplicates', () => {
  const circuit = createCircuit(1), library: ComponentLibrary = {};
  circuit.wires.push({ id: 'identity', source: 'A', sourceHandle: 'out', target: 'Y', targetHandle: 'in' });
  request('simulate', circuit, { A: 1 }, library);
  expect(request('simulate', circuit, { A: 1 }, library).trace).toHaveLength(1);
  let result: Simulation;
  for (let i = 0; i < 70; i++) result = request('tick', circuit, { A: i % 2 }, library);
  expect(result!.state?.cycle).toBe(70);
  expect(result!.trace).toHaveLength(64);
  expect(result!.trace?.[0].cycle).toBe(7);
  expect(result!.trace?.at(-1)?.cycle).toBe(70);
});

it('replays the scenario prefix from cleared state and continues from the restored register state', () => {
  const circuit = sequentialReferenceCircuit(26);
  request('tick', circuit, { E: 1, R: 0 });
  request('tick', circuit, { E: 1, R: 0 });
  request('tick', circuit, { E: 1, R: 0 });
  const scenarioId = testSequences(26)[0].id;
  // Steps 0..4: initial observation, reset edge, increment edge, observation, paused edge.
  const replayed = request('replay', circuit, {}, {}, { scenarioId, stepIndex: 4 });
  expect(replayed.values.Q).toBe(1);
  expect(replayed.state?.cycle).toBe(3);
  expect(replayed.trace?.map(frame => frame.cycle)).toEqual([0, 1, 2, 2, 3]);
  const observed = request('simulate', circuit, { E: 0, R: 0 });
  expect(observed.values.Q).toBe(1);
  expect(observed.trace).toHaveLength(5);
  const continued = request('tick', circuit, { E: 1, R: 0 });
  expect(continued.values.Q).toBe(2);
  expect(continued.state?.cycle).toBe(4);
  const restarted = request('replay', circuit, {}, {}, { scenarioId, stepIndex: 0 });
  expect(restarted.state?.cycle).toBe(0);
  expect(restarted.values.Q).toBe(0);
  expect(restarted.trace).toHaveLength(1);
});

it('rejects invalid replay targets while keeping the active circuit state', () => {
  const circuit = sequentialReferenceCircuit(26), scenarioId = testSequences(26)[0].id;
  request('tick', circuit, { E: 1, R: 0 });
  expect(() => request('replay', circuit, {}, {}, { scenarioId, stepIndex: -1 })).toThrow(/场景或步骤/);
  expect(() => request('replay', circuit, {}, {}, { scenarioId: 'missing', stepIndex: 0 })).toThrow(/场景或步骤/);
  expect(request('simulate', circuit, { E: 0, R: 0 }).values.Q).toBe(1);
});

it('verifies every proof through lesson thirty-two without changing the live register state', () => {
  const circuit = sequentialReferenceCircuit(26);
  request('tick', circuit, { E: 1, R: 0 });
  const proofs = Object.fromEntries(Array.from({ length: 32 }, (_, index) => {
    const id = index + 1;
    return [id, id <= 20 ? referenceCircuit(id) : sequentialReferenceCircuit(id)];
  }));
  const verified = request('verify', circuit, {}, {}, { proofs }) as unknown as Record<number, Circuit>;
  expect(Object.keys(verified)).toHaveLength(32);
  expect(verified[32].levelId).toBe(32);
  request('judge', circuit);
  const held = request('simulate', circuit, { E: 0, R: 0 });
  expect(held.values.Q).toBe(1);
  expect(held.state?.cycle).toBe(1);
}, 30_000);
