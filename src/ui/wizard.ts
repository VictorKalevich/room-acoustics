// Помощник по шагам: от скана до отчёта. Часть шагов определяется сама, остальные отмечаются вручную.
import type { Project } from '../state/project';
import type { Destination } from './navigation';

export type WizardTab = Destination;
export interface WizardStep { id: string; title: string; hint: string; tab: WizardTab; auto?: (p: Project) => boolean }

export const STEPS: WizardStep[] = [
  // 021: комната создана — скан применён или ручная настройка сохранена
  { id: 'room', title: 'Комната', hint: 'Загрузите скан (Polycam) или настройте комнату вручную.', tab: 'room', auto: (p) => p.roomReady },
  { id: 'materials', title: 'Материалы', hint: 'Укажите материалы пола, стен и потолка и мебель.', tab: 'room' },
  { id: 'placement', title: 'Расстановка', hint: 'Подберите расстановку автоматически или вручную.', tab: 'placement', auto: (p) => !!p.result },
  { id: 'check', title: 'Проверка', hint: 'Послушайте моды тоном или сделайте замер.', tab: 'measure', auto: (p) => !!p.current.measurement },
  { id: 'sub', title: 'Сабвуфер', hint: 'Подберите задержку, фазу и уровень сабвуфера.', tab: 'tuning/sub' },
  { id: 'eq', title: 'Эквалайзер', hint: 'Рассчитайте фильтры и загрузите их в плеер или DSP.', tab: 'tuning/eq' },
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
