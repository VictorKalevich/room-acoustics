import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks';
import type { AppliedMic, LegacyCal } from '../../core/micApply';
import { type MicInputPreference, type MicProfile, type MicScope, type MicSelection } from '../../core/micCalibration';
import { maxBoostDb } from '../../core/micCurve';
import { defaultInput, micCatalog } from '../../state/micCatalog';
import { Details, Note, Panel, SelectField } from '../design-system';
import { MicProfileEditor, pointKey } from './MicProfileEditor';
import { S } from '../strings';

export interface MicSetup { input: MicInputPreference; profile: MicProfile | null; selection: MicSelection }
/** Почему запуск недоступен (054, UX-004) и к какой настройке перейти. */
export interface MicBlock { text: string; target: 'profile' | 'confirm' | 'retry' | null; panel: string }
export interface MicState { setup: MicSetup | null; block: MicBlock | null }
export const micLoading: MicState = { setup: null, block: { text: S.mic.blocked.loading, target: null, panel: '' } };
type Library = Awaited<ReturnType<typeof micCatalog.read>>;
const models = ['iPhone 17 Pro', 'Другой iPhone', 'Android', 'Компьютер', 'Внешний микрофон'];
const opts = (value: string, label: string) => ({ value, label });
const t = S.mic;

/** Поправка, которую измерение получает по выбору инструмента: каталог заменяет прежнюю, а не добавляется к ней. */
export function appliedMic(setup: MicSetup, legacy: LegacyCal | null): AppliedMic {
  if (setup.selection.mode === 'catalog' && setup.profile) return { mode: 'catalog', profile: setup.profile };
  return setup.selection.mode === 'legacy' ? { mode: 'legacy', legacy } : { mode: 'none' };
}
export const micLabel = (mic: AppliedMic) => mic.mode === 'catalog' ? mic.profile.name + ' · v' + mic.profile.version :
  mic.mode === 'none' ? t.none : t.recordLegacy + (mic.legacy ? ' «' + mic.legacy.name + '»' : '');
/** Другие экраны и вкладки перечитывают каталог (BroadcastChannel доставляет и в этот документ). */
export function announceCatalogChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('ra.micCalibration'); channel.postMessage('change'); channel.close();
}
export const fromCatalog = (e: unknown) => e instanceof Error && e.name === 'Error';

function reveal(block: MicBlock) {
  const panel = document.getElementById(block.panel);
  const target = panel?.querySelector<HTMLElement>(`[data-mic-target="${block.target}"]`);
  if (!target) { panel?.scrollIntoView({ block: 'start' }); return; }
  for (let el = target.parentElement; el && el !== panel; el = el.parentElement) if (el instanceof HTMLDetailsElement) el.open = true;
  target.scrollIntoView({ block: 'center' });
  (target.querySelector<HTMLElement>('select, input, button') ?? target).focus();
}
/** Причина рядом с кнопкой запуска. Короткую загрузку каталога не показываем, чтобы кнопка не прыгала. */
export function MicStartHint({ block }: { block: MicBlock | null }) {
  const [late, setLate] = useState(false);
  const waiting = !!block && block.target === null;
  useEffect(() => {
    setLate(false);
    if (!waiting) return;
    const timer = setTimeout(() => setLate(true), 400);
    return () => clearTimeout(timer);
  }, [waiting, block?.text]);
  if (!block || (waiting && !late)) return null;
  return <Note tone={waiting ? 'info' : 'warn'}>{t.startBlocked} {block.text}{block.target && <>{' '}
    <button type="button" class="btn btn--small btn--ghost" onClick={() => reveal(block)}>{t.openSetting}</button></>}</Note>;
}

export function MicCalibrationPanel({ scope, busy, lockText, changed, routeEpoch, legacy = null }: {
  scope: MicScope; busy: boolean; changed(state: MicState): void; routeEpoch: number;
  /** Точки накопленного замера закрепили калибровку: выбор недоступен, подтверждение остаётся. */
  lockText?: string;
  /** Прежняя кривая `ra-mic-cal` — для описания режима «как раньше» и явной копии в каталог. */
  legacy?: LegacyCal | null;
}) {
  const panelId = 'mic-' + useId();
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState(''), [failure, setFailure] = useState(false);
  // loading — первое чтение или запись пользователя; фоновое перечитывание поля не блокирует.
  const [loading, setLoading] = useState(true), [temporary, setTemporary] = useState<'none' | 'legacy' | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [custom, setCustom] = useState(false);
  // Отметка видна сразу; после записи её состояние снова берётся из каталога.
  const [ticking, setTicking] = useState<boolean | null>(null);
  const [customName, setCustomName] = useState('');
  const seq = useRef(0), lastRead = useRef<Promise<void>>(Promise.resolve());
  const noise =scope.tool === 'noise', clap = scope.tool === 'clap';
  const selected = data?.selection;
  const profile = selected?.mode === 'catalog' ? data?.profiles.find(p => p.id === selected.profileId && p.version === selected.version) : undefined;
  const archivedPick = selected?.mode === 'catalog' && !!data?.archived.some(p => p.id === selected.profileId && p.version === selected.version);
  const input = data?.input ?? defaultInput();
  const device = input.source === 'system' ? '' : input.source.localDeviceId;
  const isOther = !!input.confirmedModel && !models.includes(input.confirmedModel);
  const missing = selected?.mode === 'catalog' && !profile;
  const confirmed = !!data?.confirmed;

  const reload = useCallback(() => {
    const n = ++seq.current;
    const read = (async () => {
      try {
        const next = await micCatalog.read(scope);
        if (seq.current === n) { setData(next); setFailure(false); setTemporary(null); setError(''); }
      } catch (e) {
        if (seq.current === n) { setData(null); setFailure(true); setError((e as Error).message || 'Хранилище недоступно.'); }
      } finally { if (seq.current === n) setLoading(false); }
    })();
    lastRead.current = read;
    return read;
  }, [scope]);
  async function update(write: () => Promise<unknown>) {
    setLoading(true); setError('');
    try {
      await write();
      announceCatalogChange();
      // Рассылка приходит и в этот документ: её более позднее чтение отменяет наше, ждём то, что применится.
      for (let read = reload(); ; read = lastRead.current) { await read; if (read === lastRead.current) break; }
    } catch (e) { setLoading(false); setError((e as Error).message); }
  }
  const latest = useRef({ data, busy, update });
  latest.current = { data, busy, update };
  async function enumerate() {
    try {
      const found = await navigator.mediaDevices?.enumerateDevices?.();
      setDevices((found ?? []).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'));
    } catch { setDevices([]); }
  }
  useEffect(() => {
    // Другой проект — другой выбор: прежние данные не выдаются за новые.
    setLoading(true); setData(null);
    void reload();
    const externalChange = () => { void reload(); };
    window.addEventListener('focus', externalChange);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ra.micCalibration') : null;
    if (channel) channel.onmessage = externalChange;
    return () => { window.removeEventListener('focus', externalChange); channel?.close(); };
  }, [reload]);
  // Прерывание входа требует нового подтверждения, как в C1.
  const epoch = useRef(routeEpoch);
  useEffect(() => {
    if (epoch.current === routeEpoch) return;
    epoch.current = routeEpoch;
    void latest.current.update(async () => {
      const row = await micCatalog.read(scope);
      if (row.confirmed) await micCatalog.confirm(scope, row, false);
    });
  }, [routeEpoch, scope]);
  useEffect(() => {
    void enumerate();
    const media = navigator.mediaDevices;
    // Пока дорожка не проверена первым измерением, смена устройств снимает подтверждение.
    const changeRoute = () => {
      void enumerate();
      const { data: d, busy: running, update: write } = latest.current;
      if (!running && d?.confirmed && !d.persistent) void write(() => micCatalog.confirm(scope, d, false));
    };
    media?.addEventListener?.('devicechange', changeRoute);
    return () => media?.removeEventListener?.('devicechange', changeRoute);
  }, [busy, routeEpoch, scope]);
  useEffect(() => {
    const block = (text: string, target: MicBlock['target']) => changed({ setup: null, block: { text, target, panel: panelId } });
    if (temporary) changed({ setup: { input: defaultInput(), profile: null, selection: { mode: temporary } }, block: null });
    else if (failure) block(t.blocked.storage, 'retry');
    else if (loading || !data) block(t.blocked.loading, null);
    else if (missing) block(archivedPick ? t.blocked.archived : t.blocked.missing, 'profile');
    else if (profile && !clap && !confirmed) block(t.blocked.confirm, 'confirm');
    else changed({ setup: { input: data.input, profile: profile ?? null, selection: data.selection }, block: null });
  }, [loading, data, failure, missing, archivedPick, confirmed, profile, temporary, changed, clap, panelId]);
  function changeInput(source: MicInputPreference['source'], confirmedModel: string | null) {
    void update(() => micCatalog.saveInput(scope, { source, confirmedModel, absoluteCalibration: null }));
  }
  const applied = clap ? t.applied.clap : !data || missing ? '' : profile
    ? t.applied[scope.tool as 'noise' | 'rta' | 'sweep'](profile.validRangeHz.join('–'), profile.maxBoostDb ?? maxBoostDb)
    : selected?.mode === 'legacy' ? legacy ? t.applied.legacy(legacy.name) : t.applied.legacyEmpty : t.applied.none;
  const confirmBox = profile && !clap && <><label class="check" data-mic-target="confirm"><input type="checkbox" checked={ticking ?? confirmed}
    disabled={loading} onChange={e => {
      const d = data!, yes = e.currentTarget.checked;
      setTicking(yes);
      void update(() => micCatalog.confirm(scope, d, yes)).finally(() => setTicking(null));
    }} />
    {t.confirmLabel}</label>
    {confirmed && <p class="small">{data!.persistent ? t.confirmKept : t.confirmSession}</p>}</>;

  return <Panel title="Микрофон и калибровка" id={panelId}>
    {error && <Note tone="warn">{error}</Note>}
    {failure && !temporary && <div class="btn-row" data-mic-target="retry"><button class="btn" disabled={busy} onClick={() => { setLoading(true); void reload(); }}>Повторить чтение</button>
      {!noise && <button class="btn" disabled={busy} onClick={() => setTemporary('legacy')}>{t.temporaryLegacy}</button>}
      <button class="btn" disabled={busy} onClick={() => setTemporary('none')}>{t.temporaryNone}</button></div>}
    {!temporary && applied && <p class="small">{applied}</p>}
    {busy ? <p class="small">{t.locked}</p> : lockText ? <><p class="small">{lockText}</p>{confirmBox}</> : data && <Details summary="Настройки следующего измерения">
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
      <div data-mic-target="profile"><SelectField disabled={loading} label="Профиль инструмента" value={profile ? pointKey(profile) : missing ? 'missing' : selected?.mode ?? 'none'}
        options={[...(noise ? [] : [opts('legacy', clap ? t.legacyClap : t.legacy)]),
          opts('none', t.none), ...(missing ? [opts('missing', archivedPick ? 'Выбранная версия архивирована' : 'Выбранная версия недоступна')] : []),
          ...data.profiles.map(p => opts(pointKey(p), p.name + ' · v' + p.version))]}
        onChange={v => {
          const p = data.profiles.find(row => pointKey(row) === v);
          void update(() => micCatalog.select(scope, p ? { mode: 'catalog', profileId: p.id, version: p.version } : { mode: v === 'legacy' ? 'legacy' : 'none' }));
        }} /></div>
      {profile && input.confirmedModel !== profile.deviceModel && <Note tone="warn">Модель входа {input.confirmedModel || 'не указана'}.
        В профиле указана модель «{profile.deviceModel}». Проверьте соответствие перед запуском.</Note>}
      {profile && <p class="small">{profile.deviceModel} · {profile.captureMode} · {profile.orientation || 'ориентация не указана'} · {profile.validRangeHz.join('–')} Гц ·
        {profile.validationStatus === 'validated' ? ' проверен для исходного тракта' : ' применимость к тракту требует проверки'}.</p>}
      {confirmBox}
      {micCatalog.studies.map(study => <Details key={study.model} summary={study.model + ' · исследование Faber'}><p>{study.status}</p>
        <a href={study.url} target="_blank" rel="noreferrer">Лабораторные измерения Faber Acoustical</a></Details>)}
      <MicProfileEditor profiles={data.profiles} archived={data.archived} model={input.confirmedModel ?? ''} scope={scope}
        legacy={legacy} refresh={() => update(async () => {})} />
    </Details>}
    {!busy && missing && <Note tone="warn">Выберите доступную версию или режим без калибровки.</Note>}
    {!busy && profile && !clap && !confirmed && <p class="small">Перед запуском подтвердите профиль в настройках следующего измерения.</p>}
    {temporary && <p class="small">{temporary === 'legacy' ? t.temporaryLegacy : t.temporaryNone}. {t.temporary}</p>}
  </Panel>;
}
