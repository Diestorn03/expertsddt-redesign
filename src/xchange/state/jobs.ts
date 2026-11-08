/**
 * Promise client of the jobs worker, FIFO like AlignClient. ponytail: cancel = terminate the worker
 * (instant, no shared memory); the next job starts a fresh one. Worker crash -> WORKER_FAILED crashed.
 */
import { fromErrorPayload, XchangeError } from '../core/errors';
import type { WorkerLike } from '../align/client';
import type { JobRequest, JobResponse } from './jobs-handler';
import { UiError } from './jobs-handler';

interface Pending {
  id: number;
  job: JobRequest;
  transfer: Transferable[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class JobsClient {
  private worker: WorkerLike | null = null;
  private queue: Pending[] = [];
  private current: Pending | null = null;
  private nextId = 1;
  private disposed = false;

  constructor(private readonly createWorker: () => WorkerLike = () => new Worker(new URL('./jobs.worker.ts', import.meta.url), { type: 'module' })) {}

  /** Runs a job; `transfer` buffers are moved to the worker (the caller must not keep them). */
  run<T>(job: JobRequest, transfer: Transferable[] = [], signal?: AbortSignal): Promise<T> {
    if (this.disposed || signal?.aborted) return Promise.reject(new XchangeError('CANCELLED'));
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { id: this.nextId++, job, transfer, resolve: resolve as (v: unknown) => void, reject, signal };
      if (signal) {
        p.onAbort = () => this.abort(p);
        signal.addEventListener('abort', p.onAbort, { once: true });
      }
      this.queue.push(p);
      this.pump();
    });
  }

  /** Cancels whatever is running or queued. */
  cancelAll(): void {
    for (const p of [...this.queue, ...(this.current ? [this.current] : [])]) this.abort(p);
  }

  dispose(): void {
    this.cancelAll();
    this.disposed = true;
    this.drop();
  }

  private pump(): void {
    if (this.current || this.disposed) return;
    const p = this.queue.shift();
    if (!p) return;
    this.current = p;
    try {
      this.ensure().postMessage({ id: p.id, job: p.job }, p.transfer);
    } catch {
      this.drop();
      this.finish(p, new XchangeError('WORKER_FAILED', { reason: 'start' }));
    }
  }

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.createWorker();
    w.addEventListener('message', (e) => {
      if (this.worker !== w) return;
      const msg = (e as MessageEvent<JobResponse>).data;
      const p = this.current;
      if (!p || msg.id !== p.id) return;
      if (msg.ok) this.finish(p, null, msg.result);
      else this.finish(p, msg.error.code === 'ui' ? new UiError((msg.error as { key: string }).key) : fromErrorPayload(msg.error as never));
    });
    w.addEventListener('error', () => {
      if (this.worker !== w) return;
      this.drop();
      if (this.current) this.finish(this.current, new XchangeError('WORKER_FAILED', { reason: 'crashed' }));
    });
    this.worker = w;
    return w;
  }

  private abort(p: Pending): void {
    const i = this.queue.indexOf(p);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.finish(p, new XchangeError('CANCELLED'), undefined, false);
    } else if (this.current === p) {
      this.drop();
      this.finish(p, new XchangeError('CANCELLED'));
    }
  }

  private finish(p: Pending, error: unknown, result?: unknown, pump = true): void {
    if (p.onAbort) p.signal?.removeEventListener('abort', p.onAbort);
    if (this.current === p) this.current = null;
    if (error) p.reject(error);
    else p.resolve(result);
    if (pump) this.pump();
  }

  private drop(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
