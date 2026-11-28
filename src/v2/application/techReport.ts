// Технический отчёт (V2-055): самостоятельный HTML — стили и графики SVG внутри, без скриптов и внешних ресурсов;
// печатается в PDF средствами браузера. Машиночитаемый JSON того же содержания и CSV отклика, мод и реверберации.
// Только уже посчитанное и записанное: новых расчётов отчёт не делает (кроме сдвига уровня замера к модели для
// сравнения формы); расчёт, измерение и рекомендация различаются явно.
import type { SetupEval } from '../../core/system';
import type { Mode, ReverbResult } from '../../core/types';
import type { MeasurementData, MeasurementRecord } from '../domain/measurement';
import type { Provenance } from '../domain/provenance';
import { isKnown } from '../domain/units';
import { EFFORT_LABEL, EVIDENCE_LABEL, GOAL_LABEL, GROUP_LABEL, sortAdvice } from './advice';
import { PLAN_STATUS_LABEL, sortPlan } from './plan';
import type { ReportInput } from './report';

export interface TechAnalysis {
  ev: SetupEval;
  reverb: ReverbResult;
  modes: readonly Mode[];
  provenance: Provenance;
  problems: string[];
}

export interface TechInput extends Omit<ReportInput, 'analysis'> {
  analysis: TechAnalysis | null;
  /** Последний замер АЧХ этой конфигурации — для сравнения формы с моделью. */
  measured: { m: MeasurementRecord; data: MeasurementData } | null;
  coreVersion: string;
}

const MODES_MAX = 40;
const fx = (v: number, d: number) => v.toFixed(d).replace('.', ',').replace('-', '−');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const when = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : 'время неизвестно');
const KIND: Record<Mode['kind'], string> = { axial: 'осевая', tangential: 'тангенциальная', oblique: 'косая' };

const median = (v: readonly number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Замер на частотах модели (линейно по логарифму частоты) со сдвигом к медиане модели в полосе оценки. */
export function alignMeasured(ev: Pick<SetupEval, 'response' | 'fLo' | 'fHi'>, d: Pick<MeasurementData, 'f' | 'db'>): { f: number[]; db: number[]; shift: number } | null {
  if (d.f.length < 2) return null;
  const at = (f: number): number | null => {
    if (f < d.f[0] || f > d.f[d.f.length - 1]) return null;
    let k = 0;
    while (k < d.f.length - 2 && d.f[k + 1] < f) k++;
    const t = Math.log(f / d.f[k]) / Math.log(d.f[k + 1] / d.f[k]);
    return d.db[k] + t * (d.db[k + 1] - d.db[k]);
  };
  const pts = ev.response.f.map((f, k) => ({ f, m: at(f), model: ev.response.db[k] })).filter((p): p is { f: number; m: number; model: number } => p.m !== null);
  const band = pts.filter((p) => p.f >= ev.fLo && p.f <= ev.fHi);
  if (band.length < 5) return null;
  const shift = median(band.map((p) => p.model)) - median(band.map((p) => p.m));
  return { f: pts.map((p) => p.f), db: pts.map((p) => p.m + shift), shift };
}

// ---------- График SVG ----------

interface Line { label: string; x: readonly number[]; y: readonly number[]; color: string; dash?: string }
const TICKS = [20, 31.5, 50, 63, 100, 125, 200, 250, 500, 1000, 2000, 5000, 10000, 20000];
const tick = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f).replace('.', ','));

/** График SVG без внешних стилей: годится и внутрь отчёта, и отдельным файлом. */
export function svgChart(title: string, lines: readonly Line[], fMin: number, fMax: number, unit = 'дБ'): string {
  const W = 720, H = 270, l = 48, r = 12, t = 22, b = 30;
  const ys = lines.flatMap((s) => s.y.filter(Number.isFinite));
  let y0 = Math.floor(Math.min(...ys) / 5) * 5, y1 = Math.ceil(Math.max(...ys) / 5) * 5;
  if (y1 - y0 < 10) { y0 -= 5; y1 += 5; }
  const sx = (f: number) => l + ((Math.log(f) - Math.log(fMin)) / (Math.log(fMax) - Math.log(fMin))) * (W - l - r);
  const sy = (v: number) => t + ((y1 - v) / (y1 - y0)) * (H - t - b);
  const grid: string[] = [];
  for (const f of TICKS.filter((x) => x >= fMin && x <= fMax)) grid.push(`<line x1="${sx(f).toFixed(1)}" x2="${sx(f).toFixed(1)}" y1="${t}" y2="${H - b}" stroke="#e3e6ea"/><text x="${sx(f).toFixed(1)}" y="${H - b + 16}" text-anchor="middle">${tick(f)}</text>`);
  const step = y1 - y0 > 40 ? 10 : 5;
  for (let v = y0; v <= y1; v += step) grid.push(`<line x1="${l}" x2="${W - r}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" stroke="#e3e6ea"/><text x="${l - 6}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${fx(v, 0)}</text>`);
  const paths = lines.map((s) => {
    const pts = s.x.map((f, k) => (Number.isFinite(s.y[k]) && f >= fMin && f <= fMax ? `${sx(f).toFixed(1)},${sy(s.y[k]).toFixed(1)}` : null)).filter(Boolean).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="1.6"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
  });
  const legend = lines.map((s, k) => `<g transform="translate(${l + k * 200},${H + 8})"><line x1="0" x2="24" y1="0" y2="0" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/><text x="30" y="4">${esc(s.label)}</text></g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 20}" width="${W}" height="${H + 20}" font-family="system-ui, sans-serif" font-size="11" fill="#5b6470" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="100%" height="100%" fill="#fff"/><text x="4" y="12">${esc(unit)}</text>${grid.join('')}${paths.join('')}${legend.join('')}</svg>`;
}

const figure = (title: string, svg: string) => `<figure>${svg}<figcaption>${esc(title)}</figcaption></figure>`;

/** АЧХ расчёта с целью и, если есть, замером со сдвигом уровня (`alignMeasured`). */
export function responseSvg(ev: SetupEval, measured: Pick<MeasurementData, 'f' | 'db'> | null): { svg: string; shift: number | null } {
  const r = ev.response;
  const align = measured ? alignMeasured(ev, measured) : null;
  return {
    shift: align ? align.shift : null,
    svg: svgChart('АЧХ в месте слушателя: расчёт, цель и замер', [
      { label: 'Расчёт', x: r.f, y: r.db, color: '#2f5fb3' },
      { label: 'Цель', x: r.f, y: r.target, color: '#7b8490', dash: '4 4' },
      ...(align ? [{ label: 'Замер (уровень сдвинут)', x: align.f, y: align.db, color: '#1f8a4c', dash: '8 3' }] : []),
    ], r.f[0], r.f[r.f.length - 1]),
  };
}

// ---------- HTML ----------

const STYLE = `
@page { size: A4; margin: 16mm; }
body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1f24; max-width: 800px; margin: 24px auto; padding: 0 16px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; border-bottom: 1px solid #d0d5db; padding-bottom: 4px; }
h3 { font-size: 15px; margin: 18px 0 4px; } .muted { color: #5b6470; } .tag { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 12px; margin-right: 4px; }
.calc { background: #e7eefb; } .meas { background: #e4f4ea; } .rec { background: #fbf1df; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; } th, td { border: 1px solid #d0d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; } figure { margin: 12px 0; } figcaption { font-size: 12px; color: #5b6470; }
svg { width: 100%; height: auto; } ul { padding-left: 20px; }
@media print { body { margin: 0; max-width: none; } h2 { break-after: avoid; } figure, table { break-inside: avoid; } }
`;

const table = (head: readonly string[], rows: readonly (readonly string[])[], numeric: readonly boolean[] = []) =>
  `<table><thead><tr>${head.map((h, k) => `<th${numeric[k] ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${numeric[k] ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function technicalHtml(i: TechInput): string {
  const c = i.config;
  const g = c.geometry.kind === 'rect' ? c.geometry : null;
  const a = i.analysis;
  const H: string[] = [];
  H.push(`<h1>Технический отчёт: «${esc(i.room.name)}»</h1>`);
  H.push(`<p class="muted">Составлен ${esc(when(i.now))} (UTC). Конфигурация: ${esc(i.label.toLowerCase())}, ревизия ${c.revision}. Ядро: ${esc(i.coreVersion)}.</p>`);
  H.push('<p><span class="tag calc">расчёт</span>модель приложения <span class="tag meas">измерение</span>замер в комнате <span class="tag rec">рекомендация</span>вывод правил советов. Расчёт не заменяет измерение.</p>');

  H.push('<h2>Комната</h2>');
  H.push(`<ul>${g ? `<li>Размеры: ${fx(g.depth, 2)} × ${fx(g.width, 2)} × ${fx(g.height, 2)} м</li>` : '<li>Форма: не прямоугольная (размеры — в модели)</li>'}<li>Цель: ${esc(GOAL_LABEL[i.room.goals.primary])}; бюджет: ${isKnown(i.room.goals.budget) ? esc(String(i.room.goals.budget)) : 'не задан'}</li><li>Элементы обработки: ${c.treatment.enabled ? c.treatment.items.filter((t) => t.enabled !== false).length : 0}${c.treatment.enabled ? '' : ' (план не учитывается)'}</li></ul>`);
  H.push(table(['Источник', 'Вид', 'x, м', 'y, м', 'z, м'], c.audio.sources.map((s) => [s.name, s.kind === 'sub' ? 'сабвуфер' : 'колонка', fx(s.position.x, 2), fx(s.position.y, 2), fx(s.position.z, 2)]), [false, false, true, true, true]));
  H.push(table(['Слушатель', 'x, м', 'y, м', 'z, м'], c.listening.listeners.map((l) => [`${l.name}${l.primary && c.listening.listeners.length > 1 ? ' (основной)' : ''}`, fx(l.position.x, 2), fx(l.position.y, 2), fx(l.position.z, 2)]), [false, true, true, true]));

  if (a) {
    const p = a.provenance;
    H.push('<h2><span class="tag calc">расчёт</span>Отклик и показатели</h2>');
    H.push(`<p class="muted">Метод: ${esc(p.method)}; версия алгоритма ${esc(p.algorithmVersion)}; модель ${a.ev.model === 'wave' ? 'волновая' : 'модальная'}; отпечаток входных данных ${esc(p.inputHash)}.</p>`);
    const chart = responseSvg(a.ev, i.measured ? i.measured.data : null);
    H.push(figure('АЧХ в месте слушателя: расчёт, цель и замер', chart.svg));
    if (chart.shift !== null && i.measured) H.push(`<p class="muted"><span class="tag meas">измерение</span>«${esc(i.measured.m.name)}», ${esc(when(i.measured.m.recordedAt))}: уровень сдвинут на ${fx(chart.shift, 1)} дБ к медиане расчёта в полосе ${fx(a.ev.fLo, 0)}–${fx(a.ev.fHi, 0)} Гц — сравнивается форма, а не громкость.</p>`);
    H.push(table(['Показатель', 'Значение'], [
      ['Неровность баса в месте слушателя', `${fx(a.ev.score, 1)} дБ (меньше — ровнее)`],
      ['Оценка по цели подбора (со штрафами)', `${fx(a.ev.objScore, 1)} дБ`],
      ['Полоса оценки', `${fx(a.ev.fLo, 0)}–${fx(a.ev.fHi, 0)} Гц`],
      ['Объём / площадь поверхностей', `${fx(a.reverb.volume, 1)} м³ / ${fx(a.reverb.surfaceArea, 1)} м²`],
      ['Время реверберации 500–1000 Гц', `${fx(a.reverb.tMid, 2)} с`],
      ['Частота Шрёдера', `${fx(a.reverb.schroeder, 0)} Гц`],
      ...a.ev.penalties.map((x) => ['Правило расстановки', `${x.name} (штраф ${fx(x.value, 1)} дБ)`] as [string, string]),
    ], [false, true]));
    for (const x of a.problems) H.push(`<p>• ${esc(x)}</p>`);
    H.push('<h3>Реверберация по октавам</h3>');
    H.push(table(['Октава, Гц', 'Сэбин, с', 'Эйринг, с', 'Принято, с', 'Формула', 'Средний α', 'A, м²'], a.reverb.bands.map((f, k) => [
      fx(f, 0), fx(a.reverb.sabine[k], 2), fx(a.reverb.eyring[k], 2), fx(a.reverb.used[k], 2), a.reverb.formula[k] === 'eyring' ? 'Эйринг' : 'Сэбин', fx(a.reverb.meanAlpha[k], 2), fx(a.reverb.absorptionArea[k], 1),
    ]), [true, true, true, true, false, true, true]));
    if (a.modes.length) {
      H.push(`<h3>Моды комнаты (первые ${Math.min(MODES_MAX, a.modes.length)})</h3>`);
      H.push(table(['(nx, ny, nz)', 'Частота, Гц', 'Вид', 'Примечание'], a.modes.slice(0, MODES_MAX).map((m) => [
        `(${m.n.join(', ')})`, fx(m.f, 1), KIND[m.kind], [m.degenerate ? 'совпадает с другой' : '', m.clustered ? 'в группе близких' : ''].filter(Boolean).join(', ') || '—',
      ]), [false, true, false, false]));
    }
  } else H.push('<h2>Расчёт</h2><p>Расчёт конфигурации не готов: в отчёте только исходные данные и записи.</p>');

  const mine = i.measurements.filter((m) => m.configId === c.id);
  H.push('<h2><span class="tag meas">измерение</span>Замеры конфигурации</h2>');
  H.push(mine.length ? table(['Когда', 'Название', 'Вид'], mine.map((m) => [when(m.recordedAt), m.name, m.kind])) : '<p>Замеров этой конфигурации нет: выводы опираются на модель.</p>');

  const s = sortAdvice(i.recs);
  H.push('<h2><span class="tag rec">рекомендация</span>Рекомендации</h2>');
  if (!s.active.length) H.push('<p>Активных рекомендаций нет.</p>');
  for (const r of s.active) {
    H.push(`<h3>${esc(r.title)}</h3><p class="muted">${esc(`${GROUP_LABEL[r.group]} · ${EVIDENCE_LABEL[r.evidence]} · ${r.cost.kind === 'free' ? 'бесплатно' : `покупка: ${r.cost.what}, стоимость неизвестна`} · трудоёмкость: ${EFFORT_LABEL[r.effort]}`)}</p>`);
    H.push(`<ul>${[`Причина: ${r.cause}`, `Источник и метод: ${r.source}; ${r.method}`, `Применимость: ${r.applicability}`, `Эффект: ${r.effect}`, `Побочные последствия: ${r.sideEffects}`, ...r.actions.map((x) => `Действие: ${x}`), `Проверка: ${r.verify}`, ...r.notes.map((x) => `Оговорка: ${x}`)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  }
  if (s.blocked.length) H.push(`<p>Не предлагаются из-за ограничений:</p><ul>${s.blocked.map((r) => `<li>${esc(`${r.title} — ${r.conflicts.join(' ')}`)}</li>`).join('')}</ul>`);

  H.push('<h2>План работ</h2>');
  H.push(i.plan.items.length ? table(['Пункт', 'Состояние', 'Подтверждён замером'], sortPlan(i.plan.items).map((x) => [x.title, PLAN_STATUS_LABEL[x.status], x.verifiedBy ? (i.measurements.find((m) => m.id === x.verifiedBy)?.name ?? 'да') : '—'])) : '<p>План пуст.</p>');

  const run = i.runs.find((r) => r.configId === c.id);
  if (run && run.result.best[0]) {
    H.push('<h2><span class="tag calc">расчёт</span>Подбор расстановки</h2>');
    H.push(`<p>Лучший найденный вариант (${esc(run.createdAt ? run.createdAt.slice(0, 10) : 'дата неизвестна')}): неровность ${fx(run.result.best[0].score, 1)} дБ против ${fx(run.result.baseline.score, 1)} дБ у исходной; проверено вариантов: ${run.result.evaluated}. Глобальная оптимальность не доказана.</p>`);
  }
  if (i.eq && i.eq.filters.length) {
    H.push('<h2>Эквалайзер</h2>');
    H.push(`<p>По ${esc(i.eq.source)}; предусилитель ${fx(i.eq.preamp, 1)} дБ.</p>`);
    H.push(table(['№', 'Частота, Гц', 'Усиление, дБ', 'Q', 'Включён'], i.eq.filters.map((p, k) => [String(k + 1), fx(p.f, 1), fx(p.gainDb, 1), fx(p.q, 2), p.enabled ? 'да' : 'нет']), [true, true, true, true, false]));
  }
  const lim = a ? [...a.provenance.limitations, ...a.provenance.warnings] : [];
  if (lim.length) H.push(`<h2>Ограничения и предупреждения</h2><ul>${lim.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  return `<!DOCTYPE html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(`Технический отчёт: ${i.room.name}`)}</title><style>${STYLE}</style></head><body>${H.join('\n')}</body></html>\n`;
}

/** Машиночитаемое содержание отчёта. */
export function technicalJson(i: TechInput) {
  const c = i.config, a = i.analysis;
  return {
    format: 'room-acoustics-v2-technical-report', version: 1, createdAt: i.now, coreVersion: i.coreVersion,
    room: { name: i.room.name, goal: i.room.goals.primary },
    config: { id: c.id, label: i.label, revision: c.revision, geometry: c.geometry.kind === 'rect' ? { depth: c.geometry.depth, width: c.geometry.width, height: c.geometry.height } : { kind: c.geometry.kind } },
    sources: c.audio.sources.map((s) => ({ name: s.name, kind: s.kind, position: s.position })),
    listeners: c.listening.listeners.map((l) => ({ name: l.name, primary: !!l.primary, position: l.position })),
    calculation: a ? {
      provenance: a.provenance, model: a.ev.model, score: a.ev.score, objScore: a.ev.objScore, band: [a.ev.fLo, a.ev.fHi], penalties: a.ev.penalties,
      response: a.ev.response, reverb: a.reverb, modes: a.modes.slice(0, MODES_MAX),
    } : null,
    measurement: i.measured ? { name: i.measured.m.name, recordedAt: i.measured.m.recordedAt, f: i.measured.data.f, db: i.measured.data.db } : null,
    recommendations: sortAdvice(i.recs).active.map((r) => ({ id: r.id, title: r.title, group: r.group, evidence: r.evidence, cause: r.cause, effect: r.effect, verify: r.verify })),
    plan: i.plan.items.map((x) => ({ title: x.title, status: x.status, verifiedBy: x.verifiedBy ?? null })),
    eq: i.eq ? { source: i.eq.source, preamp: i.eq.preamp, filters: i.eq.filters } : null,
  };
}

/** CSV (точка с запятой, десятичная точка). */
export const responseCsv = (r: SetupEval['response']) => ['f_hz;model_db;target_db', ...r.f.map((f, k) => `${f};${r.db[k]};${r.target[k]}`)].join('\n') + '\n';
export const modesCsv = (m: readonly Mode[]) => ['nx;ny;nz;f_hz;kind;degenerate;clustered', ...m.map((x) => `${x.n.join(';')};${x.f};${x.kind};${x.degenerate};${x.clustered}`)].join('\n') + '\n';
export const reverbCsv = (r: ReverbResult) => ['band_hz;sabine_s;eyring_s;used_s;mean_alpha;absorption_m2', ...r.bands.map((f, k) => `${f};${r.sabine[k]};${r.eyring[k]};${r.used[k]};${r.meanAlpha[k]};${r.absorptionArea[k]}`)].join('\n') + '\n';
