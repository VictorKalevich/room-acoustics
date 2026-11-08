// Мини-плеер над нижней панелью: виден, только пока играет тон.
import { useEffect, useState } from 'preact/hooks';
import { getTone, onTone, setToneFrequency, setToneVolume, stopTone, toggleTone } from '../audio/tone';
import { fmt } from '../format';
import { S } from '../strings';

export function MiniPlayer() {
  const [t, setT] = useState(getTone());
  useEffect(() => onTone(setT), []);
  useEffect(() => { document.body.classList.toggle('has-player', t.playing); }, [t.playing]);
  if (!t.playing) return null;
  return (
    <div class="miniplayer" role="region" aria-label={S.tone.player}>
      <div class="miniplayer__row">
        <button type="button" class="btn btn--small btn--ghost" aria-label={S.tone.down} onClick={() => setToneFrequency(Math.max(10, Math.round((t.f - 0.5) * 10) / 10))}>−</button>
        <span class="miniplayer__f"><strong>{fmt(t.f, 1)} Гц</strong>{t.label && <small> {t.label}</small>}</span>
        <button type="button" class="btn btn--small btn--ghost" aria-label={S.tone.up} onClick={() => setToneFrequency(Math.min(300, Math.round((t.f + 0.5) * 10) / 10))}>+</button>
        <button type="button" class="btn btn--small btn--primary" onClick={stopTone}>{S.tone.stop}</button>
      </div>
      <label class="miniplayer__vol">
        <span class="small">{S.tone.volume}</span>
        <input type="range" min="0" max="1" step="0.01" value={t.volume} onInput={(e) => setToneVolume(+(e.target as HTMLInputElement).value)} />
      </label>
    </div>
  );
}

/** Кнопка ▶ / ■ для частоты. */
export function PlayButton({ f, label }: { f: number; label?: string }) {
  const [t, setT] = useState(getTone());
  useEffect(() => onTone(setT), []);
  const on = t.playing && Math.abs(t.f - f) < 0.01;
  return (
    <button
      type="button"
      class={`play-btn${on ? ' is-on' : ''}`}
      aria-label={on ? S.tone.stop : S.tone.play(fmt(f, 1))}
      onClick={(e) => {
        e.stopPropagation();
        // синхронно в обработчике касания: иначе iOS не запустит звук
        toggleTone(f, label ?? '');
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">{on ? <rect x="4" y="4" width="8" height="8" rx="1" /> : <path d="M5 3.5v9l7.5-4.5z" />}</svg>
    </button>
  );
}
