// POST /libraries/activate: a thin wrapper over panel.activate (session, CSRF and streaming are handled in lib/panel.mjs).
import type { APIRoute } from 'astro';
import { panel, io, send } from '../../panel';

export const POST: APIRoute = async (ctx) => send(ctx, await panel.activate(io(ctx)));
