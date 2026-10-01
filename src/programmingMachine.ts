import { architectureLibrary, architectureReferenceCircuit } from './architectureCircuits';
import { assemble } from './assembler';
import { programmingReferenceSource } from './programmingSpec';
import type { Circuit, CircuitGraph, ComponentLibrary } from './contracts';

export const isProgrammingLevel=(id:number)=>Number.isInteger(id)&&id>=45&&id<=56;

export function programmingMachine(levelId:number):Circuit {
  if(!isProgrammingLevel(levelId))throw new Error('编程关卡不存在。');
  const circuit=architectureReferenceCircuit(44);
  return {...circuit,levelId,nodes:circuit.nodes.map(n=>n.id==='program'?{...n,words:[]}:n)};
}

/** Every canonical component reachable from the fixed root CPU, in deterministic order. */
export function programmingMachineLibrary():ComponentLibrary {
  const bank=architectureLibrary(),needed=new Set<string>();
  const visit=(graph:CircuitGraph)=>{for(const n of graph.nodes)if(n.type==='COMPONENT'&&!needed.has(n.componentKey!)){
    needed.add(n.componentKey!);visit(bank[n.componentKey!].graph);
  }};
  visit(architectureReferenceCircuit(44));
  return Object.fromEntries([...needed].sort().map(key=>[key,bank[key]]));
}

function stable(value:unknown):unknown {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
function graph(graph:CircuitGraph,root=false) {
  return {nodes:graph.nodes.map(({position:_position,...n})=>{
    if(root&&n.id==='program'){const {words:_words,programSource:_source,...fixed}=n;return fixed;}
    return n;
  }).sort((a,b)=>a.id.localeCompare(b.id)),wires:[...graph.wires].sort((a,b)=>a.id.localeCompare(b.id))};
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
export function validateProgrammingMachine(circuit:Circuit,library:ComponentLibrary):string[] {
  if(!isProgrammingLevel(circuit.levelId))return [];
  if(!equal(graph(circuit,true),graph(programmingMachine(circuit.levelId),true)))return ['编程关卡的固定机器电路被修改。'];
  for(const [key,canonical] of Object.entries(programmingMachineLibrary())){
    const actual=library[key];
    if(!actual)return [`固定机器组件依赖缺失：${key}。`];
    if(!equal({...actual,graph:graph(actual.graph)},{...canonical,graph:graph(canonical.graph)}))return [`固定机器组件被修改：${key}。`];
  }
  return [];
}

/** Runtime session identity ignores layout but includes the ROM and all dependency contents. */
export function programmingSessionKey(circuit:Circuit,library:ComponentLibrary,caller?:string):string {
  return JSON.stringify(stable({caller,levelId:circuit.levelId,graph:graph(circuit),library:Object.fromEntries(Object.entries(library).map(([key,def])=>[key,{...def,graph:graph(def.graph)}]))}));
}
export function programmingReferenceCircuit(levelId:number):Circuit {
  const circuit=programmingMachine(levelId),programSource=programmingReferenceSource(levelId),words=assemble(programSource).words;
  return {...circuit,nodes:circuit.nodes.map(n=>n.id==='program'?{...n,words,programSource}:n)};
}
