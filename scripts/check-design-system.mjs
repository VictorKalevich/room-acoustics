import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]);
const errors = [];
const files = walk('src');
const cssFiles = files.filter(p => p.endsWith('.css'));
const tokensFile = 'src/ui/design-system/tokens.css';
const tokens = read(tokensFile);
// Две изолированные системы (D58): legacy и Acoustic Lab оболочки v2. Токен виден только стилям своей системы.
const scopes = {
  legacy: { entry: 'src/styles.css', dir: 'src/ui/design-system/', tokensFile },
  v2: { entry: 'src/v2/app/styles.css', dir: 'src/v2/design-system/', tokensFile: 'src/v2/design-system/tokens.css' },
};
const scopeOf = p => p.replaceAll('\\', '/').startsWith('src/v2/') ? scopes.v2 : scopes.legacy;
const declarations = new Map(Object.values(scopes).map(s => [s, new Set(cssFiles.filter(p => scopeOf(p) === s)
  .flatMap(p => [...read(p).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])))]));
for (const file of cssFiles) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const path = file.replaceAll('\\', '/'), scope = scopeOf(file);
  if (path !== scope.entry && !path.startsWith(scope.dir)) errors.push(file + ': register styles in the design system');
  for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) if (!declarations.get(scope).has(name)) errors.push(file + ': undefined token ' + name);
  if (path === scope.tokensFile) continue;
  for (const [, property, value] of css.matchAll(/(?:^|[;{])\s*((?:font(?:-size|-weight|-family)?|line-height|letter-spacing|(?:margin|padding)(?:-[\w-]+)?|(?:row-|column-)?gap))\s*:\s*([^;}]+)/g)) {
    const cleaned = value.replace(/var\([^)]*\)/g, '').replace(/!important/g, '');
    if (/\d(?:px|rem|em)\b/.test(cleaned) || (['font-weight', 'line-height'].includes(property) && /[1-9]/.test(cleaned)) || (property === 'font-family' && !['', 'inherit'].includes(cleaned.trim()))) {
      errors.push(file + ': use a design token for ' + property + ': ' + value.trim());
    }
  }
}
// Public modules are the ones re-exported by a design-system entry; each lives in one place only, within its own system.
const publicOf = index => { try { return new Set([...read(index).matchAll(/from ['"]\.\/([\w-]+)['"]/g)].map(m => m[1])); } catch { return new Set(); } };
const publicModules = new Map([[scopes.legacy, publicOf('src/ui/design-system/index.ts')], [scopes.v2, publicOf('src/v2/design-system/index.ts')]]);
if (!publicModules.get(scopes.legacy).size) errors.push('src/ui/design-system/index.ts: no public modules found');
// Acoustic Lab: класс al-… из разметки v2 должен быть определён в стилях v2
const v2Classes = new Set(cssFiles.filter(p => scopeOf(p) === scopes.v2).flatMap(p => [...read(p).matchAll(/\.(al-[\w-]+)/g)].map(m => m[1])));
for (const file of files.filter(p => /\.[jt]sx?$/.test(p))) {
  const text = read(file);
  if (/style=\{\{[^}]*\b(?:fontSize|fontWeight|fontFamily|lineHeight|letterSpacing|margin\w*|padding\w*|gap)\s*:/s.test(text)) {
    errors.push(file + ': presentation typography/spacing belongs in the design system');
  }
  const path = file.replaceAll('\\', '/'), scope = scopeOf(file);
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[jt]sx?$/, '');
  if (!path.startsWith(scope.dir) && publicModules.get(scope).has(name)) {
    errors.push(file + ': ' + name + ' is a design-system module; import it from design-system instead of keeping a second copy');
  }
  if (scope === scopes.v2 && file.endsWith('x')) {
    for (const [, cls] of text.matchAll(/(?<![\w-])(al-[a-z0-9_-]*[a-z0-9])(?![\w-]|\$\{)/g)) if (!v2Classes.has(cls)) errors.push(file + ': class ' + cls + ' is not defined in Acoustic Lab styles');
  }
}
if (!read('src/styles.css').includes('design-system/tokens.css')) errors.push('Application must load the shared design-system entry');
if (!tokens.includes('--space-stack:') || !tokens.includes('--font-body:')) errors.push('Missing semantic foundations');
const v2Files = files.filter(p => scopeOf(p) === scopes.v2);
const hasV2Entry = v2Files.some(p => p.replaceAll('\\', '/') === scopes.v2.entry);
if (v2Files.length && !(hasV2Entry && read(scopes.v2.entry).includes("@import '../design-system/tokens.css'"))) errors.push(scopes.v2.entry + ': v2 shell must load the Acoustic Lab tokens');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Design system: ' + cssFiles.length + ' stylesheets (v2: ' + v2Files.filter(p => p.endsWith('.css')).length + ') and ' + files.filter(p => /\.[jt]sx?$/.test(p)).length + ' source files checked; tokens, typography, spacing and design-system modules OK.');
