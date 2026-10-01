import { describe, expect, it, vi } from 'vitest';
import { HeadlessCircuit } from 'digitaljs';
import { compileSequential } from '../src/sequentialEvaluator';
import { judge, replaySequence, simulate } from '../src/simulator';
import { createCircuit, validateCircuit } from '../src/model';
import { levels, testSequences } from '../src/levels';
import { referenceCircuit } from './fixtures';
import { architectureLibrary } from '../src/architectureCircuits';
import type { Circuit, CircuitNode, ComponentLibrary, RuntimeState, SimulationStep, Wire } from '../src/contracts';

const node=(id:string,type:CircuitNode['type'],bits=1):CircuitNode=>({id,type,bits,label:id,position:{x:0,y:0}});
const wire=(source:string,sourceHandle:string,target:string,targetHandle:string):Wire=>({id:`${source}.${sourceHandle}-${target}.${targetHandle}`,source,sourceHandle,target,targetHandle});
function compareSteps(circuit:Circuit,library:ComponentLibrary,steps:SimulationStep[],state?:RuntimeState){
  const fast=compileSequential(circuit,library);fast.reset(state);
  let digitalState=state;
  for(const {inputs,tick} of steps){
    const outputs=fast.step(inputs,tick),digital=simulate(circuit,inputs,library,{tick,state:digitalState});digitalState=digital.state;
    expect(outputs).toEqual(Object.fromEntries(circuit.nodes.filter(n=>n.type==='OUTPUT').map(n=>[n.id,digital.values[n.id]])));
    expect(fast.state()).toEqual(digital.state);
  }
}
describe('compiled sequential gate graphs',()=>{
  const library=architectureLibrary();
  for(const level of levels.filter(l=>l.id>=21&&l.id<=44&&l.mode==='sequential'))it(`matches independent DigitalJS scenarios for lesson ${level.id}`,async()=>{
    const circuit=referenceCircuit(level.id);
    for(const scenario of testSequences(level.id)){
      const programmed=scenario.program?{...circuit,nodes:circuit.nodes.map(n=>n.id==='program'?{...n,words:[...scenario.program!]}:n)}:circuit;
      const fast=compileSequential(programmed,library),trace=[];
      for(const step of scenario.steps){const outputs=fast.step(step.inputs,step.tick);trace.push({cycle:fast.state().cycle,inputs:{...step.inputs},tick:step.tick,outputs});if(trace.length>64)trace.shift();}
      const digital=replaySequence(circuit,library,scenario.steps,scenario.program);
      expect(trace).toEqual(digital.trace);expect(fast.state()).toEqual(digital.state);
      // Let the test worker deliver progress between complete, unchanged scenario comparisons.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  },180000);
  it('commits all register old values simultaneously and conservatively merges unknown reset',()=>{
    const c=createCircuit(24);c.nodes.push(node('r1','DFF',8),node('r2','DFF',8));
    c.wires.push(wire('D','out','r1','d'),wire('r1','q','r2','d'),wire('R','out','r2','rst'),wire('r2','q','Q','in'));
    compareSteps(c,{},[{inputs:{D:165,R:0},tick:true},{inputs:{D:0,R:0},tick:false},{inputs:{D:0,R:0},tick:true},{inputs:{D:255,R:1},tick:true}]);
    const state={cycle:7,registers:{r1:'1X0X0010',r2:17}};
    compareSteps(c,{},[{inputs:{D:165,R:0},tick:false},{inputs:{D:0,R:0},tick:true}],state);
  });
  it('uses compiled real gate state for sequential judging while retaining DigitalJS replay',()=>{
    const c=referenceCircuit(22),updates=vi.spyOn(HeadlessCircuit.prototype,'updateGatesNext');
    try{
      expect(judge(c).passed).toBe(true);expect(updates).not.toHaveBeenCalled();
      replaySequence(c,{},[{inputs:{D:1,R:0},tick:true}]);expect(updates).toHaveBeenCalled();
    }finally{updates.mockRestore();}
  });
  it('retains ROM address dependencies through cascades and merges partial unknown addresses',()=>{
    const c=createCircuit(38),table=Array(256).fill(0);table[255]=0xbeef;
    c.nodes.find(n=>n.id==='program')!.words=[255];
    c.nodes.push({...node('rom','ROM',16),words:table},{...node('zero','CONST',8),value:0},node('split','SPLIT',16),node('join','JOIN',8));
    c.wires.push(wire('zero','out','program','addr'),wire('program','q','split','in'),wire('join','out','rom','addr'),wire('rom','q','IR','in'));
    for(let i=0;i<8;i++)c.wires.push(wire('split',`out${i}`,'join',`in${i}`));
    compareSteps(c,{},[{inputs:{},tick:false},{inputs:{},tick:true}]);
    const partial=createCircuit(38),words=Array(256).fill(0);words[254]=0xbeee;words[255]=0xbeef;
    partial.nodes.find(n=>n.id==='program')!.words=words;partial.nodes.push(node('address','DFF',8));
    partial.wires.push(wire('address','q','program','addr'),wire('Target','out','address','d'),wire('R','out','address','rst'),wire('program','q','IR','in'));
    compareSteps(partial,{},[{inputs:{Target:255,R:0},tick:false},{inputs:{Target:255,R:0},tick:true},{inputs:{Target:0,R:1},tick:true}],{cycle:0,registers:{address:'1111111X'}});
  });
  it('cuts RAM write dependencies while retaining asynchronous address cycles',()=>{
    const c=createCircuit(41);c.nodes.push(node('mem','RAM',8));
    c.wires.push(wire('Addr','out','mem','addr'),wire('mem','q','mem','d'),wire('W','out','mem','we'),wire('R','out','mem','rst'),wire('mem','q','Q','in'));
    expect(validateCircuit(c)).toEqual([]);
    compareSteps(c,{},[{inputs:{Addr:255,W:1,R:0},tick:true},{inputs:{Addr:0,W:1,R:1},tick:true}]);
    c.wires=c.wires.filter(w=>w.targetHandle!=='addr');c.wires.push(wire('mem','q','mem','addr'));
    expect(()=>compileSequential(c)).toThrow(/回路/);
  });
  it('matches partial-address reads, uncertain writes, reset, old RAM capture and nested isolation',()=>{
    const cell={nodes:[node('Addr','INPUT',8),node('D','INPUT',8),node('W','INPUT'),node('R','INPUT'),node('Q','OUTPUT',8),node('mem','RAM',8)],wires:[wire('Addr','out','mem','addr'),wire('D','out','mem','d'),wire('W','out','mem','we'),wire('R','out','mem','rst'),wire('mem','q','Q','in')]};
    const lib:ComponentLibrary={'cell@1':{id:'cell',version:1,name:'cell',inputs:[{id:'Addr',label:'Addr',bits:8},{id:'D',label:'D',bits:8},{id:'W',label:'W',bits:1},{id:'R',label:'R',bits:1}],outputs:[{id:'Q',label:'Q',bits:8}],dependencies:[],graph:cell}};
    const c=createCircuit(41);c.nodes.push({...node('left','COMPONENT'),componentKey:'cell@1'},{...node('right','COMPONENT'),componentKey:'cell@1'},node('capture','DFF',8),node('address','DFF',8));
    for(const instance of ['left','right']){
      c.wires.push(wire('address','q',instance,'Addr'),wire('D','out',instance,'D'),wire('R','out',instance,'R'));
      if(instance==='left')c.wires.push(wire('W','out',instance,'W'));
    }
    c.wires.push(wire('left','Q','capture','d'),wire('R','out','capture','rst'),wire('right','Q','Q','in'));
    const words=Array(256).fill(0);words[254]=0xa4;words[255]=0xa5;
    const state={cycle:0,registers:{address:'1111111X',capture:0},memories:{'left/mem':[...words],'right/mem':[...words]}};
    compareSteps(c,lib,[{inputs:{D:165,W:0,R:0},tick:false},{inputs:{D:165,W:1,R:0},tick:true},{inputs:{D:255,W:1,R:0},tick:true},{inputs:{D:255,W:1,R:1},tick:false},{inputs:{D:255,W:1,R:1},tick:true}],state);
    c.wires=c.wires.filter(w=>w.targetHandle!=='R');
    compareSteps(c,lib,[{inputs:{D:165,W:1,R:0},tick:true}],state);
  });
});
