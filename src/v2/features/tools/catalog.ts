// Каталог 23 независимых инструментов (V2-019, tools-advice-library §2): пять категорий, поиск, избранное, недавние.
import type { IconName } from '../../design-system';

export type ToolCategory = 'measure' | 'generators' | 'calculators' | 'design' | 'tuning';

export const TOOL_CATEGORIES: readonly { id: ToolCategory; title: string; text: string; icon: IconName }[] = [
  { id: 'measure', title: 'Измерения', text: 'Микрофон: уровень, спектр, АЧХ и затухание', icon: 'mic' },
  { id: 'generators', title: 'Генераторы', text: 'Сигналы для проверки и измерений', icon: 'wave' },
  { id: 'calculators', title: 'Акустические калькуляторы', text: 'Моды, отражения, реверберация, задержки', icon: 'analysis' },
  { id: 'design', title: 'Проектирование конструкций', text: 'Панели, ловушки, диффузоры, резонаторы', icon: 'panel' },
  { id: 'tuning', title: 'Настройка аудиосистемы', text: 'Эквалайзер, кроссовер, фаза, SPL', icon: 'speaker' },
];

export interface ToolInfo {
  id: string;
  category: ToolCategory;
  title: string;
  summary: string;
  keywords: readonly string[];
  /** Нужен микрофон или воспроизведение: инструмент ничего не запускает без действия пользователя. */
  audio?: 'input' | 'output';
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'noise-meter', category: 'measure', title: 'Шумомер', summary: 'Текущий уровень, Leq, Min/Max, L10/L50/L90, полосы и история', keywords: ['spl', 'leq', 'шум', 'уровень', 'громкость', 'дб'], audio: 'input' },
  { id: 'rta', category: 'measure', title: 'Анализатор спектра RTA', summary: 'FFT и дробно-октавный спектр, усреднение, удержание пиков', keywords: ['fft', 'спектр', 'октава', 'rta', 'peak hold'], audio: 'input' },
  { id: 'sweep', category: 'measure', title: 'Измерение АЧХ свипом', summary: 'Логарифмический свип, импульсная характеристика, АЧХ', keywords: ['ачх', 'свип', 'sweep', 'импульс', 'частотная характеристика'], audio: 'input' },
  { id: 'decay', category: 'measure', title: 'Измерение затухания', summary: 'RT60, EDT, T20, T30 по хлопку или свипу', keywords: ['rt60', 'реверберация', 'хлопок', 'затухание', 'edt', 't30'], audio: 'input' },
  { id: 'signal-generator', category: 'generators', title: 'Генератор сигналов', summary: 'Синус, шум, свипы, мультитон, импульсы; экспорт WAV', keywords: ['синус', 'шум', 'розовый', 'белый', 'генератор', 'wav'], audio: 'output' },
  { id: 'test-signals', category: 'generators', title: 'Тестовые сигналы', summary: 'Готовые сигналы: каналы, полярность, полосы, свипы', keywords: ['полярность', 'каналы', 'тест', 'сигнал'], audio: 'output' },
  { id: 'wavelength', category: 'calculators', title: 'Длина волны', summary: 'Длина волны, период и четверть волны по частоте и температуре', keywords: ['волна', 'частота', 'скорость звука', 'λ'] },
  { id: 'room-modes', category: 'calculators', title: 'Комнатные моды', summary: 'Осевые, тангенциальные и косые моды прямоугольной комнаты', keywords: ['моды', 'резонанс', 'стоячие волны', 'бас'] },
  { id: 'sbir', category: 'calculators', title: 'Провалы SBIR', summary: 'Интерференция с отражением от стены за колонкой', keywords: ['sbir', 'провал', 'стена', 'отражение', 'гребенчатый'] },
  { id: 'reverb', category: 'calculators', title: 'Реверберация', summary: 'Сэбин и Эйринг по полосам, частота Шрёдера', keywords: ['rt60', 'сэбин', 'эйринг', 'шрёдер', 'поглощение'] },
  { id: 'distance-delay', category: 'calculators', title: 'Расстояние и задержка', summary: 'Пересчёт расстояния, задержки и фазы', keywords: ['задержка', 'мс', 'расстояние', 'фаза'] },
  { id: 'room-geometry', category: 'calculators', title: 'Геометрия помещения', summary: 'Объём, площади, соотношения сторон, распределение мод', keywords: ['объём', 'площадь', 'пропорции', 'bonello', 'соотношение'] },
  { id: 'absorber', category: 'design', title: 'Поглощающие панели', summary: 'Пористая панель: толщина, зазор, поглощение по частотам', keywords: ['панель', 'поглотитель', 'минвата', 'пористый'] },
  { id: 'bass-trap', category: 'design', title: 'Басовые ловушки', summary: 'Угловые ловушки: superchunk, панель под 45°, объём', keywords: ['ловушка', 'угол', 'бас', 'superchunk'] },
  { id: 'diffuser', category: 'design', title: 'Диффузоры', summary: 'QRD и Skyline: размеры, рабочая полоса', keywords: ['диффузор', 'qrd', 'skyline', 'рассеивание'] },
  { id: 'resonator', category: 'design', title: 'Резонансные поглотители', summary: 'Гельмгольц, мембрана, перфорированная панель', keywords: ['гельмгольц', 'мембрана', 'перфорация', 'резонатор'] },
  { id: 'materials-compare', category: 'design', title: 'Сравнение материалов', summary: 'Поглощение материалов по полосам, источник данных', keywords: ['материал', 'сравнение', 'коэффициент', 'alpha'] },
  { id: 'equalizer', category: 'tuning', title: 'Эквалайзер', summary: 'Цепочка фильтров, суммарная характеристика, экспорт', keywords: ['eq', 'эквалайзер', 'фильтр', 'biquad', 'peq'] },
  { id: 'crossover', category: 'tuning', title: 'Кроссовер', summary: 'Butterworth, Linkwitz–Riley: сумма полос и фаза', keywords: ['кроссовер', 'lr4', 'butterworth', 'разделение'] },
  { id: 'phase-delay', category: 'tuning', title: 'Фаза и задержка', summary: 'Сложение двух источников с задержкой и полярностью', keywords: ['фаза', 'полярность', 'задержка', 'сумма'] },
  { id: 'stereo-triangle', category: 'tuning', title: 'Стереотреугольник', summary: 'База, расстояние, угол и разворот колонок', keywords: ['стерео', 'треугольник', 'угол', 'toe-in'] },
  { id: 'spl-headroom', category: 'tuning', title: 'Звуковое давление и запас мощности', summary: 'Чувствительность, мощность, расстояние, пик-фактор', keywords: ['spl', 'мощность', 'чувствительность', 'запас', 'усилитель'] },
  { id: 'directivity', category: 'tuning', title: 'Направленность акустики', summary: 'Ослабление вне оси для упрощённых моделей излучателя', keywords: ['направленность', 'ось', 'угол', 'дисперсия'] },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е');

/** Поиск по названию, описанию и ключевым словам; все слова запроса должны найтись. */
export function searchTools(query: string, tools: readonly ToolInfo[] = TOOLS): ToolInfo[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...tools];
  return tools.filter((t) => {
    const text = norm([t.title, t.summary, ...t.keywords].join(' '));
    return words.every((w) => text.includes(w));
  });
}
