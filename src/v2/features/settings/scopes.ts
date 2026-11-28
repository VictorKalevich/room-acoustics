// Названия областей с собственным уровнем сложности (spec §2: локальное переопределение для инструмента или раздела).
import { toolById } from '../tools/catalog';

const SECTION_LABEL: Record<string, string> = {
  'rooms:create': 'Создание комнаты',
  'model': 'Модель комнаты',
  'analysis': 'Анализ',
  'advice': 'Советы',
};

export function scopeLabel(scope: string): string {
  if (scope.startsWith('tool:')) return `Инструмент «${toolById(scope.slice(5))?.title ?? scope.slice(5)}»`;
  return SECTION_LABEL[scope] ?? scope;
}
