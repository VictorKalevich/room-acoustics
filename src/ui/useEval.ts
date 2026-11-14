// Оценка расстановки: прямоугольная модель — сразу в основном потоке, волновая — в воркере.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Constraints, Room, Setup, SourceSpec } from '../core/types';
import { evaluateSetup, type SetupEval } from '../core/system';
import { isWave } from '../core/geometry';
import { compute } from './compute';

type SetupLike = Pick<Setup, 'listener' | 'positions' | 'subSettings' | 'crossoverHz'>;

export function useSetupEval(
  room: Room, sources: SourceSpec[], c: Constraints, setup: SetupLike | null, ppo = 24,
): { ev: SetupEval | null; busy: boolean; error: string | null } {
  const wave = isWave(room);
  const sync = useMemo(() => (!wave && setup ? evaluateSetup(room, sources, c, setup, { ppo }) : null), [wave, room, sources, c, setup, ppo]);
  const [state, setState] = useState<{ ev: SetupEval | null; busy: boolean; error: string | null }>({ ev: null, busy: false, error: null });
  useEffect(() => {
    // расстановки больше нет (проба убрана, сравнение выключено) — прежний результат не показываем
    if (!wave || !setup) { setState((s) => (s.ev || s.busy || s.error ? { ev: null, busy: false, error: null } : s)); return; }
    setState((s) => ({ ...s, busy: true, error: null }));
    const job = compute('evaluate', { room, sources, constraints: c, setup, ppo });
    job.promise
      .then((ev) => setState({ ev, busy: false, error: null }))
      .catch((e) => setState((s) => ({ ...s, busy: false, error: e.message })));
    return () => job.cancel();
  }, [wave, room, sources, c, setup, ppo]);
  if (!wave) return { ev: sync, busy: false, error: null };
  return state;
}
