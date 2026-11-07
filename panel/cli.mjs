// Account management (no sign-up page exists): node cli.mjs add-user|set-password|revoke|list [email] [name]
// Needs DATA_DIR. Prints the one-time password and the TOTP secret; store them in a password manager.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword, newTotpSecret, totpUri } from './lib/auth.mjs';

const dir = process.env.DATA_DIR;
if (!dir) { console.error('Set DATA_DIR (where users.json lives).'); process.exit(1); }
const file = join(dir, 'users.json');
const load = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return []; } };
const save = async (u) => { // tmp + rename: the running panel never reads a half-written users.json
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(u, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, file);
};
const strong = () => randomBytes(15).toString('base64url');

const [cmd, emailArg, ...nameParts] = process.argv.slice(2);
const email = String(emailArg || '').toLowerCase().trim();
const users = await load();
if (cmd === 'list') { users.forEach((u) => console.log(u.email, '-', u.name)); }
else if (cmd === 'add-user' && email.includes('@')) {
  if (users.some((u) => u.email === email)) { console.error('That user already exists.'); process.exit(1); }
  const password = strong(), totp = newTotpSecret();
  users.push({ email, name: nameParts.join(' ') || email, hash: await hashPassword(password), totp, tokenVersion: 0 });
  await save(users);
  console.log(`User: ${email}\nPassword (shown once): ${password}\nTOTP secret: ${totp}\nAuthenticator link: ${totpUri(email, totp)}`);
} else if ((cmd === 'set-password' || cmd === 'revoke') && email) {
  const u = users.find((x) => x.email === email); if (!u) { console.error('No such user.'); process.exit(1); }
  u.tokenVersion = (u.tokenVersion ?? 0) + 1; // invalidates every open session
  if (cmd === 'set-password') { const p = strong(); u.hash = await hashPassword(p); console.log(`New password (shown once): ${p}`); } else console.log('Sessions revoked.');
  await save(users);
} else { console.error('Usage: node cli.mjs add-user <email> [name] | set-password <email> | revoke <email> | list'); process.exit(1); }
