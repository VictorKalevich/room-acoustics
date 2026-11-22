import type { InputEvent } from '../audio/noiseDiagnostics';
import { Details, Note } from '../design-system';
import { fmt } from '../format';
import { S } from '../strings';

const t = S.noise.input057;
const EVENT_TYPES: readonly InputEvent['type'][] = ['mute', 'unmute', 'ended', 'devicechange', 'context'];
const isEvent = (e: unknown): e is InputEvent => !!e && typeof e === 'object' && Number.isFinite((e as InputEvent).atMs) &&
  EVENT_TYPES.includes((e as InputEvent).type) && ((e as InputEvent).state === undefined || typeof (e as InputEvent).state === 'string');

/** 057: окружение запуска, события входа и пределы идентификации — живой шумомер и запись истории (у старых записей полей нет). */
export function InputDiagnostics({ capture }: { capture: Record<string, unknown> | null }) {
  const env = capture?.environment as { displayMode?: unknown; appleStandalone?: unknown } | undefined;
  const events = Array.isArray(capture?.events) ? (capture.events as unknown[]).filter(isEvent) : null;
  const mode = env && (env.displayMode === 'standalone' || env.displayMode === 'browser') ? env.displayMode : null;
  return <>
    {env && <p>{t.launch} · {mode ? t.modes[mode] : S.noise.unknown}
      {typeof env.appleStandalone === 'boolean' && ` · navigator.standalone ${env.appleStandalone ? S.noise.yes : S.noise.no}`}</p>}
    {events && <Details summary={t.events(events.length)}>
      {events.length ? <ul class="plain-list">{events.map((e, i) => <li key={i}>
        {fmt(e.atMs / 1000, 1)} с · {e.type === 'context' ? t.context(e.state?.slice(0, 20) ?? S.noise.unknown) : t.names[e.type]}
      </li>)}</ul> : <p class="small">{t.noEvents}</p>}
    </Details>}
    <Note>{t.identity}</Note>
  </>;
}
