import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type Tab = 'room' | 'modes' | 'placement' | 'tuning' | 'projects' | 'measure' | 'voice' | 'report' | 'sync' | 'help' | 'about';
export type AnalysisView = 'overview' | 'list' | 'field';
export type TuningView = 'sub' | 'eq' | 'treatment';
export type MeasureView = 'sweep' | 'clap' | 'rta' | 'compare';
export type Destination = Tab | 'analysis' | 'analysis/list' | 'placement/auto' | 'field' | 'overview' | 'manual' | `tuning/${TuningView}` | `measure/${MeasureView}`;
export interface Route { tab: Tab; analysis: AnalysisView; placement: 'auto' | 'manual'; tuning: TuningView; measure: MeasureView }
const INITIAL: Route = { tab: 'room', analysis: 'overview', placement: 'auto', tuning: 'sub', measure: 'sweep' };
const TABS: Tab[] = ['room', 'modes', 'placement', 'tuning', 'projects', 'measure', 'voice', 'report', 'sync', 'help', 'about'];

/** Old bookmarks remain valid; view selection is UI state, never project data. */
export function resolveRoute(hash: string, previous: Route = INITIAL): Route {
  const path = hash.replace(/^#/, '');
  if (path === 'analysis' || path === 'overview') return { ...previous, tab: 'modes', analysis: 'overview' };
  if (path === 'modes' || path === 'analysis/list') return { ...previous, tab: 'modes', analysis: 'list' };
  if (path === 'field') return { ...previous, tab: 'modes', analysis: 'field' };
  if (path === 'manual') return { ...previous, tab: 'placement', placement: 'manual' };
  if (path === 'placement' || path === 'placement/auto') return { ...previous, tab: 'placement', placement: 'auto' };
  const [tab, section] = path.split('/');
  if (tab === 'tuning' && ['sub', 'eq', 'treatment'].includes(section)) return { ...previous, tab, tuning: section as TuningView };
  if (tab === 'measure' && ['sweep', 'clap', 'rta', 'compare'].includes(section)) return { ...previous, tab, measure: section as MeasureView };
  return { ...previous, tab: TABS.includes(path as Tab) ? path as Tab : 'room' };
}

export function routePath(route: Route): string {
  if (route.tab === 'modes') return { overview: 'analysis', list: 'modes', field: 'field' }[route.analysis];
  if (route.tab === 'placement') return route.placement === 'manual' ? 'manual' : 'placement';
  if (route.tab === 'tuning') return `tuning/${route.tuning}`;
  if (route.tab === 'measure') return `measure/${route.measure}`;
  return route.tab;
}

export function useNavigation() {
  const [route, setRoute] = useState(() => resolveRoute(location.hash));
  const current = useRef(route);
  const positions = useRef(new Map<string, number>());
  const previousPath = useRef(routePath(route));
  const go = (destination: Destination) => {
    const prev = current.current;
    positions.current.set(routePath(prev), window.scrollY);
    // Main tabs restore their last subsection; explicit destinations select a subsection.
    const next = TABS.includes(destination as Tab)
      ? { ...prev, tab: destination as Tab }
      : resolveRoute(destination, prev);
    const path = routePath(next);
    if (path !== routePath(prev)) history.pushState(null, '', `#${path}`);
    current.current = next;
    setRoute(next);
  };
  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const sync = () => {
      const next = resolveRoute(location.hash, current.current);
      if (routePath(next) === routePath(current.current)) return;
      positions.current.set(routePath(current.current), window.scrollY);
      current.current = next;
      setRoute(next);
    };
    addEventListener('popstate', sync);
    addEventListener('hashchange', sync);
    return () => {
      history.scrollRestoration = previousRestoration;
      removeEventListener('popstate', sync);
      removeEventListener('hashchange', sync);
    };
  }, []);
  useLayoutEffect(() => {
    const path = routePath(route);
    if (path === previousPath.current) return;
    previousPath.current = path;
    scrollTo({ top: positions.current.get(path) ?? 0, behavior: 'instant' });
  }, [route]);
  return { route, go };
}
