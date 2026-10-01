import { describe, expect, it } from 'vitest';
import { addGate, connect, createCircuit, validateCircuit, validateLibrary, addComponent } from '../src/model';
import { encapsulateSelection, expandComponent, packageCircuit } from '../src/components';
import { judge, simulate } from '../src/simulator';

function andCircuit() {
  let c = addGate(createCircuit(4), 'NAND', { x: 300, y: 100 }, 'n');
  c = addGate(c, 'NOT', { x: 450, y: 100 }, 'i');
  for (const [s, sh, t, th] of [['A','out','n','a'],['B','out','n','b'],['n','out','i','a'],['i','out','Y','in']]) c = connect(c,s,sh,t,th);
  return c;
}

describe('immutable reusable component graphs', () => {
  it('preserves all inputs through nested encapsulation and expansion', () => {
    const original = andCircuit();
    const inner = encapsulateSelection(original, ['n'], 'NAND block', {});
    const outer = encapsulateSelection(inner.circuit, [inner.circuit.nodes.find(n => n.type === 'COMPONENT')!.id, 'i'], 'AND block', inner.library);
    const expanded = expandComponent(outer.circuit, outer.circuit.nodes.find(n => n.type === 'COMPONENT')!.id, outer.library);
    for (const A of [0,1]) for (const B of [0,1]) {
      const expected = simulate(original, { A,B }).values.Y;
      expect(simulate(outer.circuit, { A,B }, outer.library).values.Y).toBe(expected);
      expect(simulate(expanded, { A,B }, outer.library).values.Y).toBe(expected);
    }
    expect(judge(outer.circuit, outer.library).passed).toBe(true);
    expect(outer.library[outer.key].dependencies).toEqual([inner.key]);
  });

  it('packages independent immutable versions and rejects missing definitions', () => {
    const first = packageCircuit(andCircuit(), 'AND', {});
    const second = packageCircuit(andCircuit(), 'AND', first.library);
    expect(second.definition.id).toBe(first.definition.id);
    expect(second.definition.version).toBe(2);
    expect(second.library[first.key]).toEqual(first.definition);
    let c = addComponent(createCircuit(4), first.key, { x:300,y:100 }, first.library, 'unit');
    c = connect(c,'A','out','unit','A',first.library);
    c = connect(c,'B','out','unit','B',first.library);
    c = connect(c,'unit','Y','Y','in',first.library);
    expect(judge(c,first.library).passed).toBe(true);
    expect(validateCircuit(c, {})).toContain('组件依赖缺失。');
  });

  it('rejects recursion and concealed forbidden primitives', () => {
    const packaged = packageCircuit(andCircuit(), 'AND', {});
    const bad = structuredClone(packaged.library);
    bad[packaged.key].graph.nodes.push({ id:'recursive',type:'COMPONENT',label:'loop',componentKey:packaged.key,position:{x:0,y:0} });
    bad[packaged.key].dependencies = [packaged.key];
    expect(validateCircuit(andCircuit(), bad).join(' ')).toMatch(/循环|递归/);
    expect(() => addComponent(createCircuit(1), packaged.key, {x:0,y:0}, packaged.library)).toThrow(/关卡/);
  });

  it('preserves deduplicated incoming fanout and multiple outgoing branches', () => {
    let c=addGate(createCircuit(15),'NAND',{x:300,y:100},'n');
    c=connect(c,'A','out','n','a');c=connect(c,'A','out','n','b');
    c=connect(c,'n','out','Sum','in');c=connect(c,'n','out','Carry','in');
    const packaged=encapsulateSelection(c,['n'],'branching inverter',{});
    expect(packaged.definition.inputs).toHaveLength(1);
    expect(packaged.definition.outputs).toHaveLength(1);
    const expanded=expandComponent(packaged.circuit,packaged.circuit.nodes.find(n=>n.type==='COMPONENT')!.id,packaged.library);
    for(const A of [0,1]) {
      const before=simulate(c,{A,B:1}).values;
      const after=simulate(packaged.circuit,{A,B:1},packaged.library).values;
      const restored=simulate(expanded,{A,B:1},packaged.library).values;
      expect([after.Sum,after.Carry]).toEqual([before.Sum,before.Carry]);
      expect([restored.Sum,restored.Carry]).toEqual([before.Sum,before.Carry]);
    }
    expect(expanded.wires).toHaveLength(c.wires.length);
  });

  it('preserves partial bus unknowns and their exact output port values', () => {
    let c=addGate(createCircuit(11),'JOIN',{x:300,y:100},'join',{},4);
    c=connect(c,'b0','out','join','in0');c=connect(c,'b1','out','join','in1');
    c=connect(c,'b3','out','join','in3');c=connect(c,'join','out','Y','in');
    const before=simulate(c,{b0:1,b1:0,b2:1,b3:1});
    expect(before.values.Y).toBe('1X01');expect(before.portValues['join:out']).toBe('1X01');
    const packaged=encapsulateSelection(c,['join'],'partial bus',{});
    expect(simulate(packaged.circuit,{b0:1,b1:0,b2:1,b3:1},packaged.library).values.Y).toBe('1X01');
    expect(()=>connect(c,'b2','out','Y','in')).toThrow(/位宽/);
  });

  it('expands a direct interface wire without an internal gate', () => {
    const original=connect(createCircuit(1),'A','out','Y','in');
    const packaged=packageCircuit(original,'wire',{});
    let c=addComponent(createCircuit(1),packaged.key,{x:300,y:100},packaged.library,'unit');
    c=connect(c,'A','out','unit','A',packaged.library);c=connect(c,'unit','Y','Y','in',packaged.library);
    const expanded=expandComponent(c,'unit',packaged.library);
    expect(expanded.nodes).toHaveLength(2);expect(expanded.wires).toHaveLength(1);
    expect(judge(expanded,packaged.library).passed).toBe(true);
  });

  it('bounds repeated dependency expansion before constructing an engine', () => {
    const original=connect(createCircuit(1),'A','out','Y','in');
    let built=packageCircuit(original,'base',{});
    for(let index=0;index<10;index++) {
      const def=structuredClone(built.definition);
      def.id=`layer-${index}`;def.name=def.id;def.version=1;
      def.graph.nodes=def.graph.nodes.filter(n=>n.type!=='COMPONENT');
      def.graph.nodes.push(...Array.from({length:3},(_,i)=>({id:`c${i}`,type:'COMPONENT' as const,label:'nested',componentKey:built.key,position:{x:0,y:0}})));
      def.dependencies=[built.key];
      const key=`${def.id}@1`,library={...built.library,[key]:def};
      const errors=validateLibrary(library);
      if(errors.length){expect(errors.join(' ')).toMatch(/规模/);return;}
      built={definition:def,key,library};
    }
    throw new Error('Expansion bound did not trigger.');
  });

  it('rejects malformed unused definitions without throwing parser exceptions', () => {
    const packaged=packageCircuit(connect(createCircuit(1),'A','out','Y','in'),'wire',{});
    for(const change of ['port','node','wires']) {
      const library=structuredClone(packaged.library);
      const definition=library[packaged.key];
      if(change==='port') definition.inputs=[null as never];
      if(change==='node') definition.graph.nodes=[null as never];
      if(change==='wires') definition.graph.wires=null as never;
      expect(validateLibrary(library).length).toBeGreaterThan(0);
      expect(validateCircuit(createCircuit(1),library).length).toBeGreaterThan(0);
    }
  });

  it('can repeatedly expand deep wrappers without accumulating IDs', () => {
    let c=andCircuit(),library={};
    for(let i=0;i<6;i++) {
      const selection=c.nodes.filter(n=>n.type!=='INPUT'&&n.type!=='OUTPUT').map(n=>n.id);
      const built=encapsulateSelection(c,selection,`wrapper ${i}`,library);
      c=built.circuit;library=built.library;
    }
    for(let i=0;i<6;i++) {
      c=expandComponent(c,c.nodes.find(n=>n.type==='COMPONENT')!.id,library);
      expect(judge(c,library).passed).toBe(true);
    }
    expect(c.nodes.filter(n=>n.type==='COMPONENT')).toHaveLength(0);
  });
});
