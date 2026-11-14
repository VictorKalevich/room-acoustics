// Экспорт файла проекта (024): «Поделиться» на iPhone («Сохранить в Файлы» → iCloud Drive), скачивание на компьютере.
// Общий для экрана «Проекты» и сообщения о сбое (028); время последнего экспорта запоминается на устройстве.
import type { Project } from '../state/project';
import { projectFileName, serializeProject } from '../state/storage';
import { shareFile } from './audio/mic';

/** Последний экспорт в файл — отметка на устройстве; ключ прежнего экрана «Импорт и экспорт» (024). */
const exportKey = (id: string) => `ra-sync-${id}`;

/** Когда проект последний раз экспортировали с этого устройства (ISO) или null. */
export const readLastExport = (id: string) => { try { return localStorage.getItem(exportKey(id)); } catch { return null; } };

/** Экспортирует проект; время экспорта (ISO) или null, если пользователь отменил. */
export async function exportProject(p: Project): Promise<string | null> {
  if (!(await shareFile(serializeProject(p), projectFileName(p), 'application/json'))) return null;
  const now = new Date().toISOString();
  try { localStorage.setItem(exportKey(p.id), now); } catch { /* без хранилища — только до перезапуска */ }
  return now;
}
