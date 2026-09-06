import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(),
  sourceRoot = path.join(root, 'src');
const modules = new Map(),
  failures = [];
const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');
function visitDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visitDirectory(file);
    else if (file.endsWith('.ts')) modules.set(file, []);
  }
}
visitDirectory(sourceRoot);
for (const file of modules.keys()) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
    if (node.isTypeOnly || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly))
      continue;
    const specifier = node.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const spec = specifier.text;
    if (!spec.startsWith('.')) {
      modules.get(file).push(spec);
      continue;
    }
    const base = path.resolve(path.dirname(file), spec);
    const target = [base, base + '.ts', path.join(base, 'index.ts')].find((candidate) =>
      modules.has(candidate),
    );
    if (target) modules.get(file).push(target);
  }
}
for (const [file, imports] of modules) {
  const name = relative(file);
  if (/^src\/(simulation|persistence|domain)\//.test(name)) {
    for (const target of imports) {
      const dependency = path.isAbsolute(target) ? relative(target) : target;
      if (
        /^(three|cannon-es|lucide)(\/|$)/.test(dependency) ||
        /^src\/(rendering|ui|app|audio|vehicles)\//.test(dependency)
      )
        failures.push(`${name} must not depend on browser/rendering module ${dependency}`);
    }
  }
}
const entry = path.join(sourceRoot, 'simulation/runtime/protocol.ts'),
  visited = new Set(),
  active = new Set();
function workerGraph(file, chain = []) {
  if (!modules.has(file)) return;
  if (active.has(file)) {
    failures.push(`Worker cycle: ${[...chain, file].map(relative).join(' -> ')}`);
    return;
  }
  if (visited.has(file)) return;
  active.add(file);
  for (const target of modules.get(file)) workerGraph(target, [...chain, file]);
  active.delete(file);
  visited.add(file);
}
workerGraph(entry);
const flat = fs
  .readdirSync(sourceRoot, { withFileTypes: true })
  .filter((item) => item.isFile() && item.name.endsWith('.ts') && item.name !== 'main.ts');
if (flat.length)
  failures.push(
    `Source root contains feature modules: ${flat.map((item) => item.name).join(', ')}`,
  );
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture OK: ${modules.size} modules; ${visited.size} worker dependencies are acyclic; core is browser-independent.`,
  );
