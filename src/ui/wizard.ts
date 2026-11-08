// Помощник по шагам: от скана до отчёта. Часть шагов определяется сама, остальные отмечаются вручную.
import type { Project } from '../state/project';
import { defaultRoom } from '../state/project';

export type WizardTab = 'room' | 'modes' | 'placement' | 'tuning' | 'measure' | 'report';
export interface WizardStep { id: string; title: string; hint: string; tab: WizardTab; auto?: (p: Project) => boolean }

export const STEPS: WizardStep[] = [
  { id: 'room', title: 'Комната', hint: 'Загрузите скан (Polycam) или введите размеры.', tab: 'room',
    auto: (p) => p.room.source === 'scan' || p.room.depth !== defaultRoom().depth || p.room.width !== defaultRoom().width },
  { id: 'materials', title: 'Материалы', hint: 'Укажите материалы пола, стен и потолка и мебель.', tab: 'room' },
  { id: 'placement', title: 'Расстановка', hint: 'Подберите расстановку автоматически или вручную.', tab: 'placement', auto: (p) => !!p.result },
  { id: 'check', title: 'Проверка', hint: 'Послушайте моды тоном или сделайте замер.', tab: 'measure', auto: (p) => !!p.current.measurement },
  { id: 'sub', title: 'Сабвуфер', hint: 'Подберите задержку, фазу и уровень сабвуфера.', tab: 'tuning' },
  { id: 'eq', title: 'Эквалайзер', hint: 'Рассчитайте фильтры и загрузите их в плеер или DSP.', tab: 'tuning' },
  { id: 'report', title: 'Обработка и отчёт', hint: 'Посмотрите план обработки и сохраните отчёт.', tab: 'report' },
];

const ON_KEY = 'ra-wizard-on';
const doneKey = (id: string) => `ra-wizard-${id}`;

export function wizardOn(): boolean {
  try { return localStorage.getItem(ON_KEY) === '1'; } catch { return false; }
}
export function setWizardOn(v: boolean) {
  try { localStorage.setItem(ON_KEY, v ? '1' : '0'); } catch { /* без хранилища */ }
}
export function manualDone(projectId: string): string[] {
  try { return JSON.parse(localStorage.getItem(doneKey(projectId)) ?? '[]'); } catch { return []; }
}
export function setManualDone(projectId: string, ids: string[]) {
  try { localStorage.setItem(doneKey(projectId), JSON.stringify(ids)); } catch { /* без хранилища */ }
}
export function stepDone(p: Project, s: WizardStep, manual: string[]): boolean {
  return manual.includes(s.id) || (s.auto ? s.auto(p) : false);
}
