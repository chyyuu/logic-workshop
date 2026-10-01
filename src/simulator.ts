import { HeadlessCircuit } from 'digitaljs';
import { Vector3vl } from '3vl';
import { getLevel, testInputs, testSequences } from './levels';
import { getPorts, validateCircuit } from './model';
import { flattenGraph } from './netlist';
import type { Endpoint } from './netlist';
import type { Circuit, CircuitNode, ComponentLibrary, Inputs, RuntimeState, Signal, Simulation, SimulationFrame, SimulationStep, TestResult, TestRow } from './contracts';
export type { Signal, Simulation, TestResult, TestRow } from './contracts';
export { hasSequential } from './netlist';

interface Register { key:string; bits:number; q:Endpoint; d:Endpoint; rst:Endpoint; }

/** DFFs become state sources plus collectors; DigitalJS handles the combinational graph. */
function compile(circuit:Circuit,library:ComponentLibrary) {
  const flat=flattenGraph(circuit,library),devices:Record<string,Record<string,unknown>>={},connectors:{from:Endpoint;to:Endpoint}[]=[],registers:Register[]=[];
  const nodeMap=new Map(flat.nodes.map(n=>[n.id,n.node]));
  function actual(endpoint:Endpoint):Endpoint[] {
    const node=nodeMap.get(endpoint.id)!;
    if (node.type==='DFF') return [{id:`${endpoint.id}:${endpoint.port}`,port:endpoint.port==='q'?'out':'in'}];
    if (node.type==='NOT'&&endpoint.port==='a') return [{id:endpoint.id,port:'in1'},{id:endpoint.id,port:'in2'}];
    return [{id:endpoint.id,port:endpoint.port==='a'?'in1':endpoint.port==='b'?'in2':endpoint.port}];
  }
  for (const {id,node,root} of flat.nodes) {
    const bits=node.bits??1;
    if (node.type==='DFF') {
      const q={id:`${id}:q`,port:'out'},d={id:`${id}:d`,port:'in'},rst={id:`${id}:rst`,port:'in'};
      devices[q.id]={type:'Input',bits,label:q.id};
      devices[d.id]={type:'Output',bits,label:d.id};
      devices[rst.id]={type:'Output',bits:1,label:rst.id};
      registers.push({key:id,bits,q,d,rst});
      continue;
    }
    const type=node.type==='INPUT'?root?'Input':'Repeater':node.type==='OUTPUT'?root?'Output':'Repeater':
      ({NAND:'Nand',NOT:'Nand',AND:'And',OR:'Or',XOR:'Xor',XNOR:'Xnor',CONST:'Constant',SPLIT:'BusUngroup',JOIN:'BusGroup'} as const)[node.type as Exclude<CircuitNode['type'],'INPUT'|'OUTPUT'|'COMPONENT'|'DFF'>];
    devices[id]={type,bits,label:id,net:node.label,
      ...(node.type==='CONST'?{constant:(node.value??0).toString(2).padStart(bits,'0')}:{}),
      ...(['SPLIT','JOIN'].includes(node.type)?{groups:Array(bits).fill(1)}:{})};
  }
  for (const wire of flat.wires) for (const to of actual(wire.to)) connectors.push({from:actual(wire.from)[0],to});
  const references=new Map<string,{device?:string;inputs:Record<string,Endpoint[]>;outputs:Record<string,Endpoint>}>();
  for (const [id,ref] of flat.references) references.set(id,{device:ref.device,
    inputs:Object.fromEntries(Object.entries(ref.inputs).map(([p,e])=>[p,actual(e)])),
    outputs:Object.fromEntries(Object.entries(ref.outputs).map(([p,e])=>[p,actual(e)[0]]))});
  const engine=new HeadlessCircuit({devices,connectors,subcircuits:{}});
  return {engine,references,registers};
}
type Session=ReturnType<typeof compile>;

function signal(vector?:Vector3vl):Signal {
  const bin=vector?.toBin().toUpperCase();
  if (!bin) return 'X';
  return /^[01]+$/.test(bin)?Number.parseInt(bin,2):/^X+$/.test(bin)?'X':bin;
}
function binary(value:Signal,bits:number):string {
  if (typeof value==='number') {
    if (!Number.isInteger(value)||value<0||value>=2**bits) throw new Error('寄存器状态超出位宽范围。');
    return value.toString(2).padStart(bits,'0');
  }
  if (value==='X') return 'X'.repeat(bits);
  if (value.length!==bits||!/^[01X]+$/.test(value)) throw new Error('寄存器状态无效。');
  return value;
}
function initial(session:Session,state?:RuntimeState):RuntimeState {
  if (state&&(!Number.isSafeInteger(state.cycle)||state.cycle<0||!state.registers||typeof state.registers!=='object')) throw new Error('时钟状态无效。');
  return {cycle:state?.cycle??0,registers:Object.fromEntries(session.registers.map(r=>{
    const value=state&&Object.hasOwn(state.registers,r.key)?state.registers[r.key]:0;
    binary(value,r.bits);return [r.key,value];
  }))};
}
function settle(engine:HeadlessCircuit) {
  let events=0;
  while (engine.hasPendingEvents) {
    // The synchronous DigitalJS engine commits before returning its resolved promise.
    void engine.updateGatesNext();
    if (++events>100000) throw new Error('信号未能稳定，请检查电路。');
  }
}
function read(engine:HeadlessCircuit,endpoint:Endpoint):Signal {
  const kind=endpoint.port==='out'||endpoint.port.startsWith('out')?'outputSignals':'inputSignals';
  return signal(engine.findDeviceByLabel(endpoint.id).get(kind)[endpoint.port]);
}
function apply(session:Session,circuit:Circuit,inputs:Inputs,state:RuntimeState) {
  for (const node of circuit.nodes.filter(n=>n.type==='INPUT')) {
    const bits=node.bits??1,v=inputs[node.id]??0;
    if (!Number.isInteger(v)||v<0||v>=2**bits) throw new Error(`输入 ${node.id} 超出位宽范围。`);
    session.engine.setInput(session.references.get(node.id)!.device!,Vector3vl.fromBin(v.toString(2).padStart(bits,'0')));
  }
  for (const r of session.registers) session.engine.setInput(r.q.id,Vector3vl.fromBin(binary(state.registers[r.key],r.bits).toLowerCase()));
  settle(session.engine);
}
function outputValue(session:Session,node:CircuitNode):Signal {
  return signal(session.engine.getOutput(session.references.get(node.id)!.device!));
}
function advance(session:Session,circuit:Circuit,inputs:Inputs,state:RuntimeState,tick:boolean):RuntimeState {
  apply(session,circuit,inputs,state);
  if (!tick) return state;
  const registers=Object.fromEntries(session.registers.map(r=>{
    const rst=read(session.engine,r.rst),d=read(session.engine,r.d);
    // Unknown reset merges the reset and data alternatives bit by bit.
    const next=rst===1?0:rst===0?d:signal(Vector3vl.fromBin(binary(d,r.bits).replace(/1/g,'X').toLowerCase()));
    return [r.key,next];
  }));
  const next={registers,cycle:state.cycle+1};
  apply(session,circuit,inputs,next);
  return next;
}
function snapshot(session:Session,circuit:Circuit,library:ComponentLibrary,state:RuntimeState):Simulation {
  const values:Record<string,Signal>={},portValues:Record<string,Signal>={};
  for (const node of circuit.nodes) {
    const refs=session.references.get(node.id)!;
    for (const [id,endpoints] of Object.entries(refs.inputs)) portValues[`${node.id}:${id}`]=read(session.engine,endpoints[0]);
    for (const [id,endpoint] of Object.entries(refs.outputs)) portValues[`${node.id}:${id}`]=read(session.engine,endpoint);
    values[node.id]=node.type==='OUTPUT'?outputValue(session,node):portValues[`${node.id}:${getPorts(node,library).outputs[0]?.id}`]??'X';
  }
  return {values,portValues,wires:Object.fromEntries(circuit.wires.map(w=>[w.id,portValues[`${w.source}:${w.sourceHandle}`]])),
    state:{cycle:state.cycle,registers:{...state.registers}}};
}
function checkedSession(circuit:Circuit,library:ComponentLibrary):Session {
  const error=validateCircuit(circuit,library)[0];if(error)throw new Error(error);
  return compile(circuit,library);
}

export function simulate(circuit:Circuit,inputs:Inputs,library:ComponentLibrary={},options:{state?:RuntimeState;tick?:boolean}={}):Simulation {
  const session=checkedSession(circuit,library);
  try {
    const state=advance(session,circuit,inputs,initial(session,options.state),options.tick??false);
    return snapshot(session,circuit,library,state);
  } finally {session.engine.shutdown();}
}

export function replaySequence(circuit:Circuit,library:ComponentLibrary,steps:SimulationStep[]):Simulation {
  const session=checkedSession(circuit,library),trace:SimulationFrame[]=[];
  try {
    let state=initial(session),inputs:Inputs={};
    if (!steps.length) apply(session,circuit,inputs,state);
    for (const step of steps) {
      inputs=step.inputs;state=advance(session,circuit,inputs,state,step.tick);
      trace.push({cycle:state.cycle,inputs:{...inputs},tick:step.tick,
        outputs:Object.fromEntries(circuit.nodes.filter(n=>n.type==='OUTPUT').map(n=>[n.id,outputValue(session,n)]))});
      if (trace.length>64) trace.shift();
    }
    return {...snapshot(session,circuit,library,state),trace};
  } finally {session.engine.shutdown();}
}

export function judge(circuit:Circuit,library:ComponentLibrary={}):TestResult {
  let session:Session|undefined;
  try {
    session=checkedSession(circuit,library);
    const current=session,level=getLevel(circuit.levelId),outputNodes=circuit.nodes.filter(n=>n.type==='OUTPUT'),rows:TestRow[]=[];
    function row(inputs:Inputs,expectedOutputs:Record<string,number>,details:Partial<TestRow>={}) {
      const actualOutputs=Object.fromEntries(outputNodes.map(n=>[n.id,outputValue(current,n)]));
      const mismatches=level.outputPorts.filter(p=>actualOutputs[p.id]!==expectedOutputs[p.id]).map(p=>p.id),first=level.outputPorts[0].id;
      rows.push({inputs,expected:expectedOutputs[first],actual:actualOutputs[first],expectedOutputs,actualOutputs,mismatches,passed:!mismatches.length,...details});
    }
    if (level.mode==='sequential') {
      for (const scenario of testSequences(level.id)) {
        let state=initial(current);
        scenario.steps.forEach((step,stepIndex)=>{
          state=advance(current,circuit,step.inputs,state,step.tick);
          row(step.inputs,step.expectedOutputs,{scenarioId:scenario.id,scenarioLabel:scenario.label,stepIndex,cycle:state.cycle,tick:step.tick});
        });
      }
    } else for (const inputs of testInputs(level.id)) {
      apply(current,circuit,inputs,initial(current));row(inputs,level.expectedOutputs(inputs));
    }
    return {revision:circuit.revision,passed:rows.length>0&&rows.every(r=>r.passed),rows,failure:rows.find(r=>!r.passed)};
  } catch(e) {return {revision:circuit.revision,passed:false,rows:[],error:(e as Error).message};}
  finally {session?.engine.shutdown();}
}
