// V2-005 (D58): оболочка v2 и legacy не подключают друг друга; v2 собирается без PWA, в свой каталог и на своих портах.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import v2Config from '../../vite.v2.config';

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(posix.join(dir, e.name)) : [posix.join(dir, e.name)]);
const sources = (dir: string) => walk(dir).filter((p) => /\.(tsx?|css|html)$/.test(p));

/** Подключения файла: import/export from, import 'x', import(), @import, src= в HTML — пути от корня репозитория. */
function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs = [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]|@import\s+['"]([^'"]+)['"]|\bsrc=['"]([^'"]+)['"]/g)]
    .map((m) => m.slice(1).find(Boolean)!);
  return specs.map((s) => s.startsWith('.') ? posix.join(posix.dirname(file), s) : s.startsWith('/') ? s.slice(1) : s);
}

const LEGACY_UI = /^(src\/ui\/|src\/styles\.css$|src\/main\.tsx?$|index\.html$|design-system\.html$)/;
const PWA_OR_LEGACY_FONT = /^(@fontsource\/golos-text|vite-plugin-pwa|virtual:pwa-register|workbox-)/;

describe('059 · изоляция оболочки v2', () => {
  it('v2 не подключает интерфейс, глобальные стили, шрифт и PWA legacy', () => {
    const v2 = sources('src/v2');
    expect(v2).toContain('src/v2/app/main.tsx');
    const bad = v2.flatMap((f) => imports(f).filter((i) => LEGACY_UI.test(i) || PWA_OR_LEGACY_FONT.test(i)).map((i) => `${f} → ${i}`));
    expect(bad).toEqual([]);
  });

  it('legacy не подключает v2 и шрифт Acoustic Lab', () => {
    const legacy = [...sources('src').filter((f) => !f.startsWith('src/v2/')), 'index.html', 'design-system.html', 'vite.config.ts'];
    const bad = legacy.flatMap((f) => imports(f).filter((i) => i.startsWith('src/v2') || i.startsWith('@fontsource-variable/inter')).map((i) => `${f} → ${i}`));
    expect(bad).toEqual([]);
  });

  it('v2 собирается без PWA в dist-v2, без public/ legacy, на портах 5174 и 4174', () => {
    const plugins = ([v2Config.plugins] as unknown[]).flat(Infinity) as ({ name?: string } | null | false)[];
    expect(plugins.filter((p) => p && /pwa|workbox/i.test(p.name ?? ''))).toEqual([]);
    expect(v2Config.publicDir).toBe(false);
    expect(v2Config.build?.outDir?.replaceAll('\\', '/')).toMatch(/\/dist-v2\/?$/);
    expect(v2Config.server).toMatchObject({ port: 5174, strictPort: true });
    expect(v2Config.preview).toMatchObject({ port: 4174, strictPort: true });
  });
});
