// Профили в модели (V2-047): профиль оборудования у источника (применить версию, обновить, вернуть параметры,
// сохранить экземпляр как профиль) и свои материалы поверхностей. Новая версия профиля меняет комнату только по кнопке.
import { useEffect, useState } from 'preact/hooks';
import { Button, SelectField, useToast } from '../../design-system';
import { MATERIALS } from '../../../core/materials';
import type { SurfaceId } from '../../../core/types';
import { SURFACE_LABEL, patchSource, setSurface } from '../../application/editing';
import { applyEquipment, applyMaterial, currentData, equipmentOf, instanceState, materialState, nearestBuiltin, newProfile } from '../../application/profiles';
import type { RoomConfiguration, Source } from '../../domain/model';
import type { EquipmentProfile, MaterialProfile } from '../../domain/profiles';
import { listEquipment, listMaterials, putProfile } from '../../storage/profiles';
import { useApp } from '../../shared/context';
import type { ConfigEdit } from './useConfig';

const n2 = (v: number) => v.toFixed(2).replace('.', ',');

function useList<K extends 'equipment' | 'materials'>(kind: K): [(K extends 'equipment' ? EquipmentProfile : MaterialProfile)[] | null, () => void] {
  type T = K extends 'equipment' ? EquipmentProfile : MaterialProfile;
  const { db } = useApp();
  const [list, setList] = useState<T[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = (kind === 'equipment' ? listEquipment(db) : listMaterials(db)) as Promise<T[]>;
    load.then((x) => { if (live) setList(x); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [db, kind, tick]);
  return [list, () => setTick((t) => t + 1)];
}

export function EquipmentBlock({ s, edit }: { s: Source; edit: ConfigEdit }) {
  const { db, clock } = useApp();
  const toast = useToast();
  const [list, reload] = useList('equipment');
  const [pick, setPick] = useState('');
  const mine = (list ?? []).filter((p) => currentData(p).kind === s.kind);
  const p = s.profile ? list?.find((x) => x.id === s.profile!.id) : undefined;
  const state = list ? instanceState(s, p) : 'none';
  const apply = (prof: EquipmentProfile, version = prof.version, label = 'Профиль оборудования') =>
    edit.apply((x) => applyEquipment(x, s.id, prof, version), label).then((ok) => { if (ok) toast.show(`Параметры профиля «${prof.name}», версия ${version}, применены`); });
  const saveAs = async () => {
    const prof = newProfile(s.name, equipmentOf(s, 'Параметры экземпляра в комнате'), clock.newId(), clock.now());
    await putProfile(db, 'equipment', prof);
    await edit.apply((x) => patchSource(x, s.id, { profile: { id: prof.id, version: 1 } }), 'Сохранение профиля');
    toast.show(`Профиль «${prof.name}» сохранён в «Моих данных»`);
    reload();
  };
  const text = !s.profile ? 'Профиль не выбран: параметры заданы в комнате.'
    : state === 'missing' ? 'Профиль удалён из «Моих данных»: параметры остались в комнате.'
    : state === 'modified' ? `Профиль «${p!.name}», версия ${s.profile.version}; параметры изменены в комнате.`
    : state === 'outdated' ? `Профиль «${p!.name}», версия ${s.profile.version}; есть версия ${p!.version}.`
    : p ? `Профиль «${p.name}», версия ${s.profile.version}.` : '';
  return (
    <div class="al-stack al-stack--12" role="group" aria-label="Профиль оборудования">
      <span class="al-text-lead">Профиль оборудования</span>
      <p class="al-text-small al-text-secondary">{text}</p>
      <div class="al-row">
        {state === 'outdated' && <Button small variant="primary" onClick={() => void apply(p!, p!.version, 'Обновление профиля')}>{`Обновить до версии ${p!.version}`}</Button>}
        {state === 'modified' && <Button small onClick={() => void apply(p!, s.profile!.version, 'Параметры профиля')}>Вернуть параметры профиля</Button>}
        <Button small icon="download" onClick={() => void saveAs()}>Сохранить как профиль</Button>
      </div>
      {mine.length > 0 && (
        <div class="al-row al-row--bottom">
          <SelectField label="Профиль из «Моих данных»" value={pick} onChange={setPick} compact
            options={[{ value: '', label: 'Выберите профиль' }, ...mine.map((x) => ({ value: x.id, label: `${x.name}, в. ${x.version}` }))]} />
          <Button small disabled={!pick} onClick={() => { const prof = mine.find((x) => x.id === pick); if (prof) void apply(prof); }}>Применить</Button>
        </div>
      )}
    </div>
  );
}

/** Свои материалы библиотеки для полей поверхностей. */
export function useMaterials(): MaterialProfile[] {
  return useList('materials')[0] ?? [];
}

export function SurfaceField({ c, s, edit, materials }: { c: RoomConfiguration; s: SurfaceId; edit: ConfigEdit; materials: MaterialProfile[] }) {
  const sm = c.surfaces[s];
  const p = sm.profile ? materials.find((x) => x.id === sm.profile!.id) : undefined;
  const state = materialState(sm, p);
  const value = sm.profile ? `profile:${sm.profile.id}` : sm.material;
  const options = [
    ...MATERIALS.map((m) => ({ value: m.id, label: m.name })),
    ...materials.map((m) => ({ value: `profile:${m.id}`, label: `Мой: ${m.name}` })),
    ...(sm.profile && !p ? [{ value, label: `Мой: ${sm.profile.name} (удалён из «Моих данных»)` }] : []),
  ];
  const label = `Материал: ${SURFACE_LABEL[s].toLowerCase()}`;
  const choose = (v: string) => {
    const prof = v.startsWith('profile:') ? materials.find((m) => `profile:${m.id}` === v) : undefined;
    void edit.apply((x) => (prof ? applyMaterial(x, s, prof) : setSurface(x, s, v)), label);
  };
  const near = sm.profile ? nearestBuiltin(sm.profile.alpha) : null;
  return (
    <div class="al-stack al-stack--8">
      <SelectField label={SURFACE_LABEL[s]} value={value} onChange={choose} options={options} />
      {sm.profile && near && (
        <span class="al-text-small al-text-secondary">
          {`Свой материал, версия ${sm.profile.version}${sm.profile.uncertainty !== null ? `, α ± ${n2(sm.profile.uncertainty)}` : ''}. В расчёте ядра — «${near.name}» (α расходится до ${n2(near.maxDiff)}).`}
          {state === 'outdated' && <> <Button small variant="ghost" onClick={() => void edit.apply((x) => applyMaterial(x, s, p!), label)}>{`Обновить до версии ${p!.version}`}</Button></>}
        </span>
      )}
    </div>
  );
}
