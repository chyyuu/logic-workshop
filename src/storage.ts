import { createCircuit, validateCircuit, validateLibrary } from './model';
import { levels } from './levels';
import { judge } from './simulator';
import { assemble } from './assembler';
import { programmingMachine, programmingMachineLibrary } from './programmingMachine';
import { pruneDeletedComponents } from './componentManagement';
import type { Circuit, CircuitGraph, CircuitNode, ComponentDefinition, ComponentLibrary, Inputs, NodeType, Port, Wire } from './contracts';

export const STORAGE_KEY = 'logic-workshop.v1';
export interface Workspace {
  version: 5;
  currentLevel: number;
  circuits: Record<number, Circuit>;
  proofs: Record<number, Circuit>;
  inputs: Record<number, Inputs>;
  library: ComponentLibrary;
}

export function createWorkspace(): Workspace {
  return { version: 5, currentLevel: 1, proofs: {}, library: programmingMachineLibrary(),
    circuits: Object.fromEntries(levels.map(level => [level.id, level.id >= 45 ? programmingMachine(level.id) : createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, level.id >= 45 && name === 'E' ? 1 : 0]))])) };
}

const nodeTypes: NodeType[] = ['INPUT', 'OUTPUT', 'NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'CONST', 'SPLIT', 'JOIN', 'DFF', 'ROM', 'RAM', 'COMPONENT'];
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const validLabel = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
const validBits = (value: unknown): value is number => value === 1 || value === 2 || value === 4 || value === 8 || value === 16;
function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function parseGraph(raw: unknown): CircuitGraph {
  const graph = record(raw, '电路格式无效。');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.wires) || graph.nodes.length > 2000 || graph.wires.length > 5000) {
    throw new Error('电路格式或规模无效。');
  }
  const nodes: CircuitNode[] = graph.nodes.map(value => {
    const node = record(value, '组件格式无效。');
    const position = record(node.position, '组件位置无效。');
    if (!validId(node.id) || !validLabel(node.label) || !nodeTypes.includes(node.type as NodeType)
      || typeof position.x !== 'number' || typeof position.y !== 'number' || !Number.isFinite(position.x) || !Number.isFinite(position.y)
      || (node.bits !== undefined && !validBits(node.bits))) throw new Error('组件格式或位宽无效。');
    if (node.type === 'COMPONENT' && (typeof node.componentKey !== 'string' || node.componentKey.length > 210)) {
      throw new Error('组件依赖引用无效。');
    }
    const bits = node.bits === undefined ? 1 : node.bits as number;
    if ((node.type === 'ROM' && bits !== 16) || (node.type === 'RAM' && bits !== 8)) {
      throw new Error('存储器位宽无效。');
    }
    if (node.words !== undefined) {
      if (node.type !== 'ROM') throw new Error('只有 ROM 节点可以保存程序。');
      if (!Array.isArray(node.words) || node.words.length > 256
        || node.words.some(word => typeof word !== 'number' || !Number.isInteger(word) || word < 0 || word > 65535)) {
        throw new Error('ROM 程序必须包含至多 256 个十六位整数。');
      }
    }
    if (node.programSource !== undefined) {
      if (node.type !== 'ROM') throw new Error('只有 ROM 节点可以保存汇编源代码。');
      if (typeof node.programSource !== 'string' || node.programSource.length > 32_000) {
        throw new Error('汇编源代码必须为至多 32,000 字符的文本。');
      }
      const words = assemble(node.programSource).words;
      if (!Array.isArray(node.words) || words.length !== node.words.length
        || words.some((word, index) => word !== (node.words as number[])[index])) {
        throw new Error('汇编源代码与 ROM 程序字不一致。');
      }
    }
    if (node.value !== undefined && (typeof node.value !== 'number' || !Number.isInteger(node.value) || node.value < 0 || node.value >= 2 ** bits)) {
      throw new Error('常量数值无效。');
    }
    return { id: node.id, type: node.type as NodeType, label: node.label, position: { x: position.x, y: position.y },
      ...(node.bits === undefined ? {} : { bits }), ...(node.value === undefined ? {} : { value: node.value as number }),
      ...(node.type === 'ROM' && node.words !== undefined ? { words: [...node.words as number[]] } : {}),
      ...(node.type === 'ROM' && node.programSource !== undefined ? { programSource: node.programSource as string } : {}),
      ...(node.type === 'COMPONENT' ? { componentKey: node.componentKey as string } : {}) };
  });
  const wires: Wire[] = graph.wires.map(value => {
    const wire = record(value, '导线格式无效。');
    if (![wire.id, wire.source, wire.target, wire.sourceHandle, wire.targetHandle].every(validId)) throw new Error('导线格式无效。');
    return { id: wire.id as string, source: wire.source as string, target: wire.target as string,
      sourceHandle: wire.sourceHandle as string, targetHandle: wire.targetHandle as string };
  });
  return { nodes, wires };
}

function parseCircuit(raw: unknown, levelId: number, library: ComponentLibrary): Circuit {
  const value = record(raw, '电路格式无效。');
  if (value.levelId !== levelId || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error('电路格式或关卡编号无效。');
  }
  const circuit: Circuit = { levelId, revision: value.revision as number, ...parseGraph(value) };
  const errors = validateCircuit(circuit, library);
  if (errors.length) throw new Error(errors[0]);
  return circuit;
}

function parsePorts(raw: unknown): Port[] {
  if (!Array.isArray(raw) || raw.length > 128) throw new Error('组件接口格式无效。');
  return raw.map(value => {
    const port = record(value, '组件接口格式无效。');
    if (!validId(port.id) || !validLabel(port.label) || !validBits(port.bits)) throw new Error('组件接口或位宽无效。');
    return { id: port.id, label: port.label, bits: port.bits };
  });
}

function parseLibrary(raw: unknown): ComponentLibrary {
  const value = record(raw, '组件库格式无效。');
  if (Object.keys(value).length > 256) throw new Error('组件库超过 256 个版本的限制。');
  const library: ComponentLibrary = {};
  let nodeCount = 0;
  for (const [key, rawDefinition] of Object.entries(value)) {
    const definition = record(rawDefinition, '组件定义格式无效。');
    if (!validId(definition.id) || !validLabel(definition.name) || !Number.isSafeInteger(definition.version)
      || (definition.version as number) < 1 || key !== `${definition.id}@${definition.version}`
      || !Array.isArray(definition.dependencies) || definition.dependencies.length > 256
      || definition.dependencies.some(item => typeof item !== 'string' || item.length > 210)
      || new Set(definition.dependencies).size !== definition.dependencies.length) throw new Error('组件版本或依赖格式无效。');
    if (definition.sourceLevel !== undefined && !levels.some(level => level.id === definition.sourceLevel)) {
      throw new Error('组件来源关卡无效。');
    }
    const graph = parseGraph(definition.graph);
    nodeCount += graph.nodes.length;
    if (nodeCount > 20_000) throw new Error('组件库超过总规模限制。');
    if (definition.deleted !== undefined && definition.deleted !== true) throw new Error('组件删除状态无效。');
    const parsed: ComponentDefinition = { id: definition.id, version: definition.version as number, name: definition.name,
      inputs: parsePorts(definition.inputs), outputs: parsePorts(definition.outputs), graph,
      dependencies: [...definition.dependencies] as string[],
      ...(definition.sourceLevel === undefined ? {} : { sourceLevel: definition.sourceLevel as number }),
      ...(definition.deleted === true ? { deleted: true as const } : {}) };
    library[key] = parsed;
  }
  const errors = validateLibrary(library);
  if (errors.length) throw new Error(errors[0]);
  return library;
}

export function parseWorkspace(text: string, options: { verifyProofs?: boolean } = {}): Workspace {
  if (text.length > 4_000_000) throw new Error('存档超过 4 MB 限制。');
  const raw = record(JSON.parse(text), '这不是兼容的逻辑工坊存档。');
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5) throw new Error('这不是兼容的逻辑工坊存档。');
  const circuits = record(raw.circuits, '存档缺少电路。');
  const proofs = raw.proofs === undefined ? {} : record(raw.proofs, '通关记录格式无效。');
  const inputs = raw.inputs === undefined ? {} : record(raw.inputs, '输入状态格式无效。');
  const workspace = createWorkspace();
  const savedLibrary = raw.version === 1 ? {} : record(raw.library, '组件库格式无效。');
  // New fixed drafts require canonical CPU dependencies. Preserve every saved version,
  // including same-key definitions; fixed-machine validation diagnoses conflicts.
  workspace.library = parseLibrary(raw.version === 5 ? savedLibrary : { ...programmingMachineLibrary(), ...savedLibrary });
  const maximumSavedLevel = raw.version === 1 ? 4 : raw.version === 2 ? 20 : raw.version === 3 ? 32 : raw.version === 4 ? 44 : 56;
  const checkLevelKeys = (value: Record<string, unknown>) => {
    if (Object.keys(value).some(key => !/^[1-9][0-9]*$/.test(key) || Number(key) > maximumSavedLevel)) {
      throw new Error('存档包含无效关卡编号。');
    }
  };
  checkLevelKeys(circuits); checkLevelKeys(proofs); checkLevelKeys(inputs);
  for (const level of levels) {
    if (level.id <= maximumSavedLevel) workspace.circuits[level.id] = parseCircuit(circuits[level.id], level.id, workspace.library);
    else if (level.id >= 45) {
      const errors = validateCircuit(workspace.circuits[level.id], workspace.library);
      if (errors.length) throw new Error(errors[0]);
    }
    if (proofs[level.id] !== undefined) workspace.proofs[level.id] = parseCircuit(proofs[level.id], level.id, workspace.library);
    if (inputs[level.id] !== undefined) {
      const values = record(inputs[level.id], '输入状态格式无效。');
      if (Object.keys(values).some(name => !level.inputs.includes(name))) throw new Error('输入端口无效。');
      for (const port of level.inputPorts) {
        const value = values[port.id];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 2 ** port.bits) {
          throw new Error(`输入 ${port.id} 超过位宽范围。`);
        }
        workspace.inputs[level.id][port.id] = value;
      }
    }
  }
  let unlocked = levels.length;
  if (options.verifyProofs !== false) {
    const verified: Record<number, Circuit> = {};
    for (const level of levels) {
      const proof = workspace.proofs[level.id];
      if (!proof || !judge(proof, workspace.library).passed) break;
      verified[level.id] = proof;
    }
    workspace.proofs = verified;
    unlocked = Math.min(levels.length, Object.keys(verified).length + 1);
  }
  workspace.currentLevel = Number.isInteger(raw.currentLevel) && (raw.currentLevel as number) >= 1
    && (raw.currentLevel as number) <= unlocked ? raw.currentLevel as number : unlocked;
  return workspace;
}

export function loadWorkspace(): { workspace: Workspace; savedText?: string; error?: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return { workspace: createWorkspace(), ...(saved === null ? {} : { savedText: saved }) };
  } catch {
    return { workspace: createWorkspace(), error: '存档读取失败；新编辑会创建存档。' };
  }
}

export function serializeWorkspace(workspace: Workspace, space?: number) {
  workspace = pruneDeletedComponents(workspace);
  const graph = (value: CircuitGraph): CircuitGraph => ({
    nodes: value.nodes.map(({ id, type, label, position, bits, value: constant, componentKey, words, programSource }) => ({
      id, type, label, position: { x: position.x, y: position.y },
      ...(bits === undefined ? {} : { bits }), ...(constant === undefined ? {} : { value: constant }),
      ...(type === 'COMPONENT' ? { componentKey } : {}),
      ...(type === 'ROM' && words !== undefined ? { words: [...words] } : {}),
      ...(type === 'ROM' && programSource !== undefined ? { programSource } : {}),
    })),
    wires: value.wires.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle })),
  });
  const circuits = (records: Record<number, Circuit>) => Object.fromEntries(Object.entries(records)
    .map(([id, circuit]) => [id, { levelId: circuit.levelId, revision: circuit.revision, ...graph(circuit) }]));
  const ports = (records: Port[]) => records.map(({ id, label, bits }) => ({ id, label, bits }));
  const library = Object.fromEntries(Object.entries(workspace.library).map(([key, definition]) => [key, {
    id: definition.id, version: definition.version, name: definition.name,
    inputs: ports(definition.inputs), outputs: ports(definition.outputs), dependencies: [...definition.dependencies],
    ...(definition.sourceLevel === undefined ? {} : { sourceLevel: definition.sourceLevel }),
    ...(definition.deleted ? { deleted: true } : {}), graph: graph(definition.graph),
  }]));
  return JSON.stringify({ version: workspace.version, currentLevel: workspace.currentLevel,
    circuits: circuits(workspace.circuits), proofs: circuits(workspace.proofs), inputs: workspace.inputs, library }, null, space);
}

export function saveWorkspace(workspace: Workspace) {
  localStorage.setItem(STORAGE_KEY, serializeWorkspace(workspace));
}
