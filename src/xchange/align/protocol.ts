/** Messages between AlignClient (main thread) and the align worker. Cancel = the client terminates the worker. */
import type { XchangeErrorPayload } from '../core/errors';
import type { AlignmentResult, AssemblyPart, LandmarkPair, Mat4, TriMesh } from '../core/types';
import type { AlignOptions, AlignStage } from './multistart';

/** Functions cannot be posted. */
export type AlignOptionsData = Omit<AlignOptions, 'onProgress' | 'onIteration' | 'shouldCancel'>;

export type AlignRequest =
  | { type: 'setJaw'; id: number; jaw: TriMesh }
  | { type: 'auto'; id: number; parts: AssemblyPart[]; initial?: Mat4; options?: AlignOptionsData }
  | { type: 'landmarks'; id: number; parts: AssemblyPart[]; pairs: LandmarkPair[]; options?: AlignOptionsData }
  | { type: 'measure'; id: number; parts: AssemblyPart[]; transform: Mat4; options?: AlignOptionsData }
  | { type: 'deviation'; id: number; parts: AssemblyPart[]; transform: Mat4 };

export type AlignResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; stage: AlignStage; fraction: number }
  | { type: 'result'; id: number; result: AlignmentResult }
  | { type: 'deviation'; id: number; perSite: { siteId: string; distancesUm: Float32Array }[] }
  | { type: 'error'; id: number; error: XchangeErrorPayload };
