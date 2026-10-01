import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Circuit, ComponentLibrary, Simulation } from '../src/contracts';
import { programmingMachine, programmingMachineLibrary, programmingReferenceCircuit } from '../src/programmingMachine';
import { architectureReferenceCircuit } from '../src/architectureCircuits';
import { programmingCases } from '../src/programmingSpec';
import { judge } from '../src/simulator';

let receive:(event:{data:Record<string,unknown>})=>void;
let response:{result?:Simulation;error?:string};
let circuit:Circuit,library:ComponentLibrary;
beforeEach(async()=>{
  circuit=programmingMachine(47);library=programmingMachineLibrary();
  circuit.nodes.find(n=>n.id==='program')!.words=[0x40f0,0x50f2,0x8000,0x9000];
  vi.resetModules();
  vi.stubGlobal('addEventListener',(_type:string,listener:typeof receive)=>{receive=listener;});
  vi.stubGlobal('postMessage',(message:typeof response)=>{response=structuredClone(message);});
  await import('../src/simulation.worker');
});
afterEach(()=>vi.unstubAllGlobals());
function request(operation:string,extra:Record<string,unknown>={}):Simulation{
  receive({data:{id:1,operation,circuit,library,inputs:{E:1,R:0},sessionKey:'same',...extra}});
  if(response.error)throw new Error(response.error);return response.result!;
}
it('loads selected RAM, pauses at a fetch breakpoint, resumes once and restarts the same case',()=>{
  const selected=programmingCases(47).find(c=>c.memory[240]>0)!;
  expect(request('programCase',{caseId:selected.id}).program?.memory[240]).toBe(selected.memory[240]);
  expect(request('programRun',{breakpoints:[0,1]}).program?.stopReason).toBe('breakpoint');
  const atStore=request('programRun',{breakpoints:[0,1]});
  expect(atStore.values.PC).toBe(1);expect(atStore.state?.cycle).toBe(3);
  expect(request('programStep',{instruction:true}).values.PC).toBe(2);
  expect(request('programRun',{breakpoints:[]}).program?.outputs).toEqual([selected.memory[240]]);
  const reset=request('reset');expect(reset.program?.caseId).toBe(selected.id);expect(reset.program?.outputs).toEqual([]);
  expect(reset.program?.memory[240]).toBe(selected.memory[240]);
},30000);
it('replays the exact saved program and case cycle and keeps output history on observation',()=>{
  const selected=programmingCases(47).find(c=>c.memory[240]>0)!;
  const replay=request('replay',{scenarioId:selected.id,stepIndex:9});
  expect(replay.state?.cycle).toBe(9);expect(replay.program?.outputs).toEqual([selected.memory[240]]);
  expect(replay.program?.memory[242]).toBe(selected.memory[240]);
  expect(request('simulate').program?.outputs).toEqual(replay.program?.outputs);
  circuit.nodes[0].position.x+=50;library[Object.keys(library)[0]].graph.nodes[0].position.y+=12;
  expect(request('simulate').state?.cycle).toBe(9);
  expect(request('programStep',{instruction:true}).program?.stopReason).toBe('halt');
},30000);
it('honors explicit E=0 and synchronous reset clears actual RAM without changing case',()=>{
  const selected=programmingCases(47).find(c=>c.memory[240]>0)!;
  request('programCase',{caseId:selected.id});
  expect(request('programRun',{breakpoints:[],inputs:{E:0,R:0}}).state?.cycle).toBe(0);
  expect(request('programStep',{instruction:true}).values.PC).toBe(1);
  const reset=request('tick',{inputs:{E:0,R:1}});
  expect(reset.program?.memory.every(v=>v===0)).toBe(true);
  expect(reset.program?.caseId).toBe(selected.id);
},30000);

it('rebuilds the failed output prefix without mixing a previous case trace',()=>{
  request('programStep',{instruction:true});
  circuit=programmingMachine(45);circuit.nodes.find(n=>n.id==='program')!.words=[0x1029,0x8000,0x9000];
  const failure=judge(circuit,library).failure!;
  expect(failure.cycle).toBe(6);
  const replay=request('replay',{scenarioId:failure.scenarioId,stepIndex:failure.stepIndex});
  expect(replay.program?.outputs).toEqual(failure.program?.actualOutput);
  expect(replay.values.Out).toBe(41);expect(replay.state?.cycle).toBe(6);
  expect(replay.trace?.map(frame=>frame.cycle)).toEqual([1,2,3,4,5,6]);
  expect(request('programCase',{caseId:failure.scenarioId}).trace?.map(frame=>frame.cycle)).toEqual([0]);
},30000);

it('discards legacy runtime when switching through a programming session with the same caller key',()=>{
  const legacy=architectureReferenceCircuit(44);
  circuit=legacy;
  const initial=request('simulate');
  expect(initial.state?.cycle).toBe(0);expect(initial.values).toMatchObject({PC:0,A:0,Out:0,Halt:0});
  circuit=programmingReferenceCircuit(45);
  const programmed=request('programRun',{breakpoints:[]});
  expect(programmed.state?.cycle).toBe(9);expect(programmed.values).toMatchObject({PC:2,A:42,Out:42,Halt:1});
  circuit=legacy;
  const restored=request('simulate');
  expect(restored.state?.cycle).toBe(0);expect(restored.values).toMatchObject({PC:0,A:0,Out:0,Halt:0});
  expect(restored.activeProgram).toBeUndefined();
},30000);
