/** Alias lama untuk seed sintetis non-destruktif. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const r = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/lab.cjs'), '--demo'], { stdio: 'inherit' });
if (r.error) console.error(r.error.message);
process.exitCode = r.status ?? 1;
