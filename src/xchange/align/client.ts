/**
 * Promise API over the align worker. Calls run one at a time, first in first out.
 * ponytail: cancelling a running call terminates the worker (instant, no shared memory); the next call
 * starts a fresh worker and re-sends the last jaw first. A failed or cancelled setJaw leaves no jaw.
 *
 * Errors: CANCELLED (aborted or disposed), WORKER_FAILED (worker crashed or could not start), and
 * whatever the worker reports (fromErrorPayload).
 */
import { fromErrorPayload, XchangeError } from '../core/errors';
import type { AlignmentResult, AssemblyPart, LandmarkPair, Mat4, TriMesh } from '../core/types';
import type { AlignStage } from './multistart';
import type { AlignOptionsData, AlignRequest, AlignResponse } from './protocol';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void;
  terminate(): void;
}

export interface CallOptions {
  signal?: AbortSignal;
  onProgress?: (stage: AlignStage, fraction: number) => void;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type Body = WithoutId<AlignRequest>;

interface Job {
  body: Body;
  call: CallOptions;
  id: number;
  resolve: (response: AlignResponse) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

const cancelled = (): XchangeError => new XchangeError('CANCELLED');

function resultOf(response: AlignResponse): AlignmentResult {
  if (response.type !== 'result') throw new XchangeError('INTERNAL', { reason: 'unexpected' });
  return response.result;
}

export class AlignClient {
  private readonly createWorker: () => WorkerLike;
  private worker: WorkerLike | null = null;
  /** The jaw a new worker must receive before the next call. */
  private jaw: TriMesh | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  /** ids of setJaw messages re-sent to a respawned worker. */
  private readonly resent = new Set<number>();
  private nextId = 1;
  private disposed = false;

  /** Default factory: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }). */
  constructor(createWorker: () => WorkerLike = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker;
  }

  /**
   * Copies the jaw (structured clone; the caller keeps its arrays). The worker keeps its IcpTarget between
   * calls; the client keeps a reference to re-send it after a cancel, so do not transfer or mutate it later.
   */
  async setJaw(jaw: TriMesh, call: CallOptions = {}): Promise<void> {
    await this.enqueue({ type: 'setJaw', jaw }, call);
  }

  async autoAlign(parts: readonly AssemblyPart[], options: AlignOptionsData & { initial?: Mat4 } = {}, call: CallOptions = {}): Promise<AlignmentResult> {
    const { initial, ...rest } = options;
    return resultOf(await this.enqueue({ type: 'auto', parts: [...parts], initial, options: rest }, call));
  }

  async alignFromLandmarks(parts: readonly AssemblyPart[], pairs: readonly LandmarkPair[], options: AlignOptionsData = {}, call: CallOptions = {}): Promise<AlignmentResult> {
    return resultOf(await this.enqueue({ type: 'landmarks', parts: [...parts], pairs: [...pairs], options }, call));
  }

  async measure(parts: readonly AssemblyPart[], transform: Mat4, options: AlignOptionsData = {}, call: CallOptions = {}): Promise<AlignmentResult> {
    return resultOf(await this.enqueue({ type: 'measure', parts: [...parts], transform, options }, call));
  }

  /** Per site id: µm per vertex of that part's mesh (after transform) to the jaw surface. */
  async deviation(parts: readonly AssemblyPart[], transform: Mat4, call: CallOptions = {}): Promise<Map<string, Float32Array>> {
    const response = await this.enqueue({ type: 'deviation', parts: [...parts], transform }, call);
    if (response.type !== 'deviation') throw new XchangeError('INTERNAL', { reason: 'unexpected' });
    return new Map(response.perSite.map((site) => [site.siteId, site.distancesUm]));
  }

  /**
   * Forgets the jaw: running and queued calls are cancelled and the worker (with its jaw target) is terminated;
   * the next call starts a fresh worker without a jaw.
   */
  clearJaw(): void {
    this.jaw = null;
    for (const job of [...this.queue]) this.abort(job);
    if (this.current) this.abort(this.current);
    else this.dropWorker();
  }

  /** Terminates the worker and rejects every pending call with CANCELLED. The client cannot be reused. */
  dispose(): void {
    this.disposed = true;
    this.dropWorker();
    const jobs = this.current ? [this.current, ...this.queue] : this.queue;
    this.current = null;
    this.queue = [];
    this.jaw = null;
    for (const job of jobs) {
      job.cleanup();
      job.reject(cancelled());
    }
  }

  private enqueue(body: Body, call: CallOptions): Promise<AlignResponse> {
    if (this.disposed || call.signal?.aborted) return Promise.reject(cancelled());
    return new Promise<AlignResponse>((resolve, reject) => {
      const job: Job = { body, call, id: 0, resolve, reject, cleanup: () => {} };
      const onAbort = (): void => this.abort(job);
      call.signal?.addEventListener('abort', onAbort, { once: true });
      job.cleanup = () => call.signal?.removeEventListener('abort', onAbort);
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.disposed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    job.id = this.nextId++;
    try {
      const isJaw = job.body.type === 'setJaw';
      const worker = this.ensureWorker(!isJaw);
      if (job.body.type === 'setJaw') this.jaw = job.body.jaw;
      worker.postMessage({ ...job.body, id: job.id });
    } catch (error) {
      this.dropWorker();
      this.finish(job, error instanceof XchangeError ? error : new XchangeError('WORKER_FAILED', { reason: 'start' }));
    }
  }

  private ensureWorker(resendJaw: boolean): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener('message', (event) => {
      if (this.worker === worker) this.onMessage((event as MessageEvent<AlignResponse>).data);
    });
    worker.addEventListener('error', () => {
      if (this.worker === worker) this.onCrash();
    });
    this.worker = worker;
    if (resendJaw && this.jaw) {
      const id = this.nextId++;
      this.resent.add(id);
      worker.postMessage({ type: 'setJaw', id, jaw: this.jaw } satisfies AlignRequest);
    }
    return worker;
  }

  private onMessage(message: AlignResponse): void {
    if (this.resent.has(message.id)) {
      if (message.type !== 'progress') this.resent.delete(message.id);
      if (message.type === 'error' && this.current) this.finish(this.current, fromErrorPayload(message.error));
      return;
    }
    const job = this.current;
    if (!job || message.id !== job.id) return; // late message of a cancelled call
    if (message.type === 'progress') job.call.onProgress?.(message.stage, message.fraction);
    else if (message.type === 'error') this.finish(job, fromErrorPayload(message.error));
    else this.finish(job, null, message);
  }

  private onCrash(): void {
    this.dropWorker();
    if (this.current) this.finish(this.current, new XchangeError('WORKER_FAILED', { reason: 'crashed' }));
  }

  private abort(job: Job): void {
    const queued = this.queue.indexOf(job);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      job.cleanup();
      job.reject(cancelled());
    } else if (this.current === job) {
      this.dropWorker();
      this.finish(job, cancelled());
    }
  }

  private finish(job: Job, error: unknown, response?: AlignResponse): void {
    job.cleanup();
    if (this.current === job) this.current = null;
    if (response) job.resolve(response);
    else {
      if (job.body.type === 'setJaw') this.jaw = null;
      job.reject(error);
    }
    this.pump();
  }

  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.resent.clear();
  }
}
