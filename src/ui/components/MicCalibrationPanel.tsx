import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { type MicInputPreference, type MicProfile, type MicScope, type MicSelection } from '../../core/micCalibration';
import { defaultInput, micCatalog } from '../../state/micCatalog';
import { Details, Note, Panel, SelectField } from '../design-system';
import { MicProfileEditor, pointKey } from './MicProfileEditor';

export interface MicSetup { input: MicInputPreference; profile: MicProfile | null; selection: MicSelection }
type Library = Awaited<ReturnType<typeof micCatalog.read>>;
const models = ['iPhone 17 Pro', 'Другой iPhone', 'Android', 'Компьютер', 'Внешний микрофон'];
const opts = (value: string, label: string) => ({ value, label });

export function MicCalibrationPanel({ scope, busy, changed, routeEpoch }: {
  scope: MicScope; busy: boolean; changed(setup: MicSetup | null): void; routeEpoch: number;
}) {
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState(''), [failure, setFailure] = useState(false);
  const [loading, setLoading] = useState(true), [temporary, setTemporary] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [confirmed, setConfirmed] = useState(false), [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const seq = useRef(0);
  const selected = data?.selection;
  const profile = selected?.mode === 'catalog' ? data?.profiles.find(p => p.id === selected.profileId && p.version === selected.version) : undefined;
  const input = data?.input ?? defaultInput();
  const device = input.source === 'system' ? '' : input.source.localDeviceId;
  const isOther = !!input.confirmedModel && !models.includes(input.confirmedModel);
  const missing = selected?.mode === 'catalog' && !profile;

  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const next = await micCatalog.read(scope);
      if (seq.current === n) { setData(next); setFailure(false); setTemporary(false); setError(''); }
    } catch (e) {
      if (seq.current === n) { setData(null); setFailure(true); setError((e as Error).message || 'Хранилище недоступно.'); }
    } finally { if (seq.current === n) setLoading(false); }
  }, [scope]);
  async function enumerate() {
    try {
      const found = await navigator.mediaDevices?.enumerateDevices?.();
      setDevices((found ?? []).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'));
    } catch { setDevices([]); }
  }
  useEffect(() => {
    void reload();
    const externalChange = () => { void reload(); };
    window.addEventListener('focus', externalChange);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ra.micCalibration') : null;
    if (channel) channel.onmessage = externalChange;
    return () => { window.removeEventListener('focus', externalChange); channel?.close(); };
  }, [reload, routeEpoch]);
  useEffect(() => {
    void enumerate();
    const media = navigator.mediaDevices;
    const changeRoute = () => { setConfirmed(false); void enumerate(); };
    media?.addEventListener?.('devicechange', changeRoute);
    return () => media?.removeEventListener?.('devicechange', changeRoute);
  }, [busy, routeEpoch]);
  useEffect(() => { setConfirmed(false); }, [device, input.confirmedModel, profile?.id, profile?.version, routeEpoch]);
  useEffect(() => {
    if (loading || missing || (profile && !confirmed) || (!data && !temporary)) changed(null);
    else changed({ input: data?.input ?? defaultInput(), profile: profile ?? null, selection: selected ?? { mode: 'none' } });
  }, [loading, data, missing, confirmed, profile, temporary, changed, selected]);
  async function update(write: () => Promise<void>) {
    changed(null); setLoading(true); setError('');
    try {
      await write();
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('ra.micCalibration'); channel.postMessage('change'); channel.close();
      }
      await reload();
    } catch (e) { setLoading(false); setError((e as Error).message); }
  }
  function changeInput(source: MicInputPreference['source'], confirmedModel: string | null) {
    setConfirmed(false);
    void update(() => micCatalog.saveInput(scope, { source, confirmedModel, absoluteCalibration: null }));
  }

  return <Panel title="Микрофон и калибровка">
    {error && <Note tone="warn">{error}</Note>}
    {failure && <div class="btn-row"><button class="btn" disabled={busy} onClick={reload}>Повторить чтение</button>
      <button class="btn" disabled={busy} onClick={() => setTemporary(true)}>Без коррекции на этот раз</button></div>}
    {busy ? <p class="small">Настройки входа доступны после остановки.</p> : data && <Details summary="Настройки следующего измерения">
      <SelectField disabled={loading} label="Источник звука" value={device} options={[opts('', 'Системный вход'),
        ...devices.map((d, i) => opts(d.deviceId, d.label || 'Микрофон ' + (i + 1))),
        ...(device && !devices.some(d => d.deviceId === device) ? [opts(device, 'Выбранный вход · доступность не подтверждена')] : [])]}
        onChange={v => changeInput(v ? { localDeviceId: v } : 'system', input.confirmedModel)} />
      {!devices.length && <p class="small">Браузер пока не перечислил отдельные входы. Список обновится после разрешения на захват.</p>}
      <SelectField disabled={loading} label="Модель устройства" value={custom || isOther ? 'other' : input.confirmedModel ?? ''}
        options={[opts('', 'Не указана'), ...models.map(m => opts(m, m)), opts('other', 'Другая модель…')]}
        onChange={v => { setCustom(v === 'other'); if (v !== 'other') changeInput(input.source, v || null); }} />
      {(custom || isOther) && <label class="field"><span>Название устройства</span><span class="field__box">
        <input maxLength={120} value={custom ? customName : input.confirmedModel ?? ''} onInput={e => { setCustom(true); setCustomName(e.currentTarget.value); }}
          onBlur={() => { if (custom && customName.trim()) { changeInput(input.source, customName.trim()); setCustom(false); } }} /></span></label>}
      <SelectField disabled={loading} label="Профиль инструмента" value={profile ? pointKey(profile) : missing ? 'missing' : selected?.mode ?? 'none'}
        options={[...(scope.tool === 'noise' ? [] : [opts('legacy', 'Текущая калибровка проекта (как раньше)')]),
          opts('none', 'Без калибровки'), ...(missing ? [opts('missing', 'Выбранная версия недоступна')] : []),
          ...data.profiles.map(p => opts(pointKey(p), p.name + ' · v' + p.version))]}
        onChange={v => {
          const p = data.profiles.find(row => pointKey(row) === v);
          setConfirmed(false);
          void update(() => micCatalog.select(scope, p ? { mode: 'catalog', profileId: p.id, version: p.version } : { mode: v === 'legacy' ? 'legacy' : 'none' }));
        }} />
      {profile && input.confirmedModel !== profile.deviceModel && <Note tone="warn">Модель входа {input.confirmedModel || 'не указана'}.
        В профиле указана модель «{profile.deviceModel}». Проверьте соответствие перед запуском.</Note>}
      {profile && <><p class="small">{profile.deviceModel} · {profile.captureMode} · {profile.orientation || 'ориентация не указана'} · {profile.validRangeHz.join('–')} Гц ·
        {profile.validationStatus === 'validated' ? ' проверен для исходного тракта' : ' применимость к тракту требует проверки'}.</p>
        <label class="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.currentTarget.checked)} />
          Подтверждаю применимость профиля к выбранному входу, модели и ориентации</label></>}
      {micCatalog.studies.map(study => <Details key={study.model} summary={study.model + ' · исследование Faber'}><p>{study.status}</p>
        <a href={study.url} target="_blank" rel="noreferrer">Лабораторные измерения Faber Acoustical</a></Details>)}
      <MicProfileEditor profiles={data.profiles} model={input.confirmedModel ?? ''} refresh={() => update(async () => {})} />
    </Details>}
    {!busy && missing && <Note tone="warn">Выберите доступную версию или режим без калибровки.</Note>}
    {!busy && profile && !confirmed && <p class="small">Перед запуском подтвердите профиль в настройках следующего измерения.</p>}
    {temporary && <p class="small">Временный режим без коррекции.</p>}
  </Panel>;
}
