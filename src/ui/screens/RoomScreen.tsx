import { useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { activeTreatments, shownTreatments } from '../../core/treatments';
import { clearedRoom, rotateRoom, rotateSetup } from '../../state/project';
import type { Room, ReverbResult, WallId } from '../../core/types';
import { FURNISHING_LABEL, getMaterial } from '../../core/materials';
import { Panel, Details, Note } from '../design-system';
import { PlanView } from '../components/PlanView';
import { S } from '../strings';
import { fmt } from '../format';
import { ScanPanel } from './room/ScanPanel';
import { deleteScan } from '../../state/storage';
import { ClearIcon, FileIcon, RotateIcon } from './room/icons';
import { ConfirmSheet } from '../design-system';
import type { Destination } from '../navigation';
import { dropRoomDraft, loadRoomDraft } from '../roomDraft';
import { requestScanFix } from '../scanFix';

interface Props {
  project: Project;
  reverb: ReverbResult;
  onRoom: (room: Room, extra?: Partial<Project>) => void;
  /** Переход к следующему шагу после применения скана. */
  onGo?: (t: Destination) => void;
}

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];
const dimsOf = (r: Room) => `${fmt(r.depth, 2)} × ${fmt(r.width, 2)} × ${fmt(r.height, 2)} м`;

/**
 * Обзор комнаты (019): план и сводка, вход в конструктор, поворот и очистка, скан, реверберация.
 * Размеры, стены, пол, потолок и мебель правятся в конструкторе (room/RoomEditor).
 * 021: пока комната не создана (нет скана и ручная настройка не сохранена), на экране только «С чего начать».
 * 022: скан до «Сохранить» — карточка «Скан распознан» с переходом к проверке по шагам; у созданной комнаты
 * сверху план и «Что учтено в расчётах», затем «Что дальше» и группа «Изменить комнату».
 */
export function RoomScreen({ project, reverb, onRoom, onGo }: Props) {
  const room = project.room;
  const [askClear, setAskClear] = useState(false);
  // после очистки панель скана начинает заново (без прежнего файла и найденного в нём)
  const [scanGen, setScanGen] = useState(0);
  const clear = () => {
    setAskClear(false);
    // скан проекта на устройстве тоже удаляется: после «Очистить» можно выбрать новый скан
    void deleteScan(project.id).catch(() => undefined);
    dropRoomDraft(project.id);
    const c = clearedRoom(project);
    onRoom(c.room, c);
    setScanGen((g) => g + 1);
    // после закрытия шторки (она возвращает прежнюю прокрутку) — наверх, к карточке «С чего начать»
    setTimeout(() => scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };
  const clearSheet = askClear && (
    <ConfirmSheet
      title={S.room.clearTitle}
      text={S.room.clearText(!!project.current.measurement)}
      confirm={S.room.clear}
      onCancel={() => setAskClear(false)}
      onConfirm={clear}
    />
  );
  const scanPanel = <ScanPanel key={scanGen} project={project} onRoom={onRoom} onGo={onGo} />;
  const info = project.scanInfo;
  const count = (kind: 'window' | 'door') => (room.features ?? []).filter((f) => f.kind === kind).length;
  const furnitureCount = (room.zones ?? []).filter((z) => z.kind === 'furniture').length;

  // комната ещё не создана (новый проект или после очистки) — только «С чего начать»
  const draft = project.roomReady ? null : loadRoomDraft(project.id);
  if (!project.roomReady && info) return (
    <div class="screen">
      <Panel class="start-card" title={S.start.scanTitle(info.fileName)}>
        <p class="small">{S.start.scanText(dimsOf(room), count('window'), count('door'), (room.openings ?? []).length, furnitureCount)}</p>
        {info.confidence < 0.5 && <Note tone="warn">{S.scan.lowConfidence}</Note>}
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onClick={() => onGo?.(`room/${draft?.reached ?? 'size'}`)}>{S.start.scanCheck}</button>
          <button type="button" class="btn" onClick={requestScanFix}>{S.scan.fix}</button>
        </div>
        {draft && <p class="small">{S.start.draft(S.editor.stepLabels[draft.reached])}</p>}
        <button type="button" class="btn btn--ghost" onClick={() => setAskClear(true)}><ClearIcon /> {S.start.scanRestart}</button>
        {clearSheet}
      </Panel>
      {scanPanel}
    </div>
  );
  if (!project.roomReady) return (
    <div class="screen">
      <Panel class="start-card" title={S.start.title}>
        <p class="small">{S.start.text}</p>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onClick={() => document.getElementById('scan-file')?.click()}>
            <FileIcon /> {S.start.scan}
          </button>
          <button type="button" class="btn" onClick={() => {
            const step = draft?.reached ?? 'size';
            onGo?.(`room/${step}`);
            if (step !== 'size') return;
            // поле глубины появится после перехода на шаг «Размеры»
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const el = document.getElementById('room-depth') as HTMLInputElement | null;
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el?.focus();
            }));
          }}>
            {S.start.manual}
          </button>
        </div>
        {draft && <p class="small">{S.start.draft(S.editor.stepLabels[draft.reached])}</p>}
        <Details summary={S.scanGuide.title}>
          <ol class="small scan-guide">
            {S.scanGuide.steps.map((t, ki) => <li key={ki}>{t}</li>)}
          </ol>
          <p class="muted small">{S.scanGuide.formats}</p>
          <p class="muted small">{S.start.local}</p>
        </Details>
        <p class="muted small">{S.start.note}</p>
      </Panel>
      {scanPanel}
    </div>
  );
  return (
    <div class="screen">
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={room.zones} rugs={room.coverings} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} />
        <UsedInCalc project={project} />
      </Panel>

      {onGo && <Panel title={S.room.next}>
        <div class="quick-links">
          <button type="button" class="btn btn--primary" onClick={() => onGo('placement')}>{S.room.nextPlacement}</button>
          <button type="button" class="btn" onClick={() => onGo('voice')}>{S.room.nextVoice}</button>
          <button type="button" class="btn" onClick={() => onGo('analysis')}>{S.room.nextAnalysis}</button>
          <button type="button" class="btn" onClick={() => onGo('measure')}>{S.room.nextMeasure}</button>
        </div>
      </Panel>}

      <Panel title={S.room.change}>
        <button type="button" class="btn btn--primary" onClick={() => onGo?.('room/size')}>{S.editor.open}</button>
        <p class="muted small">{S.editor.openHint}</p>
        <div class="btn-row">
          {info && <button type="button" class="btn btn--ghost" onClick={requestScanFix}>{S.scan.fix}</button>}
          <button
            type="button"
            class="btn btn--ghost"
            onClick={() => onRoom(rotateRoom(room), {
              current: rotateSetup(room, project.current),
              setups: project.setups.map((x) => rotateSetup(room, x)),
              // для «Поправить границы комнаты»: сколько раз комнату повернули относительно скана
              ...(info ? { scanInfo: { ...info, rotation: ((info.rotation ?? 0) + 1) % 4 } } : {}),
            })}
          >
            <RotateIcon /> {S.room.rotate}
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => setAskClear(true)}>
            <ClearIcon /> {S.room.clear}
          </button>
        </div>
        {clearSheet}
      </Panel>

      {scanPanel}

      <Panel title={S.room.reverb}>
        <div class="stat-row">
          <div class="stat">
            <span class="stat__value">{fmt(reverb.tMid, 2)} <small>с</small></span>
            <span class="stat__label">RT60 на 500–1000 Гц</span>
          </div>
          <div class="stat">
            <span class="stat__value">{fmt(reverb.schroeder, 0)} <small>Гц</small></span>
            <span class="stat__label">{S.room.schroeder}</span>
          </div>
        </div>
        <p class="muted small">{S.room.schroederHint}.</p>
        <div class="table-scroll">
          <table class="rt-table">
            <thead>
              <tr>
                <th scope="row">{S.room.rtHeader}</th>
                {reverb.bands.map((b, ki) => <th key={ki}>{b >= 1000 ? `${b / 1000}к` : b}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{S.room.rtRow}</th>
                {reverb.used.map((t, ki) => <td key={ki}>{fmt(t, 2)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">{S.room.formulaNote(reverb.formula.includes('eyring'))}</p>
        <Details summary="Допущения">
          <p class="small">{S.room.reverbAssumptions}</p>
        </Details>
      </Panel>
    </div>
  );
}

/**
 * «Что учтено в расчётах» (022): откуда геометрия, отделка, обстановка, герметичность, обработка, подстройка
 * по замеру и выбраны ли места колонок. Только показывает данные проекта — ничего не считает заново.
 */
function UsedInCalc({ project }: { project: Project }) {
  const room = project.room;
  const t = S.room.used;
  const mat = (id: string) => getMaterial(id).name.toLowerCase();
  const walls = WALLS.map((w) => room.materials[w]);
  const wallText = walls.every((m) => m === walls[0])
    ? mat(walls[0])
    : WALLS.map((w) => `${S.editor.wallShort[w].toLowerCase()} — ${mat(room.materials[w])}`).join(', ');
  const items = (room.features ?? []).length + (room.openings ?? []).length;
  const coverings = (room.coverings ?? []).length;
  const furniture = (room.zones ?? []).filter((z) => z.kind === 'furniture').length;
  const level = FURNISHING_LABEL[room.furnishing].toLowerCase();
  const cal = room.calibration;
  const treat = activeTreatments(room).length;
  const rows: [string, string][] = [
    [t.geometry, project.scanInfo ? t.fromScan(project.scanInfo.fileName, dimsOf(room)) : t.manual(dimsOf(room))],
    [t.items, t.itemsValue(items, (room.extensions ?? []).length, !!room.slope)],
    [t.finish, t.finishValue(wallText, mat(room.materials.floor), mat(room.materials.ceiling))],
    [t.furnishing, room.furnitureList ? t.list(furniture, coverings, level) : t.general(level, coverings > 0)],
    [t.leakage, `${S.zones.leakages[room.leakage ?? 'typical']}${cal?.source ? t.byMeasurement(cal.source) : ''}`],
    [t.treatment, treat ? t.treatOn(treat) : (room.treatments ?? []).length ? t.treatOff : t.none],
    [t.calibration, cal ? t.calibrated(fmt(cal.dampingScale, 2), cal.source) : t.none],
    [t.placement, project.current.placed ? t.placed : t.notPlaced],
  ];
  return (
    <>
      <h3 class="subhead">{t.title}</h3>
      <table class="report-table">
        <tbody>{rows.map(([k, v], ki) => <tr key={ki}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
      </table>
    </>
  );
}
