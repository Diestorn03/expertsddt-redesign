/** Align worker entry: wires createAlignHandler to the worker scope. Spawned by AlignClient. */
import { createAlignHandler } from './handler';
import type { AlignRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createAlignHandler((message, transfer) => scope.postMessage(message, transfer ?? []));
scope.addEventListener('message', (event: MessageEvent<AlignRequest>) => handle(event.data));
