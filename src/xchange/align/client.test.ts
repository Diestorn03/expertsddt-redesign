import { describe, expect, it } from 'vitest';
import { maxAbsDiff } from '../core/mat4';
import type { XchangeError } from '../core/errors';
import { makeSyntheticCase } from '../test/fixtures';
import { AlignClient, type WorkerLike } from './client';
import { createAlignHandler } from './handler';
import { buildIcpTarget } from './icp';
import { multiStartAlign, type AlignStage } from './multistart';
import type { AlignRequest, AlignResponse } from './protocol';

type Listener = (event: MessageEvent | ErrorEvent) => void;

/** A worker in the same thread: messages are structured-cloned and delivered on later macrotasks. */
class FakeWorker implements WorkerLike {
  readonly received: AlignRequest[] = [];
  terminated = false;
  crashOnMessage = false;
  private readonly listeners: Record<'message' | 'error', Listener[]> = { message: [], error: [] };
  private readonly handle = createAlignHandler((message, transfer) => {
    const data = structuredClone(message, { transfer: transfer ?? [] });
    setTimeout(() => this.emit('message', { data } as unknown as MessageEvent));
  });

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const data = structuredClone(message, { transfer: transfer ?? [] }) as AlignRequest;
    setTimeout(() => {
      if (this.terminated) return;
      this.received.push(data);
      if (this.crashOnMessage) this.emit('error', {} as ErrorEvent);
      else this.handle(data);
    });
  }

  addEventListener(type: 'message' | 'error', listener: Listener): void {
    this.listeners[type].push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(type: 'message' | 'error', event: MessageEvent | ErrorEvent): void {
    if (!this.terminated) for (const listener of this.listeners[type]) listener(event);
  }
}

function setup(): { client: AlignClient; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const client = new AlignClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

const c = makeSyntheticCase({ seed: 81, implants: 3, maxAngleRad: 1.5, archOptions: { segmentsAlong: 48, segmentsAcross: 6 } });
const code = (error: unknown): string => (error as XchangeError).code;

describe('AlignClient <-> handler', () => {
  it('aligns in the worker exactly like in process, with progress, and returns the deviation map', async () => {
    const { client, workers } = setup();
    await client.setJaw(c.jaw);
    const stages = new Set<AlignStage>();
    const result = await client.autoAlign(c.parts, {}, { onProgress: (stage) => void stages.add(stage) });
    const local = multiStartAlign(c.parts, buildIcpTarget(c.jaw));
    expect(maxAbsDiff(result.transform, local.transform)).toBeLessThan(1e-12);
    expect(result.status).toBe('good');
    expect([...stages]).toEqual(['prepare', 'coarse', 'fine', 'metrics']);

    const map = await client.deviation(c.parts, result.transform);
    expect([...map.keys()]).toEqual(c.sites.map((s) => s.id));
    for (const part of c.parts) {
      const um = map.get(part.siteId)!;
      expect(um).toBeInstanceOf(Float32Array);
      expect(um).toHaveLength(part.mesh.positions.length / 3);
      expect(Math.max(...um)).toBeLessThan(5);
    }
    const measured = await client.measure(c.parts, result.transform);
    expect(measured.method).toBe('manual');
    expect(workers).toHaveLength(1);
    client.dispose();
  });

  it('turns worker errors into XchangeError codes', async () => {
    const { client } = setup();
    await expect(client.autoAlign(c.parts)).rejects.toMatchObject({ code: 'INSUFFICIENT_DATA', details: { reason: 'noJaw' } });
    await client.setJaw(c.jaw);
    await expect(client.alignFromLandmarks(c.parts, [])).rejects.toMatchObject({ code: 'LANDMARKS_INVALID' });
    await expect(client.setJaw({ positions: new Float32Array(3), indices: Uint32Array.of(0, 0, 7) })).rejects.toMatchObject({ details: { reason: 'indexRange' } });
    await expect(client.measure(c.parts, c.captureToJaw)).rejects.toMatchObject({ details: { reason: 'noJaw' } }); // a failed setJaw leaves no jaw
    client.dispose();
  });

  it('cancelling a running call terminates the worker; the next call respawns it with the last jaw', async () => {
    const { client, workers } = setup();
    await client.setJaw(c.jaw);
    const controller = new AbortController();
    const running = client.autoAlign(c.parts, {}, { signal: controller.signal, onProgress: () => controller.abort() });
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(workers[0]!.terminated).toBe(true);

    const measured = await client.measure(c.parts, c.captureToJaw);
    expect(measured.status).toBe('good');
    expect(workers).toHaveLength(2);
    expect(workers[1]!.received.map((m) => m.type)).toEqual(['setJaw', 'measure']);
    client.dispose();
  });

  it('runs calls in order, drops aborted queued calls and never posts pre-aborted ones', async () => {
    const { client, workers } = setup();
    const jaw = client.setJaw(c.jaw);
    const order: string[] = [];
    const first = client.measure(c.parts, c.captureToJaw).then(() => void order.push('first'));
    const controller = new AbortController();
    const queued = client.measure(c.parts, c.captureToJaw, {}, { signal: controller.signal });
    const last = client.measure(c.parts, c.captureToJaw).then(() => void order.push('last'));
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: 'CANCELLED' });
    await Promise.all([jaw, first, last]);
    expect(order).toEqual(['first', 'last']);
    expect(workers[0]!.received.map((m) => m.type)).toEqual(['setJaw', 'measure', 'measure']);
    await expect(client.measure(c.parts, c.captureToJaw, {}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(workers[0]!.received).toHaveLength(3);
    client.dispose();
  });

  it('reports a crashed worker as WORKER_FAILED and recovers; dispose cancels everything', async () => {
    const { client, workers } = setup();
    await client.setJaw(c.jaw);
    workers[0]!.crashOnMessage = true;
    await expect(client.measure(c.parts, c.captureToJaw)).rejects.toMatchObject({ code: 'WORKER_FAILED' });
    expect((await client.measure(c.parts, c.captureToJaw)).status).toBe('good');
    const pending = client.autoAlign(c.parts);
    const queued = client.measure(c.parts, c.captureToJaw);
    client.dispose();
    const errors = await Promise.allSettled([pending, queued]);
    expect(errors.map((e) => (e.status === 'rejected' ? code(e.reason) : 'resolved'))).toEqual(['CANCELLED', 'CANCELLED']);
    await expect(client.setJaw(c.jaw)).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('the handler answers malformed messages with an error payload', () => {
    const posted: AlignResponse[] = [];
    const handle = createAlignHandler((message) => void posted.push(message));
    handle({ type: 'nope', id: 7 } as unknown as AlignRequest);
    handle(null as unknown as AlignRequest);
    expect(posted).toEqual([
      { type: 'error', id: 7, error: { code: 'INVALID_ARGUMENT', details: { reason: 'message' } } },
      { type: 'error', id: -1, error: { code: 'INVALID_ARGUMENT', details: { reason: 'message' } } },
    ]);
  });
});
