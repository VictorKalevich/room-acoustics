// V2-055: технический отчёт — самостоятельный HTML (без скриптов и внешних ресурсов, пользовательский текст
// экранирован), разделы расчёта, измерения и рекомендаций, замер со сдвигом уровня к модели, JSON и CSV.
import { describe, expect, it } from 'vitest';
import { calcModes, calcReverb, calcSetup, CORE_VERSION } from '../../src/v2/adapters/calculations';
import { buildAdvice } from '../../src/v2/application/advice';
import { addToPlan } from '../../src/v2/application/plan';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import { alignMeasured, modesCsv, responseCsv, responseSvg, reverbCsv, svgChart, technicalHtml, technicalJson, type TechInput } from '../../src/v2/application/techReport';
import { DEFAULT_GOALS } from '../../src/v2/domain/model';
import type { MeasurementRecord } from '../../src/v2/domain/measurement';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;

function input(name = 'Тест'): TechInput {
  const r = buildRoom({ ...DEFAULT_NEW_ROOM, name, depth: 5, width: 4, height: 2.5, layout: '2.1' }, id, NOW);
  const c = r.current;
  const ev = calcSetup(c, NOW), rev = calcReverb(c, NOW), md = calcModes(c, NOW);
  if (!ev.ok || !rev.ok || !md.ok) throw new Error('расчёт недоступен');
  const recs = buildAdvice({ config: c, goals: structuredClone(DEFAULT_GOALS), analysis: null, measurements: [], measured: null, warnings: [] });
  const plan = addToPlan({ id: 'p', roomId: r.id, updatedAt: '', items: [] }, recs[0], id, NOW);
  return {
    room: r, config: c, label: 'Текущая', now: NOW, recs, plan, runs: [], eq: { filters: [{ id: 'q', type: 'peaking', f: 50, gainDb: -6, q: 4, enabled: true }], source: 'модели', preamp: 0 },
    measurements: [], measured: null, coreVersion: CORE_VERSION,
    analysis: { ev: ev.result.value, reverb: rev.result.value, modes: md.result.value.modes, provenance: ev.result.provenance, problems: ['Гул на 40 Гц'] },
  };
}

describe('технический отчёт (V2-055)', () => {
  it('HTML: самостоятельный, без скриптов и внешних ссылок; разделы и метки; пользовательский текст экранирован', () => {
    const i = input('Зал <script>alert(1)</script> & "кино"');
    const html = technicalHtml(i);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toMatch(/<script|src=|href=|@import|url\(|<link/i);
    expect(html).toContain('Зал &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;кино&quot;');
    for (const s of ['Отклик и показатели', 'Реверберация по октавам', 'Моды комнаты (первые', 'Замеры конфигурации', 'Рекомендации', 'План работ', 'Эквалайзер', 'Расчёт не заменяет измерение', 'class="tag calc"', 'class="tag meas"', 'class="tag rec"', '@media print']) expect(html).toContain(s);
    expect(html.match(/<polyline /g)).toHaveLength(2);
    expect(html).toContain(i.analysis!.provenance.inputHash);
  });

  it('замер: уровень сдвинут к медиане модели в полосе — третья линия и пояснение', () => {
    const i = input();
    const r = i.analysis!.ev.response;
    const data = { id: 'm', ref: 'dB re unknown' as const, f: r.f.map((f) => f), db: r.db.map((v) => v + 74) };
    const al = alignMeasured(i.analysis!.ev, data)!;
    expect(al.shift).toBeCloseTo(-74, 9);
    expect(al.db[3]).toBeCloseTo(r.db[3], 9);
    expect(alignMeasured(i.analysis!.ev, { f: [1000, 2000], db: [1, 2] })).toBeNull();
    const m: MeasurementRecord = {
      id: 'm', roomId: i.room.id, configId: i.config.id, kind: 'frequency-response', name: 'Свип <1>', recordedAt: NOW, source: { kind: 'app', device: 'тест' },
      provenance: { kind: 'measured', method: 'свип', algorithmVersion: 't', inputHash: '', createdAt: NOW, warnings: [], limitations: [] }, snapshotId: null, lateBinding: false, summary: { fMin: 20, fMax: 200, count: 10 },
    };
    const html = technicalHtml({ ...i, measured: { m, data }, measurements: [m] });
    expect(html.match(/<polyline /g)).toHaveLength(3);
    expect(html).toContain('«Свип &lt;1&gt;»');
    expect(html).toContain('уровень сдвинут на −74,0 дБ');
  });

  it('без расчёта — только исходные данные; JSON и CSV', () => {
    const i = input();
    expect(technicalHtml({ ...i, analysis: null })).toContain('Расчёт конфигурации не готов');
    const j = technicalJson(i);
    expect(j.format).toBe('room-acoustics-v2-technical-report');
    expect(j.calculation!.modes.length).toBeLessThanOrEqual(40);
    expect(JSON.parse(JSON.stringify(j)).sources.length).toBe(i.config.audio.sources.length);
    const rc = responseCsv(i.analysis!.ev.response).trim().split('\n');
    expect(rc[0]).toBe('f_hz;model_db;target_db');
    expect(rc).toHaveLength(i.analysis!.ev.response.f.length + 1);
    expect(modesCsv(i.analysis!.modes).split('\n')[1].split(';')).toHaveLength(7);
    expect(reverbCsv(i.analysis!.reverb).split('\n')[0]).toBe('band_hz;sabine_s;eyring_s;used_s;mean_alpha;absorption_m2');
    const svg = svgChart('Т', [{ label: 'a', x: [20, 200], y: [0, 3], color: '#000' }], 20, 200);
    expect(svg).toContain('aria-label="Т"');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).not.toMatch(/class=/);
    const rs = responseSvg(i.analysis!.ev, null);
    expect(rs.shift).toBeNull();
    expect(rs.svg.match(/<polyline /g)).toHaveLength(2);
  });
});
