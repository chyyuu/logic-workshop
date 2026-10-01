import { judge, replaySequence, simulate } from './simulator';
import { levels, testSequences } from './levels';
import { parseWorkspace } from './storage';
import type { Circuit, ComponentLibrary, Inputs, RuntimeState, Simulation, SimulationFrame } from './contracts';

interface Request {
  id: number;
  operation: 'simulate' | 'judge' | 'verify' | 'load' | 'tick' | 'reset' | 'replay';
  circuit?: Circuit;
  inputs?: Inputs;
  library?: ComponentLibrary;
  proofs?: Record<number, Circuit>;
  text?: string;
  sessionKey?: string;
  scenarioId?: string;
  stepIndex?: number;
}

let sessionKey: string | undefined;
let runtime: RuntimeState | undefined;
let trace: SimulationFrame[] = [];
let activeProgram: number[] | undefined;

function sameSignals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

function recordFrame(simulation: Simulation, circuit: Circuit, inputs: Inputs, tick: boolean): Simulation {
  runtime = simulation.state;
  const frame: SimulationFrame = {
    cycle: runtime?.cycle ?? 0,
    inputs: Object.fromEntries(circuit.nodes.filter(node => node.type === 'INPUT').map(node => [node.id, inputs[node.id] ?? 0])),
    outputs: Object.fromEntries(circuit.nodes.filter(node => node.type === 'OUTPUT').map(node => [node.id, simulation.values[node.id]])),
    tick,
  };
  const previous = trace.at(-1);
  if (tick || !previous || previous.cycle !== frame.cycle
    || !sameSignals(previous.inputs, frame.inputs) || !sameSignals(previous.outputs, frame.outputs)) {
    trace = [...trace.slice(-63), frame];
  }
  return { ...simulation, trace };
}

function runSession(request: Request): Simulation {
  const circuit = request.circuit;
  if (!circuit) throw new Error('模拟缺少电路。');
  const library = request.library ?? {};
  const key = JSON.stringify({ caller:request.sessionKey,level: circuit.levelId,
    nodes: circuit.nodes.map(({ position: _position, ...node }) => node), wires: circuit.wires, library });
  if (key !== sessionKey || request.operation === 'reset') {
    sessionKey = key;
    runtime = undefined;
    trace = [];
    activeProgram = undefined;
  }
  if (request.operation === 'replay') {
    const scenario = testSequences(circuit.levelId).find(item => item.id === request.scenarioId);
    const stepIndex = request.stepIndex;
    if (!scenario || !Number.isSafeInteger(stepIndex) || stepIndex! < 0 || stepIndex! >= scenario.steps.length) {
      throw new Error('反例场景或步骤无效。');
    }
    const simulation = replaySequence(circuit, library, scenario.steps.slice(0, stepIndex! + 1), scenario.program);
    activeProgram = scenario.program ? [...scenario.program] : undefined;
    runtime = simulation.state;
    trace = simulation.trace?.slice(-64) ?? [];
    return { ...simulation, trace };
  }
  const inputs = request.inputs ?? {};
  const tick = request.operation === 'tick';
  const simulation = simulate(circuit, inputs, library, { state: runtime, tick, program:activeProgram });
  return recordFrame(simulation, circuit, inputs, tick);
}

globalThis.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    let result: unknown;
    if (request.operation === 'load') {
      if (typeof request.text !== 'string') throw new Error('存档内容无效。');
      result = parseWorkspace(request.text);
    } else if (['simulate', 'tick', 'reset', 'replay'].includes(request.operation)) {
      result = runSession(request);
    } else if (request.operation === 'judge') {
      result = judge(request.circuit!, request.library ?? {});
    } else if (request.operation === 'verify') {
      const valid: Record<number, Circuit> = {};
      for (const level of levels) {
        const proof = request.proofs?.[level.id];
        if (!proof || proof.levelId !== level.id || !judge(proof, request.library ?? {}).passed) break;
        valid[level.id] = proof;
      }
      result = valid;
    } else throw new Error('未知模拟任务。');
    globalThis.postMessage({ id: request.id, result });
  } catch (error) {
    globalThis.postMessage({ id: request.id, error: (error as Error).message });
  }
});
