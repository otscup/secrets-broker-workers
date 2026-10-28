import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const target = join(root, 'desktop/src-tauri/resources/sidecar');

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, 'src'), { recursive: true });
copyFileSync(process.execPath, join(target, 'node.exe'));
copyFileSync(join(root, 'package.json'), join(target, 'package.json'));
copyFileSync(join(root, 'src/envelope.js'), join(target, 'src/envelope.js'));
copyFileSync(join(root, 'src/vaultdiff.js'), join(target, 'src/vaultdiff.js'));
copyFileSync(join(root, 'src/redact.js'), join(target, 'src/redact.js'));
cpSync(join(root, 'cli'), join(target, 'cli'), { recursive: true });
console.log(`sidecar staged at ${target}`);
