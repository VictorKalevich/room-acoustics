// Экран v2: верхняя панель и область содержимого. Заголовок вкладки браузера следует за экраном; при смене
// маршрута фокус переходит к содержимому (см. App), чтобы чтение с экрана начиналось с нового раздела.
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { TopBar } from '../design-system';

export const APP_TITLE = 'Room Acoustics v2';

export function Screen({ title, context, backHref, actions, children, reading }: {
  title: string; context?: string; backHref?: string; actions?: ComponentChildren; children: ComponentChildren; reading?: boolean;
}) {
  useEffect(() => { document.title = title === APP_TITLE ? APP_TITLE : `${title} — ${APP_TITLE}`; }, [title]);
  return (
    <>
      <TopBar title={title} context={context} backHref={backHref} actions={actions} />
      <div class={reading ? 'al-content al-content--reading' : 'al-content'} id="main" tabindex={-1}>{children}</div>
    </>
  );
}
