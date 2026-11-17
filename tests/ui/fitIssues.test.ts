import { describe, expect, it } from 'vitest';
import { fitRoomObjects } from '../../src/core/fitRoom';
import { defaultRoom } from '../../src/state/project';
import type { Room } from '../../src/core/types';
import { fitDetails, fitHints, fitName, fitPlace, fitText } from '../../src/ui/screens/room/fitIssues';

// 048: подпись — с номером карточки, текст — где и на сколько, подсказки — допустимое при остальных полях как сейчас
const room: Room = {
  ...defaultRoom(), depth: 4.137, height: 2.4,
  zones: [
    { id: 'sofa', kind: 'furniture', furniture: 'sofa', name: 'Диван', x0: 0, x1: 0.9, y0: 0, y1: 2, canSit: true },
    { id: 'tbl', kind: 'furniture', furniture: 'table', name: 'Стол', x0: 3.4, x1: 4.25, y0: 1, y1: 2.2, height: 0.75, canSit: false },
    { id: 'door', kind: 'door', x0: 3.6, x1: 4.6, y0: 0, y1: 1, canSit: false },
  ],
  features: [
    { id: 'w1', kind: 'window', wall: 'right', a0: 0.5, a1: 1.5, bottom: 0.9, top: 2 },
    { id: 'w2', kind: 'window', wall: 'right', a0: 3.2, a1: 4.4, bottom: 0.9, top: 2.5 },
  ],
  coverings: [{ id: 'cur', kind: 'curtain', grade: 'heavy', surface: 'right', u0: 3.1, u1: 4.2, v0: 0, v1: 2.4 }],
  slope: { wall: 'front', low: 2.4, run: 1.5 },
};
const fit = fitRoomObjects(room);
/** Единицы в текстах — через неразрывный пробел. */
const sp = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, ' '));
const item = (key: string) => [...fit.removed, ...fit.trimmed].find((f) => (f.kind === 'slope' ? 'slope' : f.item.id) === key)!;

describe('048: объект за стенами в конструкторе', () => {
  it('подпись — как у карточки: номер среди своих', () => {
    expect(fitName(room, item('tbl'))).toBe('Стол (Что это 2)');
    expect(fitName(room, item('door'))).toBe('Дверь (Тип 1)');
    expect(fitName(room, item('w2'))).toBe('Окно 2, правая стена');
    expect(fitName(room, item('cur'))).toBe('Шторы 1, правая стена');
    expect(fitName(room, item('slope'))).toBe('Скос потолка');
  });

  it('где и на сколько; что будет при сохранении', () => {
    expect(sp(fitDetails(item('tbl').over))).toBe('за задней стеной на 11 см');
    expect(sp(fitDetails(item('w2').over))).toBe('за задней стеной на 26 см, выше потолка на 10 см');
    expect(sp(fitDetails(item('slope').over))).toBe('вровень с потолком');
    expect(sp(fitText({ f: item('tbl'), removed: false }))).toBe('За задней стеной на 11 см. При сохранении лишнее обрежется по стенам.');
    expect(sp(fitText({ f: item('tbl'), removed: true }))).toBe('За задней стеной на 11 см. При сохранении объект удалится.');
  });

  it('подсказки: у отступа — предел при этом размере, у размера — при этом отступе, у высоты — потолок', () => {
    expect(sp(fitHints(room, item('tbl')))).toEqual({
      x0: 'Допустимо до 3,28 м при глубине 0,85 м',
      dx: 'Допустимо до 0,73 м при отступе 3,4 м',
    });
    expect(sp(fitHints(room, item('door')))).toEqual({ x1: 'Допустимо до 4,13 м — глубина комнаты' });
    expect(sp(fitHints(room, item('w2')))).toEqual({
      a0: 'Допустимо до 2,93 м при ширине 1,2 м',
      a1: 'Допустимо до 0,93 м при отступе 3,2 м',
      t: 'Допустимо до 2,4 м — высота комнаты',
    });
    expect(sp(fitHints(room, item('cur')))).toEqual({
      u0: 'Допустимо до 3,03 м при ширине 1,1 м',
      du: 'Допустимо до 1,03 м при отступе 3,1 м',
    });
    expect(sp(fitHints(room, item('slope')))).toEqual({ low: 'Допустимо до 2,3 м — ниже потолка' });
    // значения подсказок помещаются: 3,28 + 0,85 ≤ 4,137
    expect(3.28 + 0.85).toBeLessThanOrEqual(room.depth);
  });

  it('куда перейти: шаг, стена, предмет', () => {
    expect(fitPlace(item('tbl'))).toEqual({ step: 'furniture', furniture: 'tbl' });
    expect(fitPlace(item('door'))).toEqual({ step: 'furniture', furniture: undefined });
    expect(fitPlace(item('w2'))).toEqual({ step: 'walls', wall: 'right' });
    expect(fitPlace(item('cur'))).toEqual({ step: 'walls', wall: 'right' });
    expect(fitPlace(item('slope'))).toEqual({ step: 'floor' });
  });
});
