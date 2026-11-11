import { useState } from 'preact/hooks';
import type { Project } from '../../state/project';
import { shownTreatments } from '../../core/treatments';
import { clearedRoom, rotateRoom, rotateSetup } from '../../state/project';
import type { Room, ReverbResult } from '../../core/types';
import { FURNISHING_LABEL } from '../../core/materials';
import { Panel, Details } from '../design-system';
import { PlanView } from '../components/PlanView';
import { S } from '../strings';
import { fmt } from '../format';
import { ScanPanel } from './room/ScanPanel';
import { deleteScan } from '../../state/storage';
import { ClearIcon, FileIcon, RotateIcon } from './room/icons';
import { ConfirmSheet } from '../design-system';
import type { Destination } from '../navigation';
import { dropRoomDraft, loadRoomDraft } from '../roomDraft';

interface Props {
  project: Project;
  reverb: ReverbResult;
  onRoom: (room: Room, extra?: Partial<Project>) => void;
  /** Переход к следующему шагу после применения скана. */
  onGo?: (t: Destination) => void;
}

/**
 * Обзор комнаты (019): план и сводка, вход в конструктор, поворот и очистка, скан, реверберация.
 * Размеры, стены, пол, потолок и мебель правятся в конструкторе (room/RoomEditor).
 * 021: пока комната не создана (нет скана и ручная настройка не сохранена), на экране только «С чего начать».
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

  // комната ещё не создана (новый проект или после очистки) — только «С чего начать»
  const draft = project.roomReady ? null : loadRoomDraft(project.id);
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
      <ScanPanel key={scanGen} project={project} onRoom={onRoom} onGo={onGo} />
    </div>
  );
  return (
    <div class="screen">
      <Panel class="panel--hero">
        <PlanView depth={room.depth} width={room.width} zones={room.zones} rugs={room.coverings} extensions={room.extensions} openings={room.openings} features={room.features} treatments={shownTreatments(room)} slope={room.slope} />
        <p class="small">{S.editor.summary(
          `${fmt(room.depth, 2)} × ${fmt(room.width, 2)} × ${fmt(room.height, 2)} м`,
          (room.features ?? []).length + (room.openings ?? []).length,
          (room.zones ?? []).filter((z) => z.kind === 'furniture').length,
          (room.coverings ?? []).length,
        )} · {FURNISHING_LABEL[room.furnishing].toLowerCase()}{room.furnitureList ? ` + ${S.furniture.list.toLowerCase()}` : ''}</p>
        <button type="button" class="btn btn--primary" onClick={() => onGo?.('room/size')}>{S.editor.open}</button>
        <p class="muted small">{S.editor.openHint}</p>
        <div class="btn-row">
          <button
            type="button"
            class="btn btn--ghost"
            onClick={() => onRoom(rotateRoom(room), {
              current: rotateSetup(room, project.current),
              setups: project.setups.map((x) => rotateSetup(room, x)),
              // для «Поправить границы комнаты»: сколько раз комнату повернули относительно скана
              ...(project.scanInfo ? { scanInfo: { ...project.scanInfo, rotation: ((project.scanInfo.rotation ?? 0) + 1) % 4 } } : {}),
            })}
          >
            <RotateIcon /> {S.room.rotate}
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => setAskClear(true)}>
            <ClearIcon /> {S.room.clear}
          </button>
        </div>
        {askClear && (
          <ConfirmSheet
            title={S.room.clearTitle}
            text={S.room.clearText(!!project.current.measurement)}
            confirm={S.room.clear}
            onCancel={() => setAskClear(false)}
            onConfirm={clear}
          />
        )}
      </Panel>

      <ScanPanel key={scanGen} project={project} onRoom={onRoom} onGo={onGo} />


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
      {onGo && <Panel title="Что хотите сделать?">
        <div class="quick-links">
          <button type="button" class="btn" onClick={() => onGo('analysis')}>Оценить акустику</button>
          <button type="button" class="btn" onClick={() => onGo('placement')}>Подобрать расстановку</button>
          <button type="button" class="btn" onClick={() => onGo('voice')}>Найти место для записи</button>
          <button type="button" class="btn" onClick={() => onGo('measure')}>Сделать измерение</button>
        </div>
      </Panel>}
    </div>
  );
}
