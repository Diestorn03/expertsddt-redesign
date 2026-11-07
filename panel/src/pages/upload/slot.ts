// POST /upload/slot: a thin wrapper over panel.uploadSlot (session, CSRF and streaming are handled in lib/panel.mjs).
import type { APIRoute } from 'astro';
import { panel, io, send } from '../../panel';

export const POST: APIRoute = async (ctx) => send(ctx, await panel.uploadSlot(io(ctx)));
