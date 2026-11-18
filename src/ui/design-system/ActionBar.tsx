import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSectionVisible } from '../components/SectionVisibility';

/** Presentation only: the owning screen retains its existing action and calculation state. */
export function ActionBar({ children, label = 'Основное действие' }: { children: ComponentChildren; label?: string }) {
  const visible = useSectionVisible();
  const bar = useRef<HTMLDivElement>(null);
  const [playerOffset, setPlayerOffset] = useState(0);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (!el || !visible) return;
    // Reserve at the end of the whole page, including content after this panel.
    const observer = new ResizeObserver(() => {
      el.closest<HTMLElement>('.content')?.style.setProperty('--action-clearance', el.getBoundingClientRect().height + 'px');
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    // Focus alone must not move a button between pointerdown and click. Only an
    // actual viewport reduction (the mobile keyboard) puts the action in the flow.
    const viewport = window.visualViewport;
    const update = () => setTyping(!!viewport && viewport.scale === 1 && window.innerHeight - viewport.height > 120);
    update();
    viewport?.addEventListener('resize', update);
    return () => viewport?.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    if (!visible) return;
    let player: Element | null = null;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-16'));
      const offset = player ? player.getBoundingClientRect().height + gap : 0;
      setPlayerOffset(offset);
      bar.current?.closest<HTMLElement>('.content')?.style.setProperty('--action-player-offset', offset + 'px');
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      const next = document.querySelector('.miniplayer');
      if (next === player) return;
      resize.disconnect(); player = next;
      if (player) resize.observe(player);
      measure();
    };
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    watch();
    return () => { mutations.disconnect(); resize.disconnect(); };
  }, [visible]);
  return <div class="action-slot">
    <div ref={bar} style={{ '--action-player-offset': playerOffset ? `${playerOffset}px` : undefined }} class={'action-bar' + (typing ? ' is-inline' : '')} hidden={!visible} role="region" aria-label={label}>{children}</div>
  </div>;
}
