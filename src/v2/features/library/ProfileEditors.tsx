// Редакторы профилей (V2-047): оборудование и материалы с версиями. Сохранение создаёт новую версию, если данные
// изменились; прежние версии остаются и восстанавливаются новой версией. Комнаты меняются только явно — в свойствах.
import { useState } from 'preact/hooks';
import { Button, Checkbox, FrequencyChart, Notice, NumberField, SegmentedControl, SelectField, Sheet, TextField, useToast } from '../../design-system';
import { MATERIALS } from '../../../core/materials';
import type { Enclosure } from '../../../core/types';
import {
  FIELD_LABEL, OCTAVES, blankEquipment, blankMaterial, currentData, equipmentIssues, materialIssues, nearestBuiltin, newProfile, parseResponse,
  passportFromResponse, restoreVersion, revise,
} from '../../application/profiles';
import type { EquipmentData, EquipmentProfile, MaterialData, MaterialProfile, Profile, ResponseField } from '../../domain/profiles';
import { putProfile } from '../../storage/profiles';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';

const n2 = (v: number) => v.toFixed(2).replace('.', ',');
const octave = (f: number) => (f >= 1000 ? `${f / 1000} кГц` : `${f} Гц`);

function Versions<T>({ p, onRestore }: { p: Profile<T>; onRestore: (v: number) => void }) {
  return (
    <div class="al-stack al-stack--8">
      <span class="al-text-lead">Версии</span>
      <ol class="al-steps" aria-label="Версии профиля">
        {p.versions.map((_, k) => p.versions[p.versions.length - 1 - k]).map((v) => (
          <li key={v.version}>
            <span>{`Версия ${v.version}, ${dateTime(v.at)} — ${v.note}`}</span>
            {v.version !== p.version && <> <Button small variant="ghost" onClick={() => onRestore(v.version)}>Восстановить</Button></>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function useSave<T>(store: 'equipment' | 'materials', onSaved: (p: Profile<T>) => void) {
  const { db } = useApp();
  const toast = useToast();
  return async (next: Profile<T>, text: string) => {
    try {
      await putProfile(db, store, next as unknown as EquipmentProfile);
      toast.show(text);
      onSaved(next);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Не удалось сохранить профиль', { tone: 'error' });
    }
  };
}

export function EquipmentEditor({ profile, onClose, onSaved }: { profile: EquipmentProfile | null; onClose: () => void; onSaved: (p: EquipmentProfile) => void }) {
  const { clock } = useApp();
  const toast = useToast();
  const [name, setName] = useState(profile?.name ?? 'Новая колонка');
  const [d, setD] = useState<EquipmentData>(() => structuredClone(profile ? currentData(profile) : blankEquipment('speaker')));
  const [box, setBox] = useState<{ w: number | null; h: number | null; d: number | null }>(() => ({ w: d.box?.w ?? null, h: d.box?.h ?? null, d: d.box?.d ?? null }));
  const [note, setNote] = useState('');
  const save = useSave<EquipmentData>('equipment', (p) => onSaved(p));
  const set = (patch: Partial<EquipmentData>) => setD({ ...d, ...patch });
  const setBoxPart = (k: 'w' | 'h' | 'd', v: number) => {
    const next = { ...box, [k]: Number.isFinite(v) ? v : null };
    setBox(next);
    set({ box: next.w && next.h && next.d ? { w: next.w, h: next.h, d: next.d } : null });
  };
  const caps = d.capabilities;
  const issues = equipmentIssues(d);
  const est = d.response ? passportFromResponse(d.response, d.kind) : null;
  const pass = d.passport ?? {};
  const setPass = (patch: Partial<NonNullable<EquipmentData['passport']>>) => {
    const next = Object.fromEntries(Object.entries({ ...pass, ...patch }).filter(([, v]) => v !== undefined && !(typeof v === 'number' && !Number.isFinite(v))));
    set({ passport: Object.keys(next).length ? next : null });
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = parseResponse(await file.text());
      set({ response: { ...r, field: d.response?.field ?? 'unknown', distance: d.response?.distance ?? null, reference: d.response?.reference ?? '', source: d.response?.source ?? '', fileName: file.name, importedAt: clock.now() } });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Файл не прочитан', { tone: 'error' });
    }
  };
  const onSave = () => {
    const now = clock.now();
    void save(profile ? revise(profile, d, now, note, name) : newProfile(name, d, clock.newId(), now), profile ? 'Профиль сохранён' : 'Профиль создан').then(() => setNote(''));
  };
  return (
    <Sheet title={profile ? `Профиль «${profile.name}»` : 'Новый профиль оборудования'} onClose={onClose}>
      <div class="al-stack al-stack--16">
        <TextField label="Название" value={name} onInput={setName} />
        {!profile && <SegmentedControl label="Вид" value={d.kind} onChange={(k) => setD({ ...blankEquipment(k), source: d.source, maker: d.maker, model: d.model })} options={[{ value: 'speaker', label: 'Колонка' }, { value: 'sub', label: 'Сабвуфер' }]} />}
        <div class="al-grid">
          <TextField label="Производитель" value={d.maker} onInput={(v) => set({ maker: v })} />
          <TextField label="Модель" value={d.model} onInput={(v) => set({ model: v })} />
          <NumberField label="Нижняя граница" unit="Гц" decimals={0} value={d.fLow} min={5} max={20000} onCommit={(v) => set({ fLow: v })} />
          <NumberField label="Верхняя граница" unit="Гц" decimals={0} value={d.fHigh} min={10} max={40000} onCommit={(v) => set({ fHigh: v })} />
          <NumberField label="Спад −3 дБ" unit="Гц" optional placeholder="неизвестно" decimals={1} value={pass.f3 ?? null} min={1} max={20000} onCommit={(v) => setPass({ f3: Number.isFinite(v) ? v : undefined })} />
          <NumberField label="Спад −10 дБ" unit="Гц" optional placeholder="неизвестно" decimals={1} value={pass.f10 ?? null} min={1} max={20000} onCommit={(v) => setPass({ f10: Number.isFinite(v) ? v : undefined })} />
          <SelectField label="Оформление" value={pass.box ?? 'unknown'} onChange={(v) => setPass({ box: v === 'unknown' ? undefined : (v as Enclosure) })}
            options={[{ value: 'unknown', label: 'Неизвестно' }, { value: 'ported', label: 'Фазоинвертор' }, { value: 'sealed', label: 'Закрытый корпус' }]} />
          <NumberField label="Ширина корпуса" unit="м" optional placeholder="неизвестно" value={box.w} min={0.05} max={2} onCommit={(v) => setBoxPart('w', v)} />
          <NumberField label="Высота корпуса" unit="м" optional placeholder="неизвестно" value={box.h} min={0.05} max={2.5} onCommit={(v) => setBoxPart('h', v)} />
          <NumberField label="Глубина корпуса" unit="м" optional placeholder="неизвестно" value={box.d} min={0.05} max={2} onCommit={(v) => setBoxPart('d', v)} />
        </div>
        {d.kind === 'sub' && (
          <div class="al-grid">
            <SelectField label="Задержка в устройстве" value={caps.delayMode ?? 'none'} onChange={(v) => set({ capabilities: { ...caps, delayMode: v } })} options={[{ value: 'none', label: 'Нет' }, { value: 'adjustable', label: 'Регулируется' }]} />
            <SelectField label="Фаза" value={caps.phaseMode ?? 'none'} onChange={(v) => set({ capabilities: { ...caps, phaseMode: v } })} options={[{ value: 'none', label: 'Нет' }, { value: 'polarity', label: 'Полярность 0/180°' }, { value: 'continuous', label: 'Плавная' }, { value: 'full', label: 'Плавная и полярность' }]} />
            <NumberField label="Полосы PEQ" unit="шт." decimals={0} value={caps.peqBands ?? 0} min={0} max={20} onCommit={(v) => set({ capabilities: { ...caps, peqBands: v } })} />
            <Checkbox label="Регулировка уровня" checked={caps.levelAdjustable ?? false} onChange={(v) => set({ capabilities: { ...caps, levelAdjustable: v } })} />
            <Checkbox label="Фазовый фильтр (all-pass)" checked={caps.allpass ?? false} onChange={(v) => set({ capabilities: { ...caps, allpass: v } })} />
          </div>
        )}
        <div class="al-grid">
          <SelectField label="Направленность" value={d.directivity.kind} onChange={(v) => set({ directivity: v === 'omni' ? { kind: 'omni' } : { kind: 'parametric', aboveHz: 1000, beamDeg: 90 } })}
            options={[{ value: 'omni', label: 'Всенаправленная' }, { value: 'parametric', label: 'Параметрическая' }]} />
          {d.directivity.kind === 'parametric' && (
            <>
              <NumberField label="Сужается выше" unit="Гц" decimals={0} value={d.directivity.aboveHz} min={100} max={20000} onCommit={(v) => set({ directivity: { ...(d.directivity as { kind: 'parametric'; aboveHz: number; beamDeg: number }), aboveHz: v } })} />
              <NumberField label="Ширина диаграммы (−6 дБ)" unit="°" decimals={0} value={d.directivity.beamDeg} min={20} max={360} onCommit={(v) => set({ directivity: { ...(d.directivity as { kind: 'parametric'; aboveHz: number; beamDeg: number }), beamDeg: v } })} />
            </>
          )}
        </div>
        <TextField label="Источник данных" value={d.source} onInput={(v) => set({ source: v })} hint="Паспорт производителя, свой замер, оценка — без источника профиль не сохраняется." />
        <div class="al-stack al-stack--12">
          <span class="al-text-lead">Измеренная АЧХ</span>
          <div class="al-row al-row--12">
            <label class="al-btn al-btn--secondary al-btn--small">
              <input class="al-visually-hidden" type="file" accept=".txt,.csv,.frd,text/plain" aria-label="Файл АЧХ оборудования" onChange={(e) => void importFile(e.currentTarget.files?.[0])} />
              Загрузить АЧХ (REW, CSV, FRD)
            </label>
            {d.response && <Button small variant="ghost" onClick={() => set({ response: null })}>Убрать АЧХ</Button>}
          </div>
          {d.response && (
            <>
              <p class="al-text-small">{`«${d.response.fileName}», ${d.response.f.length} точек, ${Math.round(d.response.f[0])}–${Math.round(d.response.f[d.response.f.length - 1])} Гц. Исходные точки сохраняются без сглаживания.`}</p>
              <div class="al-grid">
                <SelectField label="Условия измерения" value={d.response.field} onChange={(v) => set({ response: { ...d.response!, field: v as ResponseField } })}
                  options={(Object.keys(FIELD_LABEL) as ResponseField[]).map((k) => ({ value: k, label: FIELD_LABEL[k] }))} />
                <NumberField label="Расстояние микрофона" unit="м" optional placeholder="неизвестно" value={d.response.distance} min={0.005} max={20} onCommit={(v) => set({ response: { ...d.response!, distance: Number.isFinite(v) ? v : null } })} />
                <TextField label="Опора уровня и привязка" value={d.response.reference} onInput={(v) => set({ response: { ...d.response!, reference: v } })} placeholder="например, 2,83 В / 1 м, стробирование 5 мс" />
              </div>
              <FrequencyChart title="АЧХ оборудования" fMin={10} fMax={40000} series={[{ id: 'r', label: FIELD_LABEL[d.response.field], kind: d.response.field === 'room' ? 'measured' : 'imported', x: d.response.f, y: d.response.db }]} />
              {d.response.field === 'room' && <Notice tone="warning">Комнатная АЧХ отражает комнату, а не громкоговоритель: она хранится для справки и не используется как его характеристика.</Notice>}
              <div class="al-row al-row--12">
                <Button small disabled={!est || est.f3 === undefined} onClick={() => est && setPass({ f3: est.f3, f10: est.f10 })}>Взять спад из АЧХ</Button>
                <span class="al-text-small al-text-secondary">{est?.f3 !== undefined ? `Оценка: −3 дБ ${n2(est.f3)} Гц${est.f10 !== undefined ? `, −10 дБ ${n2(est.f10)} Гц` : ', −10 дБ — нет в данных'}.` : est?.reason}</span>
              </div>
            </>
          )}
        </div>
        {issues.length > 0 && <Notice tone="warning" title="Профиль не сохранить">{issues.join(' ')}</Notice>}
        {profile && <TextField label="Что изменено" value={note} onInput={setNote} placeholder={`Версия ${profile.version + 1}`} />}
        <div class="al-row">
          <Button variant="primary" disabled={issues.length > 0} onClick={onSave}>{profile ? 'Сохранить версию' : 'Создать профиль'}</Button>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
        </div>
        {profile && <Versions p={profile} onRestore={(v) => void save(restoreVersion(profile, v, clock.now()), `Восстановлена версия ${v}`)} />}
      </div>
    </Sheet>
  );
}

export function MaterialEditor({ profile, onClose, onSaved }: { profile: MaterialProfile | null; onClose: () => void; onSaved: (p: MaterialProfile) => void }) {
  const { clock } = useApp();
  const [name, setName] = useState(profile?.name ?? 'Новый материал');
  const [d, setD] = useState<MaterialData>(() => structuredClone(profile ? currentData(profile) : blankMaterial()));
  const [note, setNote] = useState('');
  const save = useSave<MaterialData>('materials', (p) => onSaved(p));
  const issues = materialIssues(d);
  const near = nearestBuiltin(d.alpha);
  const onSave = () => {
    const now = clock.now();
    void save(profile ? revise(profile, d, now, note, name) : newProfile(name, d, clock.newId(), now), profile ? 'Профиль сохранён' : 'Профиль создан').then(() => setNote(''));
  };
  return (
    <Sheet title={profile ? `Материал «${profile.name}»` : 'Новый материал'} onClose={onClose}>
      <div class="al-stack al-stack--16">
        <TextField label="Название" value={name} onInput={setName} />
        <SelectField label="Заполнить из справочника" value={d.basedOn ?? ''} onChange={(id) => setD({ ...d, basedOn: id || null, alpha: id ? [...MATERIALS.find((m) => m.id === id)!.alpha] : d.alpha })}
          options={[{ value: '', label: 'Свои значения' }, ...MATERIALS.map((m) => ({ value: m.id, label: m.name }))]} />
        <div class="al-grid al-grid--metrics" role="group" aria-label="Коэффициенты поглощения по октавам">
          {OCTAVES.map((f, i) => (
            <NumberField key={f} label={`α, ${octave(f)}`} value={d.alpha[i]} min={0} max={1} decimals={2} onCommit={(v) => setD({ ...d, alpha: d.alpha.map((a, k) => (k === i ? v : a)) })} />
          ))}
        </div>
        <div class="al-grid">
          <NumberField label="Неопределённость α (±)" optional placeholder="неизвестна" value={d.uncertainty} min={0} max={0.5} decimals={2} onCommit={(v) => setD({ ...d, uncertainty: Number.isFinite(v) ? v : null })} />
          <TextField label="Источник данных" value={d.source} onInput={(v) => setD({ ...d, source: v })} hint="Паспорт, измерение в реверберационной камере (ISO 354), справочник." />
        </div>
        <p class="al-text-small al-text-secondary">{`α на 63 Гц в справочниках обычно нет — это оценка. В расчёт ядра пойдёт ближайший справочный материал «${near.name}» (α расходится до ${n2(near.maxDiff)}); расчёты v2 (отражения, эхо) берут значения профиля.`}</p>
        {issues.length > 0 && <Notice tone="warning" title="Профиль не сохранить">{issues.join(' ')}</Notice>}
        {profile && <TextField label="Что изменено" value={note} onInput={setNote} placeholder={`Версия ${profile.version + 1}`} />}
        <div class="al-row">
          <Button variant="primary" disabled={issues.length > 0} onClick={onSave}>{profile ? 'Сохранить версию' : 'Создать профиль'}</Button>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
        </div>
        {profile && <Versions p={profile} onRestore={(v) => void save(restoreVersion(profile, v, clock.now()), `Восстановлена версия ${v}`)} />}
      </div>
    </Sheet>
  );
}
