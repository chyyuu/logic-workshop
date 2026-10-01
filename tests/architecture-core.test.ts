import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levels } from '../src/levels';
import { createCircuit, getPorts, removeSelection, validateCircuit, validateLibrary } from '../src/model';
import { hasSequential, judge, replaySequence, simulate } from '../src/simulator';
import type { Level } from '../src/levels';
import type { Circuit, CircuitNode, ComponentLibrary, Wire } from '../src/contracts';

const node=(id:string,type:CircuitNode['type'],bits=1):CircuitNode=>({id,type,bits,label:id,position:{x:300,y:100}});
const wire=(source:string,sourceHandle:string,target:string,targetHandle:string):Wire=>({id:`${source}.${sourceHandle}-${target}.${targetHandle}`,source,sourceHandle,target,targetHandle});
beforeAll(()=>levels.push({...levels[31],id:101,inputPorts:[['Addr',8],['D',8],['W',1],['R',1],['A',16]].map(([id,bits])=>({id:String(id),label:String(id),bits:Number(bits)})),outputPorts:[{id:'Q',label:'Q',bits:8},{id:'IR',label:'IR',bits:16}],allowed:['DFF','ROM','RAM','CONST','NOT','JOIN','SPLIT','AND','OR','XOR','NAND','XNOR']}));
afterAll(()=>{const i=levels.findIndex(l=>l.id===101);if(i>=0)levels.splice(i,1);});
function ram():Circuit {
  const c=createCircuit(101);c.nodes.push(node('mem','RAM',8));
  c.wires.push(wire('Addr','out','mem','addr'),wire('D','out','mem','d'),wire('W','out','mem','we'),wire('R','out','mem','rst'),wire('mem','q','Q','in'));
  return c;
}
describe('architecture storage primitives',()=>{
  it('supports a sixteen-bit gate and register bus',()=>{
    const c=createCircuit(101);c.nodes.push(node('inv','NOT',16),node('ir','DFF',16));
    c.wires.push(wire('A','out','inv','a'),wire('inv','out','ir','d'),wire('R','out','ir','rst'),wire('ir','q','IR','in'));
    expect(validateCircuit(c)).toEqual([]);
    expect(simulate(c,{A:0x1234,R:0},{},{tick:true}).values.IR).toBe(0xedcb);
  });
  it('reads all ROM addresses, including a combinational cascade that needs repeated settling',()=>{
    const c=createCircuit(101),words=Array(256).fill(0);words[255]=0xbeef;
    c.nodes.push({...node('rom','ROM',16),words}, {...node('index','ROM',16),words:[255]},node('split','SPLIT',16),node('join','JOIN',8));
    c.wires.push(wire('R','out','index','addr')); // Replace with an eight-bit zero below.
    c.nodes.push({...node('zero','CONST',8),value:0});c.wires[0]=wire('zero','out','index','addr');
    c.wires.push(wire('index','q','split','in'),wire('join','out','rom','addr'),wire('rom','q','IR','in'));
    for(let i=0;i<8;i++)c.wires.push(wire('split',`out${i}`,'join',`in${i}`));
    expect(simulate(c,{}).values.IR).toBe(0xbeef);
    c.wires=c.wires.filter(w=>w.target!=='rom');c.wires.push(wire('Addr','out','rom','addr'));
    expect(simulate(c,{Addr:255}).values.IR).toBe(0xbeef);
    expect(simulate(c,{Addr:254}).values.IR).toBe(0);
  });
  it('captures the old ROM address on the same edge that changes its address register',()=>{
    const c=createCircuit(101);c.nodes.push({...node('rom','ROM',16),words:[0x1234,0xabcd]},node('pc','DFF',8),node('ir','DFF',16));
    c.wires.push(wire('Addr','out','pc','d'),wire('R','out','pc','rst'),wire('pc','q','rom','addr'),wire('rom','q','ir','d'),wire('R','out','ir','rst'),wire('ir','q','IR','in'));
    const first=simulate(c,{Addr:1,R:0},{},{tick:true});expect(first.values.IR).toBe(0x1234);expect(first.values.rom).toBe(0xabcd);
    expect(simulate(c,{Addr:0,R:0},{},{state:first.state,tick:true}).values.IR).toBe(0xabcd);
  });
  it('writes on edges, reads combinationally, retains high addresses, and resets synchronously',()=>{
    const c=ram();expect(hasSequential(c)).toBe(true);
    const written=replaySequence(c,{},[{inputs:{Addr:255,D:165,W:1,R:0},tick:false},{inputs:{Addr:255,D:165,W:1,R:0},tick:true},{inputs:{Addr:7,D:12,W:1,R:0},tick:true}]);
    expect(written.trace?.map(f=>f.outputs.Q)).toEqual([0,165,12]);
    expect(simulate(c,{Addr:255,R:1},{},{state:written.state}).values.Q).toBe(165);
    const cleared=simulate(c,{Addr:255,R:1,W:1,D:255},{},{state:written.state,tick:true});
    expect(cleared.values.Q).toBe(0);expect(cleared.state?.memories?.mem).toEqual(Array(256).fill(0));
    expect(written.state?.memories?.mem[255]).toBe(165);
  });
  it('allows write feedback but rejects asynchronous address feedback',()=>{
    const c=ram();c.wires=c.wires.filter(w=>w.targetHandle!=='d');c.wires.push(wire('mem','q','mem','d'));
    expect(validateCircuit(c)).toEqual([]);
    c.wires=c.wires.filter(w=>w.targetHandle!=='addr');c.wires.push(wire('mem','q','mem','addr'));
    expect(validateCircuit(c).join(' ')).toMatch(/回路/);
  });
  it('captures the old addressed RAM byte while the same edge overwrites it',()=>{
    const c=ram();c.nodes.push(node('capture','DFF',8));
    c.wires.push(wire('mem','q','capture','d'),wire('R','out','capture','rst'));
    const loaded=simulate(c,{Addr:240,D:17,W:1,R:0},{},{tick:true});
    const overwritten=simulate(c,{Addr:240,D:99,W:1,R:0},{},{state:loaded.state,tick:true});
    expect(overwritten.values.Q).toBe(99);expect(overwritten.values.capture).toBe(17);
  });
  it('preserves known address bits and conservatively merges an uncertain reset',()=>{
    const c=ram();c.nodes.push(node('address','DFF',8));
    c.wires=c.wires.filter(w=>w.targetHandle!=='addr');c.wires.push(wire('address','q','mem','addr'));
    const memory=Array(256).fill(0);memory[254]=0xa4;memory[255]=0xa5;
    const state={cycle:0,registers:{address:'1111111X'},memories:{mem:memory}};
    expect(simulate(c,{W:0,R:0},{},{state}).values.Q).toBe('1010010X');
    c.wires=c.wires.filter(w=>!(w.target==='mem'&&w.targetHandle==='rst'));
    const reset=simulate(c,{W:0,R:0},{},{state,tick:true});
    expect(reset.state?.memories?.mem[254]).toBe('X0X00X00');expect(reset.state?.memories?.mem[255]).toBe('X0X00X0X');
    expect(memory[255]).toBe(0xa5);
  });
  it('merges unknown address reads and writes instead of dropping uncertain writes',()=>{
    const c=ram();c.wires=c.wires.filter(w=>w.targetHandle!=='addr');
    const state={cycle:0,registers:{},memories:{mem:Array(256).fill(0)}};
    expect(simulate(c,{}, {},{state}).values.Q).toBe(0);
    state.memories.mem[255]=1;
    expect(simulate(c,{}, {},{state}).values.Q).toBe('0000000X');
    const written=simulate(c,{D:255,W:1,R:0},{},{tick:true});expect(written.values.Q).toBe('X');
    expect(written.state?.memories?.mem.every(v=>v==='X')).toBe(true);
    const known=ram();known.wires=known.wires.filter(w=>w.targetHandle!=='we');
    const uncertain=simulate(known,{Addr:7,D:165,R:0},{},{tick:true});
    expect(uncertain.values.Q).toBe('X0X00X0X');expect(uncertain.state?.memories?.mem[8]).toBe(0);
  });
  it('keeps two packaged RAM instances isolated by instance path',()=>{
    const cell={nodes:[node('Addr','INPUT',8),node('D','INPUT',8),node('W','INPUT'),node('R','INPUT'),node('Q','OUTPUT',8),node('mem','RAM',8)],wires:ram().wires};
    const library:ComponentLibrary={'cell@1':{id:'cell',version:1,name:'RAM cell',inputs:[{id:'Addr',label:'Addr',bits:8},{id:'D',label:'D',bits:8},{id:'W',label:'W',bits:1},{id:'R',label:'R',bits:1}],outputs:[{id:'Q',label:'Q',bits:8}],dependencies:[],graph:cell}};
    const c=createCircuit(101);c.nodes.push({...node('left','COMPONENT'),componentKey:'cell@1'},{...node('right','COMPONENT'),componentKey:'cell@1'}, {...node('off','CONST'),value:0});
    for(const id of ['left','right'])for(const [source,target] of [['Addr','Addr'],['D','D'],['R','R'],[id==='left'?'W':'off','W']])c.wires.push(wire(source,'out',id,target));
    c.wires.push(wire('right','Q','Q','in'));
    expect(validateLibrary(library)).toEqual([]);
    const written=simulate(c,{Addr:255,D:99,W:1,R:0},library,{tick:true});
    expect(written.values.Q).toBe(0);expect(written.state?.memories?.['left/mem'][255]).toBe(99);expect(written.state?.memories?.['right/mem'][255]).toBe(0);
  });
  it('validates fixed memory widths and word values',()=>{
    expect(getPorts(node('rom','ROM',16))).toEqual({inputs:[{id:'addr',label:'addr',bits:8}],outputs:[{id:'q',label:'q',bits:16}]});
    for(const bad of [node('rom','ROM',8),{...node('rom','ROM',16),words:[65536]},{...node('rom','ROM',16),words:Array(257).fill(0)},node('ram','RAM',16)]){
      const c=createCircuit(101);c.nodes.push(bad);expect(validateCircuit(c).length).toBeGreaterThan(0);
    }
  });
});

describe('scenario programs',()=>{
  let original:Level|undefined;
  beforeAll(()=>{
    original=levels.find(l=>l.id===38);if(original)levels.splice(levels.indexOf(original),1);
    levels.push({...levels[31],id:38,inputPorts:[{id:'Addr',label:'Addr',bits:8},{id:'R',label:'R',bits:1}],outputPorts:[{id:'IR',label:'IR',bits:16}],allowed:['ROM','DFF'],defaultProgram:[0x1111,0x2222],sequences:()=>[
      {id:'alternate',label:'alternate',program:[0x3333,0x4444],steps:[{inputs:{Addr:1,R:0},tick:true,expectedOutputs:{IR:0x4444}}]},
      {id:'default',label:'default',steps:[{inputs:{Addr:1,R:0},tick:true,expectedOutputs:{IR:0x2222}}]},
    ]});
  });
  afterAll(()=>{levels.splice(levels.findIndex(l=>l.id===38),1);if(original)levels.push(original);});
  function fetch(){const c=createCircuit(38);c.nodes.push(node('ir','DFF',16));c.wires.push(wire('Addr','out','program','addr'),wire('program','q','ir','d'),wire('R','out','ir','rst'),wire('ir','q','IR','in'));return c;}
  it('creates a protected program ROM with editable words',()=>{
    const c=fetch();expect(c.nodes.find(n=>n.id==='program')?.words).toEqual([0x1111,0x2222]);
    expect(simulate(c,{Addr:0,R:0}).activeProgram).toBeUndefined();
    expect(removeSelection(c,['program'],[]).nodes.some(n=>n.id==='program')).toBe(true);
    c.nodes.find(n=>n.id==='program')!.words=[0xbeef];expect(validateCircuit(c)).toEqual([]);
    c.nodes=c.nodes.filter(n=>n.id!=='program');expect(validateCircuit(c).length).toBeGreaterThan(0);
  });
  it('replays and grades the real fixed ROM with each scenario program without mutating the circuit',()=>{
    const c=fetch(),steps=[{inputs:{Addr:1,R:0},tick:true}];
    const result=replaySequence(c,{},steps,[0x3333,0x4444]);expect(result.values.IR).toBe(0x4444);expect(result.activeProgram).toEqual([0x3333,0x4444]);
    expect(c.nodes.find(n=>n.id==='program')?.words).toEqual([0x1111,0x2222]);
    expect(judge(c).passed).toBe(true);
    expect(()=>replaySequence(c,{},steps,[65536])).toThrow(/程序字/);
  });
});
