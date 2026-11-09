/// <reference types="astro/client" />
declare module '*.mjs';

type Notice = {
  type: 'ok' | 'warn' | 'err' | 'info'; key: string; title: string; text: string; slot?: string;
  undo?: { action: string; fields: Record<string, string | string[]>; label: string };
  keep?: { version: string; dataDate: string };
};

declare namespace App {
  interface Locals {
    session: any | null;
    csrf: string | null;
    flash: Notice | null;
  }
}
