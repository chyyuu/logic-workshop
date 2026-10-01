import { useEffect, useRef, useState } from 'react';
import type { Circuit, ComponentLibrary, Inputs, Simulation } from './contracts';

interface Reply<T> { id: number; result?: T; error?: string; }
export function backgroundTask<T>(operation: 'judge' | 'verify' | 'load', payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { stop(); reject(new DOMException('任务已取消', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Reply<T>>) => {
      stop(); data.error ? reject(new Error(data.error)) : resolve(data.result as T);
    };
    worker.onerror = event => { stop(); reject(new Error(event.message || '仿真线程启动失败。')); };
    worker.postMessage({ id: 1, operation, ...payload });
  });
}

const empty: Simulation = { values: {}, portValues: {}, wires: {} };
export function useSimulation(circuit: Circuit, inputs: Inputs, library: ComponentLibrary) {
  const [state, setState] = useState({ ...empty, error: '', pending: true });
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const graphKey = JSON.stringify({ level: circuit.levelId, nodes: circuit.nodes.map(({ position: _position, ...node }) => node), wires: circuit.wires, library });
  const inputKey = JSON.stringify(inputs);
  useEffect(() => {
    const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<Reply<Simulation>>) => {
      if (data.id !== requestRef.current) return;
      setState(data.error ? { ...empty, error: data.error, pending: false } : { ...data.result!, error: '', pending: false });
    };
    worker.onerror = event => setState({ ...empty, error: event.message || '仿真线程启动失败。', pending: false });
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);
  useEffect(() => {
    const id = ++requestRef.current;
    setState({ ...empty, pending: true, error: '' });
    workerRef.current?.postMessage({ id, operation: 'simulate', circuit, inputs, library });
  }, [graphKey, inputKey]);
  return state;
}
