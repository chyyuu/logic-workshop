import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileCombinational } from '../src/combinationalEvaluator';
import { simulate, judge } from '../src/simulator';
import { levels } from '../src/levels';
import { validateCircuit } from '../src/model';
import type { Circuit, CircuitNode, ComponentLibrary, GateType, Inputs, Wire } from '../src/contracts';
import { referenceCircuit } from './fixtures';
import { architectureLibrary } from '../src/architectureCircuits';

const node=(id:string,type:CircuitNode['type'],bits=1):CircuitNode=>({id,type,bits,label:id,position:{x:0,y:0}});
const wire=(source:string,sourceHandle:string,target:string,targetHandle:string):Wire=>({id:`${source}.${sourceHandle}-${target}.${targetHandle}`,source,sourceHandle,target,targetHandle});
const gates:GateType[]=['NAND','NOT','AND','OR','XOR','XNOR'];
const outputSpecs=(bits:number)=>[...gates.map(id=>({id:`o${id}`,label:`o${id}`,bits})),{id:'Identity',label:'Identity',bits},{id:'Constant',label:'Constant',bits},{id:'Low',label:'Low',bits:1},{id:'High',label:'High',bits:1}];
function primitiveCircuit(bits:number):Circuit {
  const c:Circuit={levelId:200+bits,revision:17,nodes:[node('A','INPUT',bits),node('B','INPUT',bits),...outputSpecs(bits).map(p=>node(p.id,'OUTPUT',p.bits)),node('split','SPLIT',bits),node('join','JOIN',bits),{...node('constant','CONST',bits),value:Math.floor((2**bits-1)*0.6)}],wires:[]};
  for(const type of gates){c.nodes.push(node(type,type,bits));c.wires.push(wire('A','out',type,'a'),wire(type,'out',`o${type}`,'in'));if(type!=='NOT')c.wires.push(wire('B','out',type,'b'));}
  c.wires.push(wire('A','out','split','in'),wire('join','out','Identity','in'),wire('constant','out','Constant','in'),wire('split','out0','Low','in'),wire('split',`out${bits-1}`,'High','in'));
  for(let i=0;i<bits;i++)c.wires.push(wire('split',`out${i}`,'join',`in${i}`));
  return c;
}
beforeAll(()=>{
  for(const bits of [1,2,4,8,16])levels.push({...levels[0],id:200+bits,inputPorts:[{id:'A',label:'A',bits},{id:'B',label:'B',bits}],outputPorts:outputSpecs(bits),allowed:[...gates,'CONST','SPLIT','JOIN'],cases:()=>[{A:0,B:0},{A:1,B:1}],expectedOutputs:()=>Object.fromEntries(outputSpecs(bits).map(p=>[p.id,0]))});
});
afterAll(()=>{for(const bits of [1,2,4,8,16])levels.splice(levels.findIndex(l=>l.id===200+bits),1);});
function compare(c:Circuit,inputs:Inputs,library:ComponentLibrary={}) {
  const run=compileCombinational(c,library);expect(run).toBeTypeOf('function');
  const actual=simulate(c,inputs,library).values;
  expect(run!(inputs)).toEqual(Object.fromEntries(c.nodes.filter(n=>n.type==='OUTPUT').map(n=>[n.id,actual[n.id]])));
}
describe('compiled combinational graph grader',()=>{
  for(const bits of [1,2,4,8,16])it(`matches DigitalJS primitives and partial unknowns at width ${bits}`,()=>{
    const c=primitiveCircuit(bits),mask=2**bits-1;
    expect(validateCircuit(c)).toEqual([]);
    const values=[...new Set([0,1,mask,mask>>>1,Math.floor(mask*0.6),Math.floor(mask*0.3)])];
    const run=compileCombinational(c)!;expect(run).toBeTypeOf('function');
    for(const A of values)for(const B of values){const simulation=simulate(c,{A,B});expect(run({A,B})).toEqual(Object.fromEntries(outputSpecs(bits).map(p=>[p.id,simulation.values[p.id]])));}
    c.wires=c.wires.filter(w=>!(w.targetHandle==='b'||w.target==='join'&&Number(w.targetHandle.slice(2))%2===0));
    for(const A of values)compare(c,{A,B:mask});
  });
  it('resolves nested component interfaces and their true dependencies',()=>{
    const child=primitiveCircuit(8),inputs=[{id:'A',label:'A',bits:8},{id:'B',label:'B',bits:8}],outputs=outputSpecs(8);
    const library:ComponentLibrary={'inner@1':{id:'inner',version:1,name:'inner',inputs,outputs,graph:child,dependencies:[]}};
    const graph={nodes:[node('A','INPUT',8),node('B','INPUT',8),...outputs.map(p=>node(p.id,'OUTPUT',p.bits)),{...node('part','COMPONENT'),componentKey:'inner@1'}],wires:[...inputs.map(p=>wire(p.id,'out','part',p.id)),...outputs.map(p=>wire('part',p.id,p.id,'in'))]};
    library['outer@1']={id:'outer',version:1,name:'outer',inputs,outputs,graph,dependencies:['inner@1']};
    const c:Circuit={levelId:208,revision:0,...graph,nodes:graph.nodes.map(n=>n.id==='part'?{...n,componentKey:'outer@1'}:n)};
    compare(c,{A:165,B:129},library);
    c.wires=c.wires.filter(w=>!(w.target==='part'&&w.targetHandle==='B'));
    compare(c,{A:165,B:129},library);
  });
  it('leaves an undriven output unknown and rejects bad root input values',()=>{
    const c=primitiveCircuit(8);c.wires=c.wires.filter(w=>w.target!=='Identity');
    const run=compileCombinational(c)!;expect(run).toBeTypeOf('function');expect(run({A:0,B:0}).Identity).toBe('X');
    expect(()=>run({A:256,B:0})).toThrow(/位宽/);expect(()=>run({A:-1,B:0})).toThrow(/位宽/);
  });
  it('falls back for circuits containing registers or memory',()=>{
    for(const type of ['DFF','RAM','ROM'] as const){const c=primitiveCircuit(8);c.nodes.push(node('state',type,type==='ROM'?16:8));expect(compileCombinational(c)).toBeUndefined();}
  });
  it('grades actual gates and preserves full failed rows without using expected values as a shortcut',()=>{
    const c=primitiveCircuit(8),result=judge(c);
    expect(result.revision).toBe(17);expect(result.passed).toBe(false);expect(result.rows).toHaveLength(2);
    for(const row of result.rows){const simulation=simulate(c,row.inputs);expect(row.actualOutputs).toEqual(Object.fromEntries(outputSpecs(8).map(p=>[p.id,simulation.values[p.id]])));}
    expect(result.failure).toEqual(result.rows[0]);
  });
  it.skipIf(process.env.ARCHITECTURE_BENCHMARK!=='1')('benchmarks the full instruction decoder and verification through all forty-four proofs',async()=>{
    const library=architectureLibrary(),proofs=Object.fromEntries(Array.from({length:44},(_,i)=>[i+1,referenceCircuit(i+1)]));
    const decoderStart=performance.now(),decoder=judge(proofs[37],library),decoderMs=performance.now()-decoderStart;
    expect(decoder.error).toBeUndefined();expect(decoder.passed).toBe(true);expect(decoder.rows).toHaveLength(65536);
    let receive:(event:{data:Record<string,unknown>})=>void=()=>{};
    let response:{result?:Record<number,Circuit>;error?:string}={};
    vi.stubGlobal('addEventListener',(_type:string,listener:typeof receive)=>{receive=listener;});
    vi.stubGlobal('postMessage',(message:typeof response)=>{response=message;});
    try{
      await import('../src/simulation.worker');
      const verifyStart=performance.now();receive({data:{id:1,operation:'verify',proofs,library}});const verifyMs=performance.now()-verifyStart;
      expect(response.error).toBeUndefined();expect(Object.keys(response.result??{})).toHaveLength(44);
      console.info(`Architecture benchmark: decoder37 ${decoderMs.toFixed(0)}ms (65536 inputs); worker verify44 ${verifyMs.toFixed(0)}ms (44 legal proofs).`);
    }finally{vi.unstubAllGlobals();}
  },180000);
});
