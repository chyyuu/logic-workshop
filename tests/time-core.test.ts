import { describe, expect, it } from 'vitest';
import type { CircuitNode, Wire, SimulationStep, ComponentLibrary } from '../src/contracts';
import { createCircuit, validateCircuit } from '../src/model';
import { simulate, replaySequence, judge, hasSequential } from '../src/simulator';
import { encapsulateSelection, expandComponent, packageCircuit } from '../src/components';
import { testSequences } from '../src/levels';
import { referenceCircuit } from './fixtures';

const node = (id:string,type:CircuitNode['type'],bits=1):CircuitNode => ({id,type,bits,label:id,position:{x:300,y:100}});
const wire = (source:string,sourceHandle:string,target:string,targetHandle:string):Wire => ({id:`${source}.${sourceHandle}-${target}.${targetHandle}`,source,sourceHandle,target,targetHandle});
function registers() {
  const c=createCircuit(22);
  c.nodes.push(node('r1','DFF'),node('r2','DFF'));
  c.wires.push(wire('D','out','r1','d'),wire('R','out','r1','rst'),wire('r1','q','r2','d'),wire('R','out','r2','rst'),wire('r2','q','Q','in'));
  return c;
}

describe('uniform clock and serializable state',()=>{
  it('keeps state while inputs change and commits all registers from the old state',()=>{
    const c=registers();
    const initial=simulate(c,{D:1,R:0});
    expect(initial.values.Q).toBe(0);expect(initial.state?.cycle).toBe(0);
    const first=simulate(c,{D:1,R:0},{},{state:initial.state,tick:true});
    expect(first.values.r1).toBe(1);expect(first.values.Q).toBe(0);
    const held=simulate(c,{D:0,R:0},{},{state:structuredClone(first.state)});
    expect(held.values.r1).toBe(1);expect(held.state?.cycle).toBe(1);
    const second=simulate(c,{D:0,R:0},{},{state:held.state,tick:true});
    expect(second.values.r1).toBe(0);expect(second.values.Q).toBe(1);expect(second.state?.cycle).toBe(2);
    expect(initial.state?.cycle).toBe(0);
  });
  it('gives synchronous reset priority and does not reset until an edge',()=>{
    const c=registers();
    const loaded=replaySequence(c,{},[{inputs:{D:1,R:0},tick:true},{inputs:{D:1,R:0},tick:true}]);
    const pending=simulate(c,{D:1,R:1},{},{state:loaded.state});
    expect(pending.values.Q).toBe(1);
    const reset=simulate(c,{D:1,R:1},{},{state:pending.state,tick:true});
    expect(reset.values.Q).toBe(0);expect(reset.values.r1).toBe(0);
  });
  it('accepts register feedback and preserves conservative partial unknowns',()=>{
    const c=createCircuit(22);c.nodes.push(node('r','DFF'),node('inv','NOT'));
    c.wires.push(wire('r','q','inv','a'),wire('inv','out','r','d'),wire('R','out','r','rst'),wire('r','q','Q','in'));
    expect(validateCircuit(c)).toEqual([]);
    expect(replaySequence(c,{},Array.from({length:5},()=>({inputs:{D:0,R:0},tick:true}))).values.Q).toBe(1);
    const unknown=createCircuit(24);unknown.nodes.push(node('r','DFF',8));
    unknown.wires.push(wire('D','out','r','d'),wire('r','q','Q','in'));
    expect(simulate(unknown,{D:0,E:1,R:0},{},{tick:true}).values.Q).toBe(0);
    const uncertain=simulate(unknown,{D:165,E:1,R:0},{},{tick:true});
    expect(uncertain.values.Q).toBe('X0X00X0X');
    expect(simulate(unknown,{D:0,E:1,R:0},{},{state:structuredClone(uncertain.state)}).values.Q).toBe('X0X00X0X');
    unknown.wires.push(wire('R','out','r','rst'));
    unknown.wires=unknown.wires.filter(w=>w.targetHandle!=='d');
    expect(simulate(unknown,{D:165,E:1,R:1},{},{tick:true}).values.Q).toBe(0);
    expect(simulate(unknown,{D:165,E:1,R:0},{},{tick:true}).values.Q).toBe('X');
  });
  it('keeps nested instance registers independent and agrees with expansion',()=>{
    const c=registers();
    const inner=encapsulateSelection(c,['r1'],'cell');
    const instance=inner.circuit.nodes.find(n=>n.type==='COMPONENT')!.id;
    const outer=encapsulateSelection(inner.circuit,[instance],'nested',inner.library);
    const expanded=expandComponent(outer.circuit,outer.circuit.nodes.find(n=>n.type==='COMPONENT')!.id,outer.library);
    const steps:SimulationStep[]=[{inputs:{D:1,R:0},tick:true},{inputs:{D:0,R:0},tick:false},{inputs:{D:0,R:0},tick:true}];
    for (const graph of [c,outer.circuit,expanded]) {
      const result=replaySequence(graph,outer.library,steps);
      expect(result.values.Q).toBe(1);expect(Object.values(result.state!.registers).sort()).toEqual([0,1]);
    }
  });
  it('rejects direct combinational feedback concealed beside a registered output',()=>{
    const graph={nodes:[node('i','INPUT'),node('o','OUTPUT'),node('clocked','OUTPUT'),node('r','DFF')],wires:[wire('i','out','o','in'),wire('i','out','r','d'),wire('r','q','clocked','in')]};
    const library:ComponentLibrary={'mixed@1':{id:'mixed',version:1,name:'mixed',inputs:[{id:'i',label:'i',bits:1}],outputs:[{id:'o',label:'o',bits:1},{id:'clocked',label:'clocked',bits:1}],dependencies:[],graph}};
    const c=createCircuit(22);c.nodes.push({...node('unit','COMPONENT'),componentKey:'mixed@1'});
    c.wires.push(wire('unit','o','unit','i'));
    expect(validateCircuit(c,library).join(' ')).toMatch(/回路/);
    expect(()=>expandComponent(c,'unit',library)).toThrow(/回路/);
    c.wires=[wire('unit','clocked','unit','i')];
    expect(validateCircuit(c,library)).toEqual([]);
  });
  it('isolates two instances of the same nested definition',()=>{
    const cell={id:'cell',version:1,name:'cell',inputs:[{id:'d',label:'d',bits:1},{id:'reset',label:'reset',bits:1}],outputs:[{id:'q',label:'q',bits:1}],dependencies:[],
      graph:{nodes:[node('d','INPUT'),node('reset','INPUT'),node('q','OUTPUT'),node('reg','DFF')],wires:[wire('d','out','reg','d'),wire('reset','out','reg','rst'),wire('reg','q','q','in')]}};
    const library:ComponentLibrary={'cell@1':cell,'nested@1':{...cell,id:'nested',name:'nested',dependencies:['cell@1'],
      graph:{nodes:[node('d','INPUT'),node('reset','INPUT'),node('q','OUTPUT'),{...node('inner','COMPONENT'),componentKey:'cell@1'}],
        wires:[wire('d','out','inner','d'),wire('reset','out','inner','reset'),wire('inner','q','q','in')]}}};
    const c=createCircuit(22);
    c.nodes.push(...['left','right'].map(id=>({...node(id,'COMPONENT'),componentKey:'nested@1'})));
    c.wires.push(wire('D','out','left','d'),wire('left','q','right','d'),wire('R','out','left','reset'),wire('R','out','right','reset'),wire('right','q','Q','in'));
    expect(hasSequential(c,library)).toBe(true);
    const first=simulate(c,{D:1,R:0},library,{tick:true});
    expect(first.state?.registers).toEqual({'left/inner/reg':1,'right/inner/reg':0});
    expect(simulate(c,{D:0,R:0},library,{state:first.state,tick:true}).values.Q).toBe(1);
    let expanded=c;
    while (expanded.nodes.some(n=>n.type==='COMPONENT')) expanded=expandComponent(expanded,expanded.nodes.find(n=>n.type==='COMPONENT')!.id,library);
    expect(replaySequence(expanded,library,[{inputs:{D:1,R:0},tick:true},{inputs:{D:0,R:0},tick:true}]).values.Q).toBe(1);
  });
  it('expands a clocked component whose output drives its own input',()=>{
    const packaged=packageCircuit(referenceCircuit(22),'self-held register');
    const c=createCircuit(22);c.nodes.push({...node('unit','COMPONENT'),componentKey:packaged.key});
    c.wires.push(wire('unit','Q','unit','D'),wire('R','out','unit','R'),wire('unit','Q','Q','in'));
    expect(validateCircuit(c,packaged.library)).toEqual([]);
    const expanded=expandComponent(c,'unit',packaged.library);
    expect(validateCircuit(expanded,packaged.library)).toEqual([]);
    const steps:SimulationStep[]=[{inputs:{D:1,R:0},tick:false},{inputs:{D:0,R:0},tick:true},
      {inputs:{D:1,R:1},tick:false},{inputs:{D:1,R:1},tick:true},{inputs:{D:1,R:0},tick:true}];
    expect(replaySequence(expanded,packaged.library,steps).trace).toEqual(replaySequence(c,packaged.library,steps).trace);
    // A preloaded value must survive feedback until synchronous reset actually clocks.
    const initialOriginal=simulate(c,{D:0,R:0},packaged.library).state!;
    const initialExpanded=simulate(expanded,{D:0,R:0},packaged.library).state!;
    for (const state of [initialOriginal,initialExpanded]) for (const key of Object.keys(state.registers)) state.registers[key]=1;
    let originalState=initialOriginal,expandedState=initialExpanded;
    for (const step of steps) {
      const original=simulate(c,step.inputs,packaged.library,{state:originalState,tick:step.tick});
      const restored=simulate(expanded,step.inputs,packaged.library,{state:expandedState,tick:step.tick});
      expect(restored.values.Q).toBe(original.values.Q);
      originalState=original.state!;expandedState=restored.state!;
    }
    // Undriven reset stays unknown across expansion, including a clocked held one.
    const floating={...c,wires:c.wires.filter(w=>w.targetHandle!=='R')};
    const floatingExpanded=expandComponent(floating,'unit',packaged.library);
    for (const graph of [floating,floatingExpanded]) {
      const state=simulate(graph,{D:0,R:0},packaged.library).state!;
      for (const key of Object.keys(state.registers)) state.registers[key]=1;
      expect(simulate(graph,{D:0,R:0},packaged.library,{state,tick:true}).values.Q).toBe('X');
    }
  });
  it('preserves the complete enable-register behavior after encapsulating and expanding only its DFF',()=>{
    const original=referenceCircuit(23),selected=original.nodes.filter(n=>n.type==='DFF').map(n=>n.id);
    const packaged=encapsulateSelection(original,selected,'feedback cell');
    const expanded=expandComponent(packaged.circuit,packaged.circuit.nodes.find(n=>n.type==='COMPONENT')!.id,packaged.library);
    for (const scenario of testSequences(23)) {
      const expected=replaySequence(original,{},scenario.steps).trace;
      expect(replaySequence(packaged.circuit,packaged.library,scenario.steps).trace).toEqual(expected);
      expect(replaySequence(expanded,packaged.library,scenario.steps).trace).toEqual(expected);
    }
    expect(judge(expanded,packaged.library).passed).toBe(true);
  });
  it('records each observation and retains the last 64 frames after efficient prefix replay',()=>{
    const steps=Array.from({length:70},(_,i)=>({inputs:{D:i%2,R:0},tick:i%3!==0}));
    const result=replaySequence(registers(),{},steps);
    expect(result.trace).toHaveLength(64);expect(result.trace?.[0].inputs).toEqual(steps[6].inputs);
    expect(result.trace?.at(-1)?.cycle).toBe(46);expect(result.state?.cycle).toBe(46);
    expect(result.trace?.filter(f=>!f.tick).every((frame)=>Number.isInteger(frame.cycle))).toBe(true);
    const cleared=replaySequence(registers(),{},[]);expect(cleared.state?.cycle).toBe(0);expect(cleared.values.Q).toBe(0);
  });
  it('judges independent sequences and replays each failed prefix with its clock count',()=>{
    const c=registers(),result=judge(c);
    expect(result.passed).toBe(false);expect(result.failure?.scenarioId).toBeTruthy();
    expect(result.rows.some(r=>r.tick===false)).toBe(true);
    expect(result.rows.every(r=>r.cycle!==undefined&&r.stepIndex!==undefined)).toBe(true);
  });
});
