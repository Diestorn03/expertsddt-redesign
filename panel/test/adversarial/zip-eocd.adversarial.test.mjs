// ADVERSARIAL · inspectZip trusts the EOCD's own entry count.
// Run: npm run build && node --test test/adversarial/
//
// files.mjs reads the "end of central directory" record, takes `entries` and `cdSize` from it, and then walks exactly
// `entries` records. A zip that declares 0 entries and an empty central directory is therefore never inspected at all:
// the unsafe-path check, the 5000-entry cap and the 1 GB uncompressed cap all iterate over nothing and the archive is
// accepted. The real local file headers (and their contents) are untouched, so every normal unzip tool still extracts them.
//
// Each test asserts the SAFE behaviour, so a FAILING test is the open issue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectZip } from '../../lib/files.mjs';
import { makeZip, notice } from '../helpers.mjs';
import { startPanel } from './harness.mjs';

/** Rewrites the EOCD of a real zip so it claims 0 entries and an empty central directory. */
function hideCentralDirectory(zip) {
  const out = Buffer.from(zip);
  out.writeUInt16LE(0, out.length - 14); // entries on this disk
  out.writeUInt16LE(0, out.length - 12); // total entries
  out.writeUInt32LE(0, out.length - 10); // central directory size
  out.writeUInt32LE(out.length - 22, out.length - 6); // offset -> the EOCD itself, so `cdOffset + cdSize > size` stays false
  return out;
}

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'adv-zip-')); });
after(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); });
const inspect = async (name, buf, opt) => { const f = join(dir, name); await writeFile(f, buf); return inspectZip(f, opt); };

test('a zip holding ../../../evil.php is refused even when its EOCD claims zero entries', async () => {
  const evil = makeZip([{ name: '../../../evil.php', data: Buffer.from('<?php system($_GET[0]); ?>') }]);
  assert.deepEqual(await inspect('honest.zip', evil), { ok: false, code: 'unsafe_path', detail: '../../../evil.php' },
    'sanity: the same archive is refused while its EOCD is honest');

  const hidden = await inspect('hidden.zip', hideCentralDirectory(evil));
  assert.equal(hidden.ok, false, 'a zip whose central directory is hidden must not pass inspection');
});

test('the 1 GB uncompressed cap cannot be skipped by zeroing the EOCD entry count', async () => {
  const bomb = makeZip([{ name: 'big.stl', data: Buffer.alloc(64 * 1024) }]);
  assert.equal((await inspect('bomb.zip', bomb, { maxUncompressed: 1024 })).ok, false, 'sanity: refused while honest');
  assert.equal((await inspect('bomb-hidden.zip', hideCentralDirectory(bomb), { maxUncompressed: 1024 })).ok, false,
    'the bomb cap must not depend on the archive telling the truth about its own size');
});

test('the 5000-entry cap cannot be skipped by zeroing the EOCD entry count', async () => {
  const many = makeZip([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('2') }]);
  assert.equal((await inspect('many.zip', many, { maxEntries: 1 })).ok, false, 'sanity: refused while honest');
  assert.equal((await inspect('many-hidden.zip', hideCentralDirectory(many), { maxEntries: 1 })).ok, false,
    'the entry cap must not depend on the archive telling the truth about its own count');
});

test('an archive with unsafe paths is not published through POST /upload/libraries', { timeout: 60_000 }, async () => {
  const p = await startPanel();
  try {
    await p.login();
    const t = await p.csrf();
    const evil = hideCentralDirectory(makeZip([{ name: '../../../evil.php', data: Buffer.from('<?php system($_GET[0]); ?>') }]));
    const body = new FormData();
    body.append('_csrf', t); body.append('version', '77'); body.append('dataDate', '2026-11-01');
    body.append('file', new Blob([evil]), 'libraries.zip');

    const r = await p.call('/upload/libraries', { method: 'POST', body });
    const n = notice(r.headers.getSetCookie());
    assert.equal(n?.type, 'err', `the publish must be refused, got notice ${n?.key}`);

    const latest = await readFile(join(p.dirs.site, 'downloads', 'libraries', 'latest.json'), 'utf8').catch(() => null);
    assert.equal(latest, null, 'nothing may be published: the doctors would download an archive with escaping paths');
  } finally { await p.stop(); }
});
