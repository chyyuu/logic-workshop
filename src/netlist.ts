import type { CircuitGraph, CircuitNode, ComponentLibrary } from './contracts';
import { getPorts } from './model';

export interface Endpoint { id:string; port:string; }
export interface References { inputs:Record<string,Endpoint>; outputs:Record<string,Endpoint>; device?:string; }
export interface FlatNode { id:string; node:CircuitNode; root:boolean; }

/** Interface nodes remain repeaters, so each component output retains its real dependency. */
export function flattenGraph(graph:CircuitGraph,library:ComponentLibrary) {
  const nodes:FlatNode[]=[],wires:{from:Endpoint;to:Endpoint}[]=[];
  function flatten(graph:CircuitGraph,path:string[],root:boolean):Map<string,References> {
    const refs=new Map<string,References>();
    for (const node of graph.nodes) {
      const location=[...path,encodeURIComponent(node.id)],id=location.join('/');
      if (node.type==='COMPONENT') {
        const definition=library[node.componentKey!]!,child=flatten(definition.graph,location,false);
        refs.set(node.id,{
          inputs:Object.fromEntries(definition.inputs.map(p=>[p.id,{id:child.get(p.id)!.device!,port:'in'}])),
          outputs:Object.fromEntries(definition.outputs.map(p=>[p.id,{id:child.get(p.id)!.device!,port:'out'}])),
        });
      } else {
        nodes.push({id,node,root});
        const ports=getPorts(node,library);
        refs.set(node.id,{device:id,inputs:Object.fromEntries(ports.inputs.map(p=>[p.id,{id,port:p.id}])),outputs:Object.fromEntries(ports.outputs.map(p=>[p.id,{id,port:p.id}]))});
      }
    }
    for (const wire of graph.wires) wires.push({from:refs.get(wire.source)!.outputs[wire.sourceHandle],to:refs.get(wire.target)!.inputs[wire.targetHandle]});
    return refs;
  }
  return {nodes,wires,references:flatten(graph,[],true)};
}

export function hasCombinationalCycle(graph:CircuitGraph,library:ComponentLibrary):boolean {
  const {nodes,wires}=flattenGraph(graph,library),types=new Map(nodes.map(n=>[n.id,n.node.type]));
  const outgoing=new Map<string,string[]>(),indegree=new Map(nodes.map(n=>[n.id,0]));
  for (const {from,to} of wires) {
    if (types.get(to.id)==='DFF') continue;
    outgoing.set(from.id,[...(outgoing.get(from.id)??[]),to.id]);
    indegree.set(to.id,indegree.get(to.id)!+1);
  }
  const ready=nodes.filter(n=>indegree.get(n.id)===0).map(n=>n.id);
  let visited=0;
  while (ready.length) {
    const id=ready.pop()!;visited++;
    for (const next of outgoing.get(id)??[]) {
      const remaining=indegree.get(next)!-1;indegree.set(next,remaining);
      if (!remaining) ready.push(next);
    }
  }
  return visited!==nodes.length;
}

export function hasSequential(graph:CircuitGraph,library:ComponentLibrary={}):boolean {
  const visited=new Set<string>();
  function search(graph:CircuitGraph):boolean {
    for (const node of graph.nodes) {
      if (node.type==='DFF') return true;
      if (node.type==='COMPONENT'&&!visited.has(node.componentKey!)) {
        visited.add(node.componentKey!);
        const definition=library[node.componentKey!];
        if (definition&&search(definition.graph)) return true;
      }
    }
    return false;
  }
  return search(graph);
}
