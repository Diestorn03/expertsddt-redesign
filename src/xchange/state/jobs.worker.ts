/** Jobs worker entry: wires createJobsHandler to the worker scope. Spawned by JobsClient. */
import { createJobsHandler, type JobRequest } from './jobs-handler';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createJobsHandler((message, transfer) => scope.postMessage(message, transfer));
scope.addEventListener('message', (event: MessageEvent<{ id: number; job: JobRequest }>) => handle(event.data));
