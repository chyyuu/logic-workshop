declare module 'digitaljs' {
  import { Vector3vl } from '3vl';
  export class HeadlessCircuit {
    constructor(data: unknown, options?: unknown);
    setInput(id: string, value: Vector3vl): void;
    getOutput(id: string): Vector3vl;
    hasPendingEvents: boolean;
    updateGatesNext(): Promise<number>;
    findDeviceByLabel(label: string): { get(name: string): Record<string, Vector3vl> };
    shutdown(): void;
  }
}
