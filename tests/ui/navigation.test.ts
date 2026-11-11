import { describe, expect, it } from 'vitest';
import { resolveRoute, routePath } from '../../src/ui/navigation';

describe('navigation compatibility', () => {
  it('keeps existing analysis and manual bookmarks', () => {
    expect(resolveRoute('#modes')).toMatchObject({ tab: 'modes', analysis: 'list' });
    expect(resolveRoute('#overview')).toMatchObject({ tab: 'modes', analysis: 'overview' });
    expect(resolveRoute('#field')).toMatchObject({ tab: 'modes', analysis: 'field' });
    expect(resolveRoute('#manual')).toMatchObject({ tab: 'placement', placement: 'manual' });
  });
  it('opens the new analysis entry on overview', () => {
    expect(resolveRoute('#analysis')).toMatchObject({ tab: 'modes', analysis: 'overview' });
  });
  it('round trips specific workspace links', () => {
    for (const path of ['room', 'room/size', 'room/walls', 'room/floor', 'room/furniture', 'analysis', 'modes', 'field', 'manual', 'placement', 'tuning/sub', 'tuning/eq', 'tuning/treatment', 'measure/sweep', 'measure/clap', 'measure/rta', 'measure/compare', 'voice', 'projects', 'report', 'help', 'about']) {
      expect(routePath(resolveRoute(`#${path}`))).toBe(path);
    }
  });
  it('opens «Проекты» for the old «Импорт и экспорт» address (024)', () => {
    expect(resolveRoute('#sync')).toMatchObject({ tab: 'projects' });
    expect(routePath(resolveRoute('#sync'))).toBe('projects');
  });
  it('opens room overview for the old address and unknown room steps (019)', () => {
    expect(resolveRoute('#room')).toMatchObject({ tab: 'room', room: 'overview' });
    expect(resolveRoute('#room/walls')).toMatchObject({ tab: 'room', room: 'walls' });
    expect(resolveRoute('#room/unknown')).toMatchObject({ tab: 'room', room: 'overview' });
  });
  it('rejects unknown sections without losing the last valid selection', () => {
    const previous = resolveRoute('#tuning/eq');
    expect(resolveRoute('#tuning/unknown', previous)).toMatchObject({ tab: 'room', tuning: 'eq' });
  });
});
