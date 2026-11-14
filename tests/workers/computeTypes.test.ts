// 030: договор обмена с воркерами проверяет компилятор. Файл проверяет `tsc --noEmit` из `npm run build`:
// строка после каждого @ts-expect-error обязана быть ошибкой компиляции — если договор ослабнет и ошибка пропадёт,
// сборка не пройдёт. Vitest типы не проверяет: неверные вызовы собраны в функции, которая не вызывается.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { compute, type ComputeJob } from '../../src/ui/compute';
import type { ComputeHandler, ComputeHandlers } from '../../src/workers/computeHandlers';
import type { ComputeResult, ComputeType, JsonSafe } from '../../src/workers/computeJobs';
import type { DetectDone, LayoutDone, RunScanWorker } from '../../src/workers/detectJobs';
import { waveSystemModes } from '../../src/core/acoustics';
import { evaluateSetup, type SetupEval } from '../../src/core/system';
import type { Heatmap } from '../../src/core/field';
import type { IntegrationResult } from '../../src/core/integration';
import type { CalibrationResult, Comparison } from '../../src/core/measure';
import type { SystemMode } from '../../src/core/fdtd';
import type { FieldResult } from '../../src/core/field3d';
import type { SubFilterResult } from '../../src/core/subfilters';
import type { VoiceMap } from '../../src/core/voice';
import type { PlacementResult } from '../../src/core/types';
import { defaultConstraints, defaultSetup, defaultSources, emptyRoom } from '../../src/state/project';

/** Принимает значение указанного типа: ошибка компиляции, если тип не подходит. */
const take = <T,>(v: T) => v;

describe('договор воркеров проверяет компилятор', () => {
  it('виды задач — прежний список, тип результата выводится из вида', () => {
    expectTypeOf<ComputeType>().toEqualTypeOf<'optimize' | 'listenerMap' | 'subMap' | 'integrate' | 'calibrate' | 'compare' | 'evaluate' | 'modes' | 'field' | 'subFilters' | 'voiceMap'>();
    expectTypeOf<ComputeResult<'optimize'>>().toEqualTypeOf<PlacementResult>();
    expectTypeOf<ComputeResult<'listenerMap'>>().toEqualTypeOf<Heatmap>();
    expectTypeOf<ComputeResult<'subMap'>>().toEqualTypeOf<Heatmap>();
    expectTypeOf<ComputeResult<'integrate'>>().toEqualTypeOf<IntegrationResult>();
    expectTypeOf<ComputeResult<'calibrate'>>().toEqualTypeOf<CalibrationResult>();
    expectTypeOf<ComputeResult<'compare'>>().toEqualTypeOf<Comparison>();
    expectTypeOf<ComputeResult<'evaluate'>>().toEqualTypeOf<SetupEval>();
    expectTypeOf<ComputeResult<'modes'>>().toEqualTypeOf<SystemMode[]>();
    expectTypeOf<ComputeResult<'field'>>().toEqualTypeOf<FieldResult>();
    expectTypeOf<ComputeResult<'subFilters'>>().toEqualTypeOf<SubFilterResult>();
    expectTypeOf<ComputeResult<'voiceMap'>>().toEqualTypeOf<VoiceMap>();
  });

  it('ошибки в местах вызова не собираются', () => {
    const calls = () => {
      const room = emptyRoom();
      const sources = defaultSources(2, 1);
      const c = defaultConstraints(room);
      const setup = defaultSetup(room, sources, c);

      // верные вызовы собираются, тип результата выведен из вида задачи
      expectTypeOf(compute('evaluate', { room, sources, constraints: c, setup, ppo: 24 })).toEqualTypeOf<ComputeJob<SetupEval>>();
      expectTypeOf(compute('modes', { room, fMax: 80 }, () => {})).toEqualTypeOf<ComputeJob<SystemMode[]>>();
      // вид по условию, как в ManualScreen и PlacementScreen: у обеих карт результат Heatmap
      expectTypeOf(compute(sources.some((s) => s.kind === 'sub') ? 'subMap' : 'listenerMap', { room, sources, constraints: c, setup, subId: 'sub1', ppo: 12 })).toEqualTypeOf<ComputeJob<Heatmap>>();

      // @ts-expect-error неверное имя поля: ppx вместо ppo
      compute('evaluate', { room, sources, constraints: c, setup, ppx: 24 });
      // @ts-expect-error пропущено обязательное поле setup
      compute('evaluate', { room, sources, constraints: c, ppo: 24 });
      // @ts-expect-error пропущено обязательное поле subId
      compute('subMap', { room, sources, constraints: c, setup, ppo: 12 });
      // @ts-expect-error поле не того типа
      compute('modes', { room, fMax: '80' });
      // @ts-expect-error неизвестный вид задачи
      compute('evaluat', { room, sources, constraints: c, setup });
      // @ts-expect-error несоответствие результата: evaluate даёт SetupEval, а не Heatmap
      take<ComputeJob<Heatmap>>(compute('evaluate', { room, sources, constraints: c, setup }));
      // @ts-expect-error прежняя форма с явным типом результата больше не собирается
      compute<SetupEval>('evaluate', { room, sources, constraints: c, setup });

      // таблица обработчиков
      const all = {} as ComputeHandlers;
      // @ts-expect-error нет обработчиков остальных видов задач
      take<ComputeHandlers>({ optimize: all.optimize });
      // @ts-expect-error лишний вид задачи
      take<ComputeHandlers>({ ...all, extra: () => 1 });
      // @ts-expect-error обработчик обращается к полю, которого нет во входных данных
      take<ComputeHandler<'modes'>>((p) => waveSystemModes(p.room, p.fmax));
      // @ts-expect-error обработчик возвращает результат другого вида
      take<ComputeHandler<'modes'>>((p) => evaluateSetup(p.room, sources, c, setup));

      // входные данные обещают только то, что переживает JSON-копию
      // @ts-expect-error типизированный массив
      take<JsonSafe<{ a: Float32Array }>>({ a: new Float32Array(1) });
      // @ts-expect-error функция
      take<JsonSafe<{ f: () => void }>>({ f: () => {} });
      // @ts-expect-error undefined в элементах массива (копия превращает его в null)
      take<JsonSafe<{ xs: (number | undefined)[] }>>({ xs: [1, undefined] });

      // воркер скана
      const run = null as unknown as RunScanWorker;
      const tri = new Float32Array(9);
      const dims = { depth: 4, width: 3, height: 2.5 };
      expectTypeOf(run({ units: 'm', labels: undefined }, tri)).toEqualTypeOf<Promise<DetectDone>>();
      expectTypeOf(run({ type: 'layout', transform: [], dims }, tri)).toEqualTypeOf<Promise<LayoutDone>>();
      // @ts-expect-error на разбор границ приходит только layout, без result
      take<Promise<DetectDone>>(run({ type: 'layout', transform: [], dims }, tri));
      // @ts-expect-error разбор границ без dims
      run({ type: 'layout', transform: [] }, tri);
      // @ts-expect-error неверное имя поля: unit вместо units
      run({ unit: 'm' }, tri);
      // @ts-expect-error неизвестные единицы
      run({ units: 'km' }, tri);
    };
    expect(typeof calls).toBe('function');
  });
});
