import type { Circuit, CircuitGraph, ComponentDefinition, ComponentLibrary, Port } from './contracts';
import { validateCircuit } from './model';

export interface ComponentWorkspace {
  library: ComponentLibrary;
  circuits: Record<number, Circuit>;
  proofs: Record<number, Circuit>;
}

export function dependentComponentKeys(library: ComponentLibrary, targetKey: string): string[] {
  if (!library[targetKey]) throw new Error('组件不存在。');
  const affected = new Set([targetKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, definition] of Object.entries(library)) {
      if (!definition.deleted && !affected.has(key) && definition.dependencies.some(dependency => affected.has(dependency))) {
        affected.add(key);
        changed = true;
      }
    }
  }
  return [...affected];
}

export function markComponentsDeleted(library: ComponentLibrary, keys: Iterable<string>): ComponentLibrary {
  const deleted = new Set(keys);
  return Object.fromEntries(Object.entries(library).map(([key, definition]) =>
    [key, deleted.has(key) ? { ...definition, deleted: true as const } : definition]));
}

function samePorts(left: Port[], right: Port[]): boolean {
  return left.length === right.length && left.every((port, index) => port.id === right[index].id && port.bits === right[index].bits);
}

export function componentInterfacesMatch(left: ComponentDefinition, right: ComponentDefinition): boolean {
  return samePorts(left.inputs, right.inputs) && samePorts(left.outputs, right.outputs);
}

export function replaceComponentInstance(circuit: Circuit, nodeId: string, targetKey: string, library: ComponentLibrary): Circuit {
  const node = circuit.nodes.find(item => item.id === nodeId);
  if (!node || node.type !== 'COMPONENT') throw new Error('请选择一个组件实例。');
  const source = library[node.componentKey ?? ''];
  const target = library[targetKey];
  if (!source) throw new Error('原组件定义缺失。');
  if (!target || target.deleted) throw new Error('替换目标不存在或已删除。');
  if (!componentInterfacesMatch(source, target)) throw new Error('替换组件的输入输出端口不兼容。');
  const next: Circuit = { ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(item => item.id === nodeId
    ? { ...item, componentKey: targetKey, label: target.name } : item) };
  const error = validateCircuit(next, library)[0];
  if (error) throw new Error(error);
  return next;
}

export function renameComponentInstances<T extends CircuitGraph>(graph: T, componentKey: string, name: string): T {
  if (!graph.nodes.some(node => node.type === 'COMPONENT' && node.componentKey === componentKey)) return graph;
  return { ...graph, nodes: graph.nodes.map(node => node.type === 'COMPONENT' && node.componentKey === componentKey
    ? { ...node, label: name } : node) } as T;
}

export function renameComponent<T extends ComponentWorkspace>(workspace: T, componentKey: string, rawName: string): T {
  const name = rawName.trim();
  if (!name || name.length > 60) throw new Error('组件名称需要 1 至 60 个字符。');
  const target = workspace.library[componentKey];
  if (!target || target.deleted) throw new Error('组件不存在或已删除。');
  const library = Object.fromEntries(Object.entries(workspace.library).map(([key, definition]) => {
    const graph = renameComponentInstances(definition.graph, componentKey, name);
    return [key, { ...definition, ...(key === componentKey ? { name } : {}), graph }];
  }));
  const records = (source: Record<number, Circuit>) => Object.fromEntries(Object.entries(source).map(([id, circuit]) => {
    return [id, renameComponentInstances(circuit, componentKey, name)];
  }));
  return { ...workspace, library, circuits: records(workspace.circuits), proofs: records(workspace.proofs) };
}

export function graphUsesDeletedComponent(graph: CircuitGraph, library: ComponentLibrary): boolean {
  const visited = new Set<string>();
  const usesDeleted = (key: string): boolean => {
    const definition = library[key];
    if (!definition) return false;
    if (definition.deleted) return true;
    if (visited.has(key)) return false;
    visited.add(key);
    return definition.dependencies.some(usesDeleted);
  };
  return graph.nodes.some(node => node.type === 'COMPONENT' && usesDeleted(node.componentKey ?? ''));
}

/** Keep deleted definitions only while a live definition, level circuit, or proof can still reach them. */
export function pruneDeletedComponents<T extends ComponentWorkspace>(workspace: T): T {
  const reachable = new Set<string>();
  const visit = (key: string) => {
    if (reachable.has(key)) return;
    const definition = workspace.library[key];
    if (!definition) return;
    reachable.add(key);
    definition.dependencies.forEach(visit);
  };
  for (const [key, definition] of Object.entries(workspace.library)) if (!definition.deleted) visit(key);
  for (const records of [workspace.circuits, workspace.proofs]) {
    for (const graph of Object.values(records)) {
      for (const node of graph.nodes) if (node.type === 'COMPONENT') visit(node.componentKey ?? '');
    }
  }
  const library = Object.fromEntries(Object.entries(workspace.library)
    .filter(([key, definition]) => !definition.deleted || reachable.has(key)));
  return Object.keys(library).length === Object.keys(workspace.library).length ? workspace : { ...workspace, library };
}
