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
const declarations = new Set(cssFiles.flatMap(p => [...read(p).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])));
for (const file of cssFiles) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  if (file.replaceAll('\\', '/') !== 'src/styles.css' && !file.replaceAll('\\', '/').startsWith('src/ui/design-system/')) errors.push(file + ': register styles in the design system');
  for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) if (!declarations.has(name)) errors.push(file + ': undefined token ' + name);
  if (file.replaceAll('\\', '/') === tokensFile) continue;
  for (const [, property, value] of css.matchAll(/(?:^|[;{])\s*((?:font(?:-size|-weight|-family)?|line-height|letter-spacing|(?:margin|padding)(?:-[\w-]+)?|(?:row-|column-)?gap))\s*:\s*([^;}]+)/g)) {
    const cleaned = value.replace(/var\([^)]*\)/g, '').replace(/!important/g, '');
    if (/\d(?:px|rem|em)\b/.test(cleaned) || (['font-weight', 'line-height'].includes(property) && /[1-9]/.test(cleaned)) || (property === 'font-family' && !['', 'inherit'].includes(cleaned.trim()))) {
      errors.push(file + ': use a design token for ' + property + ': ' + value.trim());
    }
  }
}
for (const file of files.filter(p => /\.[jt]sx?$/.test(p))) {
  const text = read(file);
  if (/style=\{\{[^}]*\b(?:fontSize|fontWeight|fontFamily|lineHeight|letterSpacing|margin\w*|padding\w*|gap)\s*:/s.test(text)) {
    errors.push(file + ': presentation typography/spacing belongs in the design system');
  }
  if (!file.replaceAll('\\', '/').includes('/design-system/') &&
      /from ['"][^'"]*components\/(Fields|SectionNav|ActionMenu|CalculationStatus|ConfirmSheet)['"]/.test(text)) {
    errors.push(file + ': import public primitives from design-system');
  }
}
if (!read('src/styles.css').includes('design-system/tokens.css')) errors.push('Application must load the shared design-system entry');
if (!tokens.includes('--space-stack:') || !tokens.includes('--font-body:')) errors.push('Missing semantic foundations');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Design system: ' + cssFiles.length + ' stylesheets and ' + files.filter(p => /\.[jt]sx?$/.test(p)).length + ' source files checked; tokens, typography, spacing and imports OK.');
