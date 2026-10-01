import { expect, it } from 'vitest';
import { programmingMachine, programmingMachineLibrary, programmingReferenceCircuit, validateProgrammingMachine } from '../src/programmingMachine';
import { createProgrammingRunner } from '../src/programmingRunner';
import { judge, simulate } from '../src/simulator';
import { programmingCases } from '../src/programmingSpec';

it('fixes CPU and its dependency closure while permitting layout and ROM edits',()=>{
  const circuit=programmingMachine(45),library=programmingMachineLibrary();
  circuit.revision=8;circuit.nodes.forEach(n=>n.position={x:12,y:99});
  circuit.nodes.find(n=>n.id==='program')!.words=[0x102a,0x8000,0x9000];
  expect(validateProgrammingMachine(circuit,library)).toEqual([]);
  const key=circuit.nodes.find(n=>n.type==='COMPONENT')!.componentKey!;
  library[key].graph.wires.pop();
  expect(validateProgrammingMachine(circuit,library).join('')).toContain('固定');
});

it('counts repeated equal OUT events and judges the saved ROM',()=>{
  const circuit=programmingMachine(45),library=programmingMachineLibrary();
  circuit.nodes.find(n=>n.id==='program')!.words=[0x102a,0x8000,0x8000,0x9000];
  const runner=createProgrammingRunner(circuit,library);
  runner.run({E:1,R:0},{maxCycles:90,breakpoints:[]});
  expect(runner.program().outputs).toEqual([42,42]);
  expect(judge(circuit,library).failure?.program?.reason).toContain('额外');
  expect(judge(circuit,library).failure?.cycle).toBe(9);
});

it('enforces total case budget across batches and preserves old clock state',()=>{
  const circuit=programmingMachine(45),library=programmingMachineLibrary();
  circuit.nodes.find(n=>n.id==='program')!.words=[0x6000];
  const runner=createProgrammingRunner(circuit,library);
  for(let batch=0;batch<200&&!runner.program().stopReason;batch++)runner.run({E:1,R:0},{maxCycles:90,breakpoints:[]});
  expect(runner.program().stopReason).toBe('budget');
  const fast=runner.state();
  const snapshot=simulate(circuit,{E:1,R:0},library,{state:fast});
  expect(snapshot.values).toMatchObject(runner.observe({E:1,R:0}));
});

for(let id=45;id<=56;id++)it(`grades every public case of reference application ${id} on actual gates`,()=>{
  const result=judge(programmingReferenceCircuit(id),programmingMachineLibrary());
  expect(result.error).toBeUndefined();
  expect(result.failure?.program?.reason).toBeUndefined();
  expect(result.passed).toBe(true);
},120000);

it('distinguishes wrong output, missing output, faulty words and wrong RAM',()=>{
  const library=programmingMachineLibrary();
  for(const [id,words,diagnostic] of [[45,[0x1029,0x8000,0x9000],'实际'],[45,[0x102a,0x9000],'缺少'],[45,[0xa000],'FAULT'],[47,[0x40f0,0x8000,0x9000],'RAM']] as const){
    const circuit=programmingMachine(id);circuit.nodes.find(n=>n.id==='program')!.words=[...words];
    expect(judge(circuit,library).failure?.program?.reason).toContain(diagnostic);
  }
});

it('samples the same seeded old state as DigitalJS at fetch, LOAD, STORE, OUT and HLT edges',()=>{
  const circuit=programmingReferenceCircuit(47),library=programmingMachineLibrary();
  const testCase=programmingCases(47).find(c=>c.memory[240]===255)!;
  const runner=createProgrammingRunner(circuit,library,testCase.id);
  for(let cycle=0;cycle<12;cycle++){
    const digital=[0,2,5,8,11].includes(cycle)?simulate(circuit,{E:1,R:0},library,{state:runner.state(),tick:true}):undefined;
    const actual=runner.step();
    if(digital){
      expect(digital.state).toEqual(runner.state());
      expect(Object.fromEntries(circuit.nodes.filter(n=>n.type==='OUTPUT').map(n=>[n.id,digital.values[n.id]]))).toEqual(actual);
    }
  }
  expect(runner.program().outputs).toEqual([255]);expect(runner.program().memory[242]).toBe(255);
},60000);
