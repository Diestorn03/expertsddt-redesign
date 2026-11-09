/**
 * All worker logic, testable in Node without a Worker: one request at a time, synchronous. The jaw's
 * IcpTarget (samples, k-d tree, triangle tree) is kept between calls until the next setJaw.
 *
 * Errors posted back: anything the algorithms throw (as payloads), INSUFFICIENT_DATA (reason 'noJaw'),
 * INVALID_ARGUMENT (reason 'message').
 */
import { toErrorPayload, XchangeError } from '../core/errors';
import { buildIcpTarget, checkParts, type IcpTarget } from './icp';
import { partDeviations } from './deviation';
import { alignFromLandmarks } from './landmarks';
import { measureManualPose } from './metrics';
import { multiStartAlign, type AlignOptions, type AlignStage } from './multistart';
import type { AlignOptionsData, AlignRequest, AlignResponse } from './protocol';

/** Progress is posted when the stage changes or the fraction moved by at least this much. */
const PROGRESS_STEP = 0.02;

export function createAlignHandler(post: (message: AlignResponse, transfer?: Transferable[]) => void): (message: AlignRequest) => void {
  let target: IcpTarget | null = null;

  const jaw = (): IcpTarget => {
    if (!target) throw new XchangeError('INSUFFICIENT_DATA', { reason: 'noJaw' });
    return target;
  };

  const optionsFor = (id: number, data: AlignOptionsData | undefined): AlignOptions => {
    let lastStage: AlignStage | null = null, lastFraction = 0;
    const onProgress = (stage: AlignStage, fraction: number): void => {
      if (stage === lastStage && fraction - lastFraction < PROGRESS_STEP && fraction < 1) return;
      lastStage = stage;
      lastFraction = fraction;
      post({ type: 'progress', id, stage, fraction });
    };
    // Posted data never carries callbacks; drop anything that claims to be one.
    return { ...data, onProgress, onIteration: undefined, shouldCancel: undefined };
  };

  return (message) => {
    const id = typeof message?.id === 'number' ? message.id : -1;
    try {
      switch (message?.type) {
        case 'setJaw':
          target = null; // a failed setJaw leaves no stale jaw behind
          target = buildIcpTarget(message.jaw);
          post({ type: 'ready', id });
          return;
        case 'auto':
          post({ type: 'result', id, result: multiStartAlign(message.parts, jaw(), { ...optionsFor(id, message.options), initial: message.initial }) });
          return;
        case 'landmarks':
          post({ type: 'result', id, result: alignFromLandmarks(message.parts, jaw(), message.pairs, optionsFor(id, message.options)) });
          return;
        case 'measure':
          post({ type: 'result', id, result: measureManualPose(message.parts, jaw(), message.transform, optionsFor(id, message.options)) });
          return;
        case 'deviation': {
          checkParts(message.parts);
          const maps = partDeviations(message.parts, jaw().surface, message.transform);
          const perSite = message.parts.map((part, k) => ({ siteId: part.siteId, distancesUm: maps[k]! }));
          post({ type: 'deviation', id, perSite }, perSite.map((site) => site.distancesUm.buffer));
          return;
        }
        default:
          throw new XchangeError('INVALID_ARGUMENT', { reason: 'message' });
      }
    } catch (error) {
      post({ type: 'error', id, error: toErrorPayload(error) });
    }
  };
}
