import { HeadlessCircuit } from 'digitaljs';
import { Vector3vl } from '3vl';
import { getLevel, testInputs } from './levels';
import { getPorts, validateCircuit } from './model';
import type { Circuit, CircuitGraph, CircuitNode, ComponentLibrary, Inputs, Signal, Simulation, TestResult, TestRow } from './contracts';
export type { Signal, Simulation, TestResult, TestRow } from './contracts';

interface Endpoint { id:string;port:string; }
interface References { inputs:Record<string,Endpoint[]>;outputs:Record<string,Endpoint>;device?:string; }

function compile(circuit:Circuit,library:ComponentLibrary) {
  const devices:Record<string,Record<string,unknown>>={},connectors:{from:Endpoint;to:Endpoint}[]=[];
  let count=0;
  function flatten(graph:CircuitGraph,root:boolean):Map<string,References> {
    const refs=new Map<string,References>();
    for (const node of graph.nodes) {
      if (node.type==='COMPONENT') {
        const definition=library[node.componentKey!]!,child=flatten(definition.graph,false);
        refs.set(node.id,{inputs:Object.fromEntries(definition.inputs.map(p=>[p.id,[{id:child.get(p.id)!.device!,port:'in'}]])),
          outputs:Object.fromEntries(definition.outputs.map(p=>[p.id,{id:child.get(p.id)!.device!,port:'out'}]))});
        continue;
      }
      const id=`device-${count++}`,bits=node.bits??1;
      const type=node.type==='INPUT'?root?'Input':'Repeater':node.type==='OUTPUT'?root?'Output':'Repeater':
        ({NAND:'Nand',NOT:'Nand',AND:'And',OR:'Or',XOR:'Xor',XNOR:'Xnor',CONST:'Constant',SPLIT:'BusUngroup',JOIN:'BusGroup'} as const)[node.type];
      devices[id]={type,bits,label:id,net:node.label,
        ...(node.type==='CONST'?{constant:(node.value??0).toString(2).padStart(bits,'0')}:{}),
        ...(['SPLIT','JOIN'].includes(node.type)?{groups:Array(bits).fill(1)}:{})};
      const portMap=getPorts(node,library);
      refs.set(node.id,{device:id,
        inputs:Object.fromEntries(portMap.inputs.map(p=>[p.id,node.type==='NOT'?[{id,port:'in1'},{id,port:'in2'}]:[{id,port:p.id==='a'?'in1':p.id==='b'?'in2':p.id}]])),
        outputs:Object.fromEntries(portMap.outputs.map(p=>[p.id,{id,port:p.id}]))});
    }
    for (const wire of graph.wires) {
      const from=refs.get(wire.source)!.outputs[wire.sourceHandle];
      for (const to of refs.get(wire.target)!.inputs[wire.targetHandle]) connectors.push({from,to});
    }
    return refs;
  }
  const references=flatten(circuit,true);
  const engine=new HeadlessCircuit({devices,connectors,subcircuits:{}});
  return {engine,references};
}

function signal(vector?:Vector3vl):Signal {
  const bin=vector?.toBin().toUpperCase();
  if (!bin) return 'X';
  return /^[01]+$/.test(bin)?Number.parseInt(bin,2):/^X+$/.test(bin)?'X':bin;
}
function apply(engine:HeadlessCircuit,refs:Map<string,References>,circuit:Circuit,inputs:Inputs) {
  for (const node of circuit.nodes.filter(n=>n.type==='INPUT')) {
    const bits=node.bits??1,v=inputs[node.id]??0;
    if (!Number.isInteger(v)||v<0||v>=2**bits) throw new Error(`输入 ${node.id} 超出位宽范围。`);
    engine.setInput(refs.get(node.id)!.device!,Vector3vl.fromBin(v.toString(2).padStart(bits,'0')));
  }
  let events=0;
  while (engine.hasPendingEvents) {
    // DigitalJS SynchEngine commits before returning its resolved promise.
    void engine.updateGatesNext();
    if (++events>100000) throw new Error('信号未能稳定，请检查电路。');
  }
}
function read(engine:HeadlessCircuit,endpoint:Endpoint):Signal {
  const kind=endpoint.port==='out'||endpoint.port.startsWith('out')?'outputSignals':'inputSignals';
  return signal(engine.findDeviceByLabel(endpoint.id).get(kind)[endpoint.port]);
}
function outputValue(engine:HeadlessCircuit,refs:Map<string,References>,node:CircuitNode):Signal {
  return signal(engine.getOutput(refs.get(node.id)!.device!));
}

export function simulate(circuit:Circuit,inputs:Inputs,library:ComponentLibrary={}):Simulation {
  const error=validateCircuit(circuit,library)[0];if(error)throw new Error(error);
  const {engine,references}=compile(circuit,library);
  try {
    apply(engine,references,circuit,inputs);
    const values:Record<string,Signal>={},portValues:Record<string,Signal>={};
    for (const node of circuit.nodes) {
      const refs=references.get(node.id)!;
      for (const [id,endpoints] of Object.entries(refs.inputs)) portValues[`${node.id}:${id}`]=read(engine,endpoints[0]);
      for (const [id,endpoint] of Object.entries(refs.outputs)) portValues[`${node.id}:${id}`]=read(engine,endpoint);
      values[node.id]=node.type==='OUTPUT'?outputValue(engine,references,node):portValues[`${node.id}:${getPorts(node,library).outputs[0]?.id}`]??'X';
    }
    return {values,portValues,wires:Object.fromEntries(circuit.wires.map(w=>[w.id,portValues[`${w.source}:${w.sourceHandle}`]]))};
  } finally { engine.shutdown(); }
}

export function judge(circuit:Circuit,library:ComponentLibrary={}):TestResult {
  const error=validateCircuit(circuit,library)[0];
  if(error)return{revision:circuit.revision,passed:false,rows:[],error};
  const level=getLevel(circuit.levelId),{engine,references}=compile(circuit,library);
  try {
    const outputNodes=circuit.nodes.filter(n=>n.type==='OUTPUT');
    const rows:TestRow[]=testInputs(level.id).map(inputs=>{
      apply(engine,references,circuit,inputs);
      const expectedOutputs=level.expectedOutputs(inputs),actualOutputs=Object.fromEntries(outputNodes.map(n=>[n.id,outputValue(engine,references,n)]));
      const mismatches=level.outputPorts.filter(p=>actualOutputs[p.id]!==expectedOutputs[p.id]).map(p=>p.id);
      const first=level.outputPorts[0].id;
      return{inputs,expected:expectedOutputs[first],actual:actualOutputs[first],expectedOutputs,actualOutputs,mismatches,passed:!mismatches.length};
    });
    return{revision:circuit.revision,passed:rows.every(r=>r.passed),rows,failure:rows.find(r=>!r.passed)};
  } catch(e) { return{revision:circuit.revision,passed:false,rows:[],error:(e as Error).message}; }
  finally {engine.shutdown();}
}
