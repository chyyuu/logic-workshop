import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Circuit, Simulation } from '../src/contracts';

let receive:(event:{data:Record<string,unknown>})=>void;
let response:{result?:Simulation;error?:string};
let fixture:()=>Circuit;
beforeEach(async()=>{
  vi.resetModules();
  const {levels}=await import('../src/levels');
  const index=levels.findIndex(l=>l.id===38);if(index>=0)levels.splice(index,1);
  levels.push({...levels[31],id:38,inputPorts:[{id:'Addr',label:'Addr',bits:8},{id:'R',label:'R',bits:1}],outputPorts:[{id:'IR',label:'IR',bits:16}],allowed:['ROM','DFF'],defaultProgram:[0x1111,0x2222],sequences:()=>[{id:'alternate',label:'alternate',program:[0x3333,0x4444],steps:[{inputs:{Addr:0,R:0},tick:true,expectedOutputs:{IR:0x3333}}]}]});
  const {createCircuit}=await import('../src/model');
  fixture=()=>{const c=createCircuit(38);c.nodes.push({id:'ir',label:'ir',type:'DFF',bits:16,position:{x:0,y:0}});
    c.wires=[['Addr','out','program','addr'],['program','q','ir','d'],['R','out','ir','rst'],['ir','q','IR','in']].map(([source,sourceHandle,target,targetHandle],i)=>({id:`w${i}`,source,sourceHandle,target,targetHandle}));return c;};
  vi.stubGlobal('addEventListener',(_type:string,listener:typeof receive)=>{receive=listener;});
  vi.stubGlobal('postMessage',(message:typeof response)=>{response=structuredClone(message);});
  await import('../src/simulation.worker');
});
afterEach(()=>vi.unstubAllGlobals());
function request(operation:string,circuit:Circuit,extra:Record<string,unknown>={}):Simulation{
  receive({data:{id:1,operation,circuit,inputs:{Addr:1,R:0},sessionKey:'same-ui-key',...extra}});
  if(response.error)throw new Error(response.error);return response.result!;
}
it('keeps a replay program for subsequent ticks and observations until reset',()=>{
  const c=fixture();const replay=request('replay',c,{scenarioId:'alternate',stepIndex:0});
  expect(replay.values.IR).toBe(0x3333);expect(replay.activeProgram).toEqual([0x3333,0x4444]);
  expect(request('simulate',c).values.IR).toBe(0x3333);
  expect(request('tick',c).values.IR).toBe(0x4444);
  const cleared=request('reset',c);expect(cleared.values.IR).toBe(0);expect(cleared.activeProgram).toBeUndefined();
  expect(request('tick',c).values.IR).toBe(0x2222);
});
it('resets state and the replay override when ROM words change even if the caller key stays constant',()=>{
  const c=fixture();request('replay',c,{scenarioId:'alternate',stepIndex:0});
  c.nodes.find(n=>n.id==='program')!.words=[0xabcd,0xbeef];c.revision++;
  const observed=request('simulate',c);expect(observed.values.IR).toBe(0);expect(observed.state?.cycle).toBe(0);expect(observed.activeProgram).toBeUndefined();
  expect(request('tick',c).values.IR).toBe(0xbeef);
});
