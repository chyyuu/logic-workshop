import { describe, expect, it } from 'vitest';
import { componentInterfacesMatch, dependentComponentKeys, graphUsesDeletedComponent, markComponentsDeleted, pruneDeletedComponents,
  renameComponent, replaceComponentInstance } from '../src/componentManagement';
import type { Circuit, ComponentDefinition, ComponentLibrary } from '../src/contracts';

const port = { id: 'out', label: 'out', bits: 1 };
const leaf: ComponentDefinition = { id: 'leaf', version: 1, name: 'Leaf', inputs: [], outputs: [port], dependencies: [],
  graph: { nodes: [{ id: 'out', type: 'OUTPUT', label: 'out', bits: 1, position: { x: 0, y: 0 } }], wires: [] } };
const wrapper: ComponentDefinition = { id: 'wrapper', version: 1, name: 'Wrapper', inputs: [], outputs: [port], dependencies: ['leaf@1'],
  graph: { nodes: [{ id: 'leaf-node', type: 'COMPONENT', label: 'Leaf', componentKey: 'leaf@1', position: { x: 0, y: 0 } },
    { id: 'out', type: 'OUTPUT', label: 'out', bits: 1, position: { x: 200, y: 0 } }], wires: [] } };
const top: ComponentDefinition = { ...wrapper, id: 'top', name: 'Top', dependencies: ['wrapper@1'],
  graph: { ...wrapper.graph, nodes: [{ ...wrapper.graph.nodes[0], label: 'Wrapper', componentKey: 'wrapper@1' }, wrapper.graph.nodes[1]] } };
const circuit = (componentKey?: string): Circuit => ({ levelId: 1, revision: 0, wires: [], nodes: componentKey
  ? [{ id: 'unit', type: 'COMPONENT', label: componentKey === 'leaf@1' ? 'Leaf' : 'Top', componentKey, position: { x: 0, y: 0 } }]
  : [] });
const library = (): ComponentLibrary => ({ 'leaf@1': structuredClone(leaf), 'wrapper@1': structuredClone(wrapper), 'top@1': structuredClone(top) });

describe('custom component management', () => {
  it('finds every transitive dependent and marks the full set deleted', () => {
    const keys = dependentComponentKeys(library(), 'leaf@1');
    expect(new Set(keys)).toEqual(new Set(['leaf@1', 'wrapper@1', 'top@1']));
    const deleted = markComponentsDeleted(library(), keys);
    expect(Object.values(deleted).every(definition => definition.deleted)).toBe(true);
  });

  it('does not list an already deleted dependent again', () => {
    const partlyDeleted = markComponentsDeleted(library(), ['wrapper@1', 'top@1']);
    expect(dependentComponentKeys(partlyDeleted, 'leaf@1')).toEqual(['leaf@1']);
  });

  it('renames placed and nested instances without changing stable keys', () => {
    const workspace = { library: library(), circuits: { 1: circuit('leaf@1') }, proofs: { 1: circuit('leaf@1') } };
    const renamed = renameComponent(workspace, 'leaf@1', 'Renamed leaf');
    expect(renamed.library['leaf@1'].name).toBe('Renamed leaf');
    expect(renamed.library['wrapper@1'].graph.nodes[0]).toMatchObject({ componentKey: 'leaf@1', label: 'Renamed leaf' });
    expect(renamed.circuits[1].nodes[0]).toMatchObject({ componentKey: 'leaf@1', label: 'Renamed leaf' });
    expect(renamed.proofs[1].nodes[0].label).toBe('Renamed leaf');
  });

  it('replaces a compatible instance without moving it or changing its wires', () => {
    const alternative = { ...structuredClone(leaf), id: 'alternative', name: 'Alternative' };
    const definitions = { ...library(), 'alternative@1': alternative };
    const graph: Circuit = { levelId: 1, revision: 4,
      nodes: [{ id: 'A', type: 'INPUT', label: 'A', bits: 1, position: { x: 0, y: 0 } },
        { id: 'unit', type: 'COMPONENT', label: 'Leaf', componentKey: 'leaf@1', position: { x: 200, y: 100 } },
        { id: 'Y', type: 'OUTPUT', label: 'Y', bits: 1, position: { x: 500, y: 0 } }],
      wires: [{ id: 'wire', source: 'unit', sourceHandle: 'out', target: 'Y', targetHandle: 'in' }] };
    expect(componentInterfacesMatch(leaf, alternative)).toBe(true);
    const replaced = replaceComponentInstance(graph, 'unit', 'alternative@1', definitions);
    expect(replaced.revision).toBe(5);
    expect(replaced.nodes.find(node => node.id === 'unit')).toMatchObject({ id: 'unit', label: 'Alternative', componentKey: 'alternative@1', position: { x: 200, y: 100 } });
    expect(replaced.wires).toEqual(graph.wires);
  });

  it('rejects incompatible and deleted replacement targets', () => {
    const definitions = library();
    const graph = circuit('leaf@1');
    definitions['wrapper@1'].outputs[0].bits = 2;
    expect(() => replaceComponentInstance(graph, 'unit', 'wrapper@1', definitions)).toThrow(/不兼容/);
    definitions['leaf@1'].deleted = true;
    expect(() => replaceComponentInstance(circuit('wrapper@1'), 'unit', 'leaf@1', definitions)).toThrow(/已删除/);
  });

  it('retains only deleted definitions still reachable from a circuit', () => {
    const deleted = markComponentsDeleted(library(), ['leaf@1', 'wrapper@1', 'top@1']);
    const retained = pruneDeletedComponents({ library: deleted, circuits: { 1: circuit('top@1') }, proofs: {} });
    expect(Object.keys(retained.library)).toEqual(['leaf@1', 'wrapper@1', 'top@1']);
    expect(graphUsesDeletedComponent(retained.circuits[1], retained.library)).toBe(true);
    const pruned = pruneDeletedComponents({ ...retained, circuits: { 1: circuit() } });
    expect(pruned.library).toEqual({});
  });
});
