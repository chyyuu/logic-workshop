import { getLevel } from './levels';
import { createId } from './id';
import { hasCombinationalCycle } from './netlist';
import { isProgrammingLevel, programmingMachine, validateProgrammingMachine } from './programmingMachine';
import type { Circuit, CircuitGraph, CircuitNode, ComponentLibrary, GateType, NodeType, Port } from './contracts';
export type { Circuit, CircuitGraph, CircuitNode, Wire, NodeType } from './contracts';

const gateTypes: GateType[] = ['NAND','NOT','AND','OR','XOR','XNOR','CONST','SPLIT','JOIN','DFF','ROM','RAM'];
const p = (id: string, bits: number): Port => ({ id, label:id, bits });
export function getPorts(node: CircuitNode, library: ComponentLibrary = {}): { inputs: Port[]; outputs: Port[] } {
  const bits = node.bits ?? 1;
  if (node.type === 'COMPONENT') {
    const definition = library[node.componentKey ?? ''];
    if (!definition) throw new Error('组件依赖缺失。');
    return { inputs:definition.inputs, outputs:definition.outputs };
  }
  if (node.type === 'INPUT' || node.type === 'CONST') return { inputs:[], outputs:[p('out',bits)] };
  if (node.type === 'OUTPUT') return { inputs:[p('in',bits)], outputs:[] };
  if (node.type === 'DFF') return { inputs:[p('d',bits),p('rst',1)], outputs:[p('q',bits)] };
  if (node.type === 'ROM') return { inputs:[p('addr',8)], outputs:[p('q',16)] };
  if (node.type === 'RAM') return { inputs:[p('addr',8),p('d',8),p('we',1),p('rst',1)], outputs:[p('q',8)] };
  if (node.type === 'SPLIT') return { inputs:[p('in',bits)], outputs:Array.from({length:bits},(_,i)=>p(`out${i}`,1)) };
  if (node.type === 'JOIN') return { inputs:Array.from({length:bits},(_,i)=>p(`in${i}`,1)), outputs:[p('out',bits)] };
  return { inputs:node.type === 'NOT' ? [p('a',bits)] : [p('a',bits),p('b',bits)], outputs:[p('out',bits)] };
}
export function ports(type: NodeType) {
  const typed = getPorts({ id:'',type,label:'',position:{x:0,y:0} });
  return { inputs:typed.inputs.map(port=>port.id), outputs:typed.outputs.map(port=>port.id) };
}
export function createCircuit(levelId: number): Circuit {
  if(isProgrammingLevel(levelId))return programmingMachine(levelId);
  const level = getLevel(levelId);
  return { levelId,revision:0,wires:[],nodes:[
    ...level.inputPorts.map((port,i)=>({id:port.id,label:port.id,type:'INPUT' as const,bits:port.bits,position:{x:90,y:level.inputPorts.length===1?190:90+i*145}})),
    ...level.outputPorts.map((port,i)=>({id:port.id,label:port.id,type:'OUTPUT' as const,bits:port.bits,position:{x:700,y:level.outputPorts.length===1?190:140+i*145}})),
    ...([38,44].includes(levelId)?[{id:'program',label:'ROM',type:'ROM' as const,bits:16,words:[...(level.defaultProgram??[])],position:{x:380,y:70}}]:[]),
  ] };
}
function validateGraph(graph: CircuitGraph, library: ComponentLibrary): string[] {
  const errors: string[] = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.wires)) return ['组件图无效。'];
  if (graph.nodes.length > 200 || graph.wires.length > 400) return ['电路超过当前版本的规模限制。'];
  if (graph.nodes.some(n=>!n||typeof n!=='object')||graph.wires.some(w=>!w||typeof w!=='object')) return ['组件图无效。'];
  const nodes = new Map(graph.nodes.map(n=>[n.id,n]));
  if (nodes.size !== graph.nodes.length || graph.nodes.some(n=>typeof n.id!=='string'||!n.id||n.id.length>160||n.id.includes(':'))) errors.push('组件 ID 重复或无效。');
  if (new Set(graph.wires.map(w=>w.id)).size !== graph.wires.length || graph.wires.some(w=>typeof w.id!=='string'||!w.id||w.id.length>160)) errors.push('导线 ID 重复或无效。');
  for (const node of graph.nodes) {
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) errors.push('组件位置无效。');
    if (typeof node.label!=='string' || node.label.length>160) errors.push('组件标签无效。');
    if (!['INPUT','OUTPUT','COMPONENT',...gateTypes].includes(node.type)) errors.push('组件类型无效。');
    if (![1,2,4,8,16].includes(node.bits??1)) errors.push('端口位宽无效。');
    if (node.type==='ROM'&&node.bits!==16||node.type==='RAM'&&node.bits!==8) errors.push('存储器位宽无效。');
    if (node.words!==undefined&&(node.type!=='ROM'||!Array.isArray(node.words)||node.words.length>256||Array.from(node.words).some(w=>!Number.isInteger(w)||w<0||w>65535))) errors.push('ROM 程序字无效。');
    if(node.programSource!==undefined&&(node.type!=='ROM'||typeof node.programSource!=='string'||node.programSource.length>32000))errors.push('ROM 程序源文本无效。');
    if (node.type === 'CONST' && (!Number.isInteger(node.value??0)||(node.value??0)<0||(node.value??0)>=2**(node.bits??1))) errors.push('常量超出位宽范围。');
    if (node.type === 'COMPONENT' && !Object.hasOwn(library,node.componentKey??'')) errors.push('组件依赖缺失。');
  }
  const driven = new Set<string>();
  for (const wire of graph.wires) {
    const source = nodes.get(wire.source), target = nodes.get(wire.target);
    if (!source || !target) { errors.push('导线连接到不存在的组件。'); continue; }
    try {
      const from = getPorts(source,library).outputs.find(p=>p.id===wire.sourceHandle);
      const to = getPorts(target,library).inputs.find(p=>p.id===wire.targetHandle);
      if (!from || !to) errors.push('请从输出端口连接到输入端口。');
      else if (from.bits!==to.bits) errors.push('端口位宽不一致。');
    } catch { errors.push('组件依赖缺失。'); }
    const key = `${wire.target}:${wire.targetHandle}`;
    if (driven.has(key)) errors.push('这个输入端口已经有连接，请先删除原导线。');
    driven.add(key);
  }
  return errors;
}
export function validateLibrary(library: ComponentLibrary): string[] {
  if (!library || typeof library!=='object' || Array.isArray(library)) return ['组件库无效。'];
  const entries=Object.entries(library), errors:string[]=[];
  if (entries.length>256) return ['组件库超过规模限制。'];
  for (const [key,def] of entries) {
    if (!def || typeof def!=='object') { errors.push('组件定义无效。');continue; }
    if (typeof def.id!=='string'||!def.id||!Number.isInteger(def.version)||def.version<1||key!==`${def.id}@${def.version}`||typeof def.name!=='string'||!def.name.trim()||def.name.length>60) errors.push('组件版本或名称无效。');
    if (!Array.isArray(def.inputs)||!Array.isArray(def.outputs)||!Array.isArray(def.dependencies)||!def.graph) { errors.push('组件接口无效。');continue; }
    if (def.deleted !== undefined && def.deleted !== true) errors.push('组件删除状态无效。');
    if (!def.deleted && def.dependencies.some(dependency => library[dependency]?.deleted)) errors.push('可用组件不能依赖已删除组件。');
    const interfacePorts=[...def.inputs,...def.outputs];
    if (!def.outputs.length||interfacePorts.length>32||interfacePorts.some(p=>!p||typeof p.id!=='string'||!p.id||p.id.length>160||p.id.includes(':')||typeof p.label!=='string'||![1,2,4,8,16].includes(p.bits))) { errors.push('组件接口无效。');continue; }
    if (new Set(interfacePorts.map(p=>p.id)).size!==interfacePorts.length) errors.push('组件接口无效。');
    const graphErrors=validateGraph(def.graph,library);
    errors.push(...graphErrors);
    if (graphErrors.length) continue;
    for (const [type,list] of [['INPUT',def.inputs],['OUTPUT',def.outputs]] as const) {
      for (const port of list) {
        const n=def.graph.nodes.find(n=>n.id===port.id);
        if (!n||n.type!==type||(n.bits??1)!==port.bits) errors.push('组件接口与内部电路不一致。');
      }
      if (def.graph.nodes.filter(n=>n.type===type).some(n=>!list.some(p=>p.id===n.id))) errors.push('组件包含未声明的接口。');
    }
    const actual=[...new Set(def.graph.nodes.filter(n=>n.type==='COMPONENT').map(n=>n.componentKey))].sort();
    if (JSON.stringify(actual)!==JSON.stringify([...new Set(def.dependencies)].sort())) errors.push('组件依赖清单不一致。');
  }
  const memo=new Map<string,{nodes:number;wires:number;depth:number}>(), active=new Set<string>();
  function measure(key:string): {nodes:number;wires:number;depth:number} {
    if (active.has(key)) throw new Error('组件依赖存在递归循环。');
    if (memo.has(key)) return memo.get(key)!;
    const def=library[key];
    if (!def || !Array.isArray(def.graph?.nodes)||!Array.isArray(def.graph?.wires)) throw new Error('组件依赖缺失。');
    active.add(key);
    let nodes=def.graph.nodes.length, wires=def.graph.wires.length, depth=1;
    for (const node of def.graph.nodes.filter(n=>n.type==='COMPONENT')) {
      const child=measure(node.componentKey??'');nodes+=child.nodes;wires+=child.wires;depth=Math.max(depth,child.depth+1);
      if (nodes>2000||wires>5000||depth>16) throw new Error('组件展开超过规模或深度限制。');
    }
    active.delete(key);const result={nodes,wires,depth};memo.set(key,result);return result;
  }
  for (const [key] of entries) { try { measure(key); } catch (e) { errors.push((e as Error).message);active.clear(); } }
  if (!errors.length) for (const [,def] of entries) if (hasCombinationalCycle(def.graph,library)) errors.push('组合电路不能形成反馈回路。');
  return [...new Set(errors)];
}
export function validateCircuit(circuit: Circuit, library: ComponentLibrary = {}): string[] {
  const errors=validateLibrary(library);
  if (!circuit||!Array.isArray(circuit.nodes)||!Array.isArray(circuit.wires)||circuit.nodes.some(n=>!n||typeof n!=='object')) return [...errors,'电路结构无效。'];
  let level;
  try { level=getLevel(circuit.levelId); } catch { return [...errors,'关卡不存在。']; }
  errors.push(...validateGraph(circuit,library));
  if(!errors.length)errors.push(...validateProgrammingMachine(circuit,library));
  const fixed=createCircuit(circuit.levelId).nodes;
  for (const expected of fixed) {
    const actual=circuit.nodes.find(n=>n.id===expected.id);
    if (!actual||actual.type!==expected.type||actual.label!==expected.label||(actual.bits??1)!==expected.bits) errors.push(`固定端口 ${expected.id} 缺失或被修改。`);
  }
  let expandedNodes=circuit.nodes.length,expandedWires=circuit.wires.length;
  const check=(graph:CircuitGraph,depth:number) => {
    if (depth>16) { errors.push('组件展开超过深度限制。');return; }
    for (const n of graph.nodes) {
      if (n.type==='COMPONENT') {
        const def=library[n.componentKey??''];if (!def) continue;
        expandedNodes+=def.graph.nodes.length;expandedWires+=def.graph.wires.length;
        if (expandedNodes>2000||expandedWires>5000) { errors.push('组件展开超过规模限制。');return; }
        check(def.graph,depth+1);
      } else if (n.type!=='INPUT'&&n.type!=='OUTPUT'&&!level.allowed.includes(n.type)) errors.push('当前关卡不能使用这个逻辑门。');
    }
  };
  if (!errors.length) check(circuit,0);
  if (!errors.length && hasCombinationalCycle(circuit,library)) errors.push('组合电路不能形成反馈回路。');
  for (const n of circuit.nodes) if ((n.type==='INPUT'||n.type==='OUTPUT')&&!fixed.some(f=>f.id===n.id)) errors.push('不允许添加额外的输入输出。');
  return [...new Set(errors)];
}
export function addGate(circuit:Circuit,type:GateType,position:CircuitNode['position'],id=createId('g'),library:ComponentLibrary={},bits=1): Circuit {
  const next={...circuit,revision:circuit.revision+1,nodes:[...circuit.nodes,{id,type,label:type,position,bits:type==='ROM'?16:type==='RAM'?8:bits,...(type==='ROM'?{words:[]}: {})}]};
  const error=validateCircuit(next,library)[0];if(error) throw new Error(error);return next;
}
export function addComponent(circuit:Circuit,key:string,position:CircuitNode['position'],library:ComponentLibrary,id=createId('c')): Circuit {
  const def=library[key];if(!def)throw new Error('组件依赖缺失。');
  if(def.deleted)throw new Error('组件已删除，不能继续使用。');
  const next={...circuit,revision:circuit.revision+1,nodes:[...circuit.nodes,{id,type:'COMPONENT' as const,label:def.name,componentKey:key,position}]};
  const error=validateCircuit(next,library)[0];if(error)throw new Error(error);return next;
}
export function connect(circuit:Circuit,source:string,sourceHandle:string,target:string,targetHandle:string,library:ComponentLibrary={}):Circuit {
  const next={...circuit,revision:circuit.revision+1,wires:[...circuit.wires,{id:createId('w'),source,sourceHandle,target,targetHandle}]};
  const error=validateCircuit(next,library)[0];if(error)throw new Error(error);return next;
}
export function canConnect(circuit:Circuit,source:string,sourceHandle:string,target:string,targetHandle:string,library:ComponentLibrary={}):boolean {
  try { connect(circuit,source,sourceHandle,target,targetHandle,library);return true; } catch { return false; }
}
export function removeSelection(circuit:Circuit,nodeIds:string[],wireIds:string[]):Circuit {
  if(isProgrammingLevel(circuit.levelId))return circuit;
  const removable=new Set(circuit.nodes.filter(n=>n.type!=='INPUT'&&n.type!=='OUTPUT'&&!([38,44].includes(circuit.levelId)&&n.id==='program')&&nodeIds.includes(n.id)).map(n=>n.id));
  return {...circuit,revision:circuit.revision+1,nodes:circuit.nodes.filter(n=>!removable.has(n.id)),wires:circuit.wires.filter(w=>!wireIds.includes(w.id)&&!removable.has(w.source)&&!removable.has(w.target))};
}
