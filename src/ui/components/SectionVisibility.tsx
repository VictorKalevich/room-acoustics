// 035: виден ли раздел — один источник для общих хуков расчёта (useCompute.ts). Задают его скрывающие обёртки App и
// RetainedSection; вложенный раздел виден, только если виден и внешний; вне обёрток — виден.
import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

const Visible = createContext(true);

export function SectionVisibility({ visible, children }: { visible: boolean; children: ComponentChildren }) {
  const outer = useContext(Visible);
  return <Visible.Provider value={outer && visible}>{children}</Visible.Provider>;
}

export const useSectionVisible = (): boolean => useContext(Visible);
