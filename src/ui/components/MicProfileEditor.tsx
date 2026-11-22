import { loadCal } from '../../state/legacyMicCalibration';
import { useRef, useState } from 'preact/hooks';
import type { MicProfile, MicScope } from '../../core/micCalibration';
import { checkCurve, correctionFunction, maxBoostDb, parseMicFile, validateProfile, values } from '../../core/micCurve';
import { micCatalog } from '../../state/micCatalog';
import { ResponseChart } from './Charts';
import { ConfirmSheet, Details, Note, SelectField } from '../design-system';
import { shareFile } from '../audio/mic';

const pointKey = (p: MicProfile) => p.id + ':' + p.version;
export { pointKey };

function textField(label: string, value: string, change: (v: string) => void) {
  return <label class="field"><span class="field__label">{label}</span><span class="field__box">
    <input value={value} maxLength={300} onInput={e => change(e.currentTarget.value)} /></span></label>;
}
const kindOptions = [{ value: 'response', label: 'Измеренная АЧХ микрофона' }, { value: 'correction', label: 'Готовая поправка' }];
const newProfile = (name: string, model: string): MicProfile => ({
  id: crypto.randomUUID(), version: 1, origin: 'user', name, deviceModel: model || 'Неизвестно', inputKind: 'unknown',
  captureMode: 'Не указан', orientation: null, sourceURL: null, sourceDate: null, method: 'Импорт ' + name,
  referenceHz: 1000, validRangeHz: [0, 0], validationStatus: 'unverified', notes: '', directivitySource: null,
  digitizationUncertaintyDb: null, curve: { kind: 'response', frequencyHz: [], responseDb: [] },
});

export function MicProfileEditor({ profiles, model, refresh }: {
  profiles: readonly MicProfile[]; model: string; refresh(): Promise<void>;
}) {
  const [legacy] = useState(loadCal);
  const [chosen, choose] = useState('');
  const [draft, edit] = useState<MicProfile | null>(null);
  const [confirmed, confirm] = useState(false);
  const [issue, error] = useState(''), [message, notify] = useState('');
  const [archive, askArchive] = useState<{ profile: MicProfile; refs: MicScope[] } | null>(null);
  const [pending, wait] = useState(false);
  const fileToken = useRef(0);
  const current = profiles.find(p => pointKey(p) === chosen);
  const preview = draft ?? current;
  let validation = '', correction: ReturnType<typeof correctionFunction> | undefined;
  if (preview) {
    try { correction = correctionFunction(preview); } catch (e) { validation = (e as Error).message; }
  }
  function patch(fields: Partial<MicProfile>) { if (draft) edit({ ...draft, ...fields }); }
  function reset() { fileToken.current++; edit(null); confirm(false); error(''); notify(''); }
  async function run(fn: () => Promise<void>) {
    if (pending) return;
    wait(true); error(''); notify('');
    try { await fn(); } catch (e) { error((e as Error).message || 'Операция не выполнена.'); }
    finally { wait(false); }
  }
  async function readFile(file: File) {
    const token = ++fileToken.current;
    error(''); notify(''); confirm(false);
    // A failed replacement must never leave the previous curve ready to save.
    const base = draft ?? newProfile(file.name, model);
    edit(null);
    try {
      if (!/\.(txt|csv|frd|json)$/i.test(file.name) || file.size > 2_000_000) throw new Error('Нужен TXT, CSV или FRD или JSON профиля до 2 МБ.');
      if (file.name.toLowerCase().endsWith('.json')) {
        const saved = JSON.parse(await file.text());
        if (saved?.format !== 'ra-mic-profile' || saved.schema !== 1) throw new Error('Ожидается экспорт микрофонного профиля.');
        validateProfile(saved.profile);
        if (Object.keys(saved.profile).some(k => !(Object.hasOwn(base, k) || k === 'maxBoostDb'))) throw new Error('В профиле есть неизвестные поля.');
        if (token === fileToken.current) edit({ ...saved.profile, id: base.id, version: base.version, origin: 'user', validationStatus: 'unverified' });
        return;
      }
      const { f, db } = parseMicFile(await file.text());
      if (token !== fileToken.current) return;
      edit({ ...base, method: 'Импорт ' + file.name, validRangeHz: [f[0], f[f.length - 1]],
        curve: base.curve.kind === 'response' ? { kind: 'response', frequencyHz: f, responseDb: db } :
          { kind: 'correction', frequencyHz: f, correctionDb: db } });
    } catch (e) { if (token === fileToken.current) error((e as Error).message); }
  }
  async function revise(copy: boolean) {
    if (!current) return;
    reset();
    const version = copy ? 1 : await micCatalog.nextVersion(current.id);
    edit({ ...current, id: copy ? crypto.randomUUID() : current.id, version: copy ? 1 : version, origin: 'user',
      validationStatus: 'unverified', name: current.name + (copy ? ' · копия' : '') });
  }
  return <Details summary="Управление профилями и импорт">
    <SelectField disabled={pending} label="Запись каталога" value={chosen} options={[{ value: '', label: 'Новый профиль' },
      ...profiles.map(p => ({ value: pointKey(p), label: p.name + ' · v' + p.version }))]}
      onChange={v => { reset(); choose(v); }} />
    {current && !draft && <div class="btn-row">
      <button class="btn" disabled={pending} onClick={() => run(() => revise(true))}>Клонировать</button>
      {current.origin === 'user' && <button class="btn" disabled={pending} onClick={() => run(() => revise(false))}>Изменить в новой версии</button>}
      <button class="btn" disabled={pending} onClick={() => run(async () => {
        const curve = current.curve;
        const csv = ['# ' + current.name + ' v' + current.version + ' · ' + curve.kind, 'Hz,dB',
          ...curve.frequencyHz.map((f, i) => f + ',' + values(curve)[i])].join('\n');
        await shareFile(csv, 'mic-' + current.id + '-v' + current.version + '-' + curve.kind + '.csv', 'text/csv');
      })}>Экспорт кривой</button>
      <button class="btn" disabled={pending} onClick={() => run(async () => {
        await shareFile(JSON.stringify({ format: 'ra-mic-profile', schema: 1, profile: current }), 'mic-profile-v' + current.version + '.json', 'application/json');
      })}>Экспорт профиля</button>
      {current.origin === 'user' && <button class="btn" disabled={pending} onClick={() => run(async () => {
        const refs = await micCatalog.references(current);
        askArchive({ profile: current, refs });
      })}>Архивировать</button>}
    </div>}
    {legacy && !current && !draft && <button class="btn" onClick={() => run(async () => {
      checkCurve(legacy.f, legacy.db);
      reset();
      edit({ ...newProfile(legacy.name, model), method: 'Копия прежней калибровки · ' + legacy.name,
        validRangeHz: [legacy.f[0], legacy.f[legacy.f.length - 1]], curve: {kind:'response', frequencyHz:legacy.f, responseDb:legacy.db} });
    })}>Подготовить копию прежней калибровки</button>}
    {(!current || draft) && <label class="field"><span class="field__label">Файл микрофонной калибровки</span>
      <input type="file" accept=".txt,.csv,.frd,.json" onChange={e => { const file = e.currentTarget.files?.[0];
        e.currentTarget.value = ''; if (file) void readFile(file); }} />
      <span class="field__hint">TXT, CSV или FRD. Столбцы в Гц и дБ. Третий столбец FRD — фаза.</span></label>}
    {draft && <>
      {textField('Название профиля', draft.name, name => patch({ name }))}
      <SelectField label="Содержимое файла" value={draft.curve.kind} options={kindOptions} onChange={v => {
        const f = draft.curve.frequencyHz, db = values(draft.curve);
        patch({ curve: v === 'response' ? { kind: 'response', frequencyHz: f, responseDb: db } : { kind: 'correction', frequencyHz: f, correctionDb: db } });
        confirm(false);
      }} />
      <SelectField label="Предел усиления" value={String(draft.maxBoostDb ?? maxBoostDb)}
        options={[...new Set([0, 3, 6, 9, maxBoostDb, draft.maxBoostDb ?? maxBoostDb])].sort((a,b) => a-b).map(v => ({ value:String(v), label:'+' + v + ' дБ' }))}
        onChange={v => patch({ maxBoostDb:Number(v) })} />
      {textField('Модель микрофона', draft.deviceModel, deviceModel => patch({ deviceModel }))}
      <SelectField label="Тип микрофона" value={draft.inputKind} options={[{ value: 'unknown', label: 'Неизвестно' },
        { value: 'built-in', label: 'Встроенный' }, { value: 'external', label: 'Внешний' }]}
        onChange={v => patch({ inputKind: v as MicProfile['inputKind'] })} />
      {textField('Ориентация к источнику', draft.orientation ?? '', v => patch({ orientation: v || null }))}
      {textField('Режим захвата', draft.captureMode, captureMode => patch({ captureMode }))}
      {textField('Источник и метод измерения', draft.method, method => patch({ method }))}
      {textField('Ссылка на источник', draft.sourceURL ?? '', v => patch({ sourceURL: v || null }))}
      {textField('Дата исходного измерения', draft.sourceDate ?? '', v => patch({ sourceDate: v || null }))}
      {textField('Условия и ограничения', draft.notes, notes => patch({ notes }))}
    </>}
    {preview && <><p class="small">{preview.name} · v{preview.version} · {preview.deviceModel} · {preview.validRangeHz.join('–')} Гц · {preview.curve.frequencyHz.length} точек.
      {' '}{kindOptions.find(k => k.value === preview.curve.kind)?.label}. {preview.method}. {preview.orientation} {preview.notes}</p>
      {correction && (() => {
        const f = Array.from(preview.curve.frequencyHz), db = Array.from(values(preview.curve));
        // Include interpolated samples to show gain limiting between source knots.
        const [lo, hi] = preview.validRangeHz;
        const grid = [...new Set([...f.filter(hz => hz >= lo && hz <= hi), lo, hi, ...Array.from({length:240},
          (_, i) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * i / 240))])].sort((a,b) => a-b);
        const gain = grid.map(hz => correction!(hz) ?? 0);
        const min = Math.floor(Math.min(0, ...db, ...gain)) - 1, max = Math.ceil(Math.max(0, ...db, ...gain)) + 1;
        return <><ResponseChart fLo={f[0]} fHi={f[f.length - 1]} yRange={[min, max]} yTicks={[min, 0, max]}
          label="Исходная кривая и применяемая поправка" lines={[{ f, db, cls: 'is-measured' }, { f: grid, db: gain, cls: 'is-target', dash: true }]} />
          <p class="small">Сплошная — данные файла, пунктир — поправка в дБ. Предел усиления +{preview.maxBoostDb ?? maxBoostDb} дБ.</p></>;
      })()}</>}
    {draft && <><label class="check"><input type="checkbox" checked={confirmed} onChange={e => confirm(e.currentTarget.checked)} />
      Это калибровка микрофона в Гц и дБ. Тип кривой выбран верно.</label>
      <div class="btn-row"><button class="btn btn--primary" disabled={pending || !!validation || !confirmed} onClick={() => run(async () => {
        validateProfile(draft); await micCatalog.saveVersion(draft); await refresh(); edit(null); choose(pointKey(draft));
        notify('Версия сохранена. Выбор инструмента прежний.');
      })}>Сохранить в каталог</button><button class="btn" onClick={reset}>Отмена</button></div></>}
    {(issue || validation) && <Note tone="warn">{issue || validation}</Note>}
    {message && <p role="status">{message}</p>}
    {archive && <ConfirmSheet title={'Архивировать «' + archive.profile.name + '» v' + archive.profile.version + '?'}
      text={'Версию используют: ' + (archive.refs.map(s => s.tool === 'noise' ? 'Шумомер' : s.tool + ' · ' + s.projectId).join(', ') || 'никто') +
        '. Для следующего измерения потребуется выбрать доступную версию.'}
      confirm="Архивировать" onCancel={() => askArchive(null)} onConfirm={() => run(async () => {
        askArchive(null); await micCatalog.archive(archive.profile, archive.refs); await refresh(); choose(''); notify('Версия архивирована.');
      })} />}
  </Details>;
}
