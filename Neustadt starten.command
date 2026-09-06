#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v npm >/dev/null 2>&1; then
  echo 'Zum Starten wird Node.js mit npm benötigt. Siehe README.md.'
  read '?Zum Schließen Enter drücken.'
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
# Build separately, retaining old hashed assets for already-open game windows.
npm run build -- --outDir .neustadt-build
node --input-type=module <<'NODE'
import { cpSync, mkdirSync, renameSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
cpSync('.neustadt-build', 'dist', { recursive: true, filter: path => !path.endsWith('/index.html') });
cpSync('.neustadt-build/index.html', 'dist/index.html.next');
renameSync('dist/index.html.next', 'dist/index.html');
NODE
if curl -fsS --max-time 2 http://127.0.0.1:4173/ 2>/dev/null | /usr/bin/grep -q 'Neustadt'; then
  open 'http://127.0.0.1:4173/'
  exit 0
fi
npm run preview -- --port 4173 --strictPort --open
