// POST /restore: a thin wrapper over panel.restore (session, CSRF and streaming are handled in lib/panel.mjs).
import type { APIRoute } from 'astro';
import { panel, io, send } from '../panel';

export const POST: APIRoute = async (ctx) => send(ctx, await panel.restore(io(ctx)));
