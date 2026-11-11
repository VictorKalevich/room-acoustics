// 022: «Поправить границы комнаты» открывается из шага «Размеры» и из группы «Изменить комнату»,
// а сам блок поправки живёт в панели скана на экране «Комната». Здесь — просьба открыть его.
const listeners = new Set<() => void>();

export function onScanFixRequest(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export function requestScanFix() {
  listeners.forEach((f) => f());
}
