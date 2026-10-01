import { judge, simulate } from './simulator';
import { parseWorkspace } from './storage';
import type { Circuit, ComponentLibrary, Inputs } from './contracts';
interface Request {id:number;operation:'simulate'|'judge'|'verify'|'load';circuit?:Circuit;inputs?:Inputs;library?:ComponentLibrary;proofs?:Record<number,Circuit>;text?:string}
globalThis.addEventListener('message',(event:MessageEvent<Request>)=>{
  const request=event.data;
  try {
    let result:unknown;
    if(request.operation==='load') {
      if(typeof request.text!=='string')throw new Error('存档内容无效。');
      result=parseWorkspace(request.text);
    }
    else if(request.operation==='simulate') result=simulate(request.circuit!,request.inputs??{},request.library??{});
    else if(request.operation==='judge') result=judge(request.circuit!,request.library??{});
    else if(request.operation==='verify') {
      const valid:Record<number,Circuit>={};
      for(let id=1;id<=20;id++) {
        const proof=request.proofs?.[id];
        if(!proof||proof.levelId!==id||!judge(proof,request.library??{}).passed)break;
        valid[id]=proof;
      }
      result=valid;
    } else throw new Error('未知模拟任务。');
    globalThis.postMessage({id:request.id,result});
  } catch(e) {globalThis.postMessage({id:request.id,error:(e as Error).message});}
});
