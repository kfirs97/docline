import { runTests } from '@vscode/test-electron';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

(async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'docline-e2e-')));
  writeFileSync(join(ws, 'geo.py'), 'def area(w: float, h: float = 1.0) -> float:\n    \n    return w * h\n\n\ndef scale(x, k=2):\n    return x * k\n');
  await runTests({
    extensionDevelopmentPath: resolve(__dirname, '../..'),
    extensionTestsPath: resolve(__dirname, 'suite.js'),
    launchArgs: [ws, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
