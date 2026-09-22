// Packs the extension into dist/maggiordomo-<version>.zip using only Node built-ins (zip via PowerShell on Windows, zip CLI elsewhere).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const dist = join(root, 'dist');
const stage = join(dist, 'stage');
const out = join(dist, `maggiordomo-${manifest.version}.zip`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['manifest.json', 'icons', 'vendor', 'src']) cpSync(join(root, entry), join(stage, entry), { recursive: true });
if (existsSync(out)) rmSync(out);

if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${out}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', out, '.'], { cwd: stage, stdio: 'inherit' });
}
rmSync(stage, { recursive: true, force: true });
console.log('wrote', out);
