export type GateType = 'NAND' | 'NOT' | 'AND' | 'OR' | 'XOR' | 'XNOR' | 'CONST' | 'SPLIT' | 'JOIN' | 'DFF';
export type NodeType = 'INPUT' | 'OUTPUT' | GateType | 'COMPONENT';
export type Inputs = Record<string, number>;
export type Outputs = Record<string, number>;
export type Signal = number | string;
export interface Port { id: string; label: string; bits: number; }
export interface CircuitNode {
  id: string; type: NodeType; label: string; position: { x: number; y: number };
  bits?: number; value?: number; componentKey?: string;
}
export interface Wire { id: string; source: string; sourceHandle: string; target: string; targetHandle: string; }
export interface CircuitGraph { nodes: CircuitNode[]; wires: Wire[]; }
export interface Circuit extends CircuitGraph { levelId: number; revision: number; }
export interface ComponentDefinition {
  id: string; version: number; name: string; inputs: Port[]; outputs: Port[];
  graph: CircuitGraph; dependencies: string[]; sourceLevel?: number;
}
export type ComponentLibrary = Record<string, ComponentDefinition>;
export interface RuntimeState { registers: Record<string, Signal>; cycle: number; }
export interface SimulationStep { inputs: Inputs; tick: boolean; }
export interface TemporalStep extends SimulationStep { expectedOutputs: Outputs; }
export interface TestSequence { id: string; label: string; steps: TemporalStep[]; }
export interface SimulationFrame { cycle: number; inputs: Inputs; outputs: Record<string, Signal>; tick: boolean; }
export interface Simulation {
  values: Record<string, Signal>; portValues: Record<string, Signal>; wires: Record<string, Signal>;
  state?: RuntimeState; trace?: SimulationFrame[];
}
export interface TestRow {
  inputs: Inputs; expected: number; actual: Signal; passed: boolean;
  expectedOutputs: Outputs; actualOutputs: Record<string, Signal>; mismatches: string[];
  scenarioId?: string; scenarioLabel?: string; stepIndex?: number; cycle?: number; tick?: boolean;
}
export interface TestResult { revision: number; passed: boolean; rows: TestRow[]; failure?: TestRow; error?: string; }
