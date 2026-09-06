import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? discover(file) : entry.name.endsWith('.test.ts') ? [file] : [];
    }),
  );
  return nested.flat().sort();
}
const args = process.argv.slice(2);
const explicitFiles = args.filter((arg) => !arg.startsWith('--'));
const flags = args.filter((arg) => arg.startsWith('--'));
const files = explicitFiles.length ? explicitFiles : await discover('tests');
if (!files.length) throw new Error('No test suites found');
const runner = spawn(process.execPath, ['--import', 'tsx', '--test', ...flags, ...files], {
  stdio: 'inherit',
});
runner.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
runner.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
