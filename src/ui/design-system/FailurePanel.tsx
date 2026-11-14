// Сообщение о сбое (028): раздел или всё приложение не отрисовались. Собрано по образцу закрытых экранов (021/022):
// Panel с заголовком, пояснение и ряд действий; ниже — необязательный итог действия (например, Note об экспорте).
import type { ComponentChildren } from 'preact';
import { Panel } from './Fields';

interface Props {
  title: string;
  text: string;
  /** Кнопки действий: первое — основное (btn--primary). */
  actions: ComponentChildren;
  children?: ComponentChildren;
}

export function FailurePanel({ title, text, actions, children }: Props) {
  return (
    <div class="screen" role="alert">
      <Panel title={title}>
        <p class="small">{text}</p>
        <div class="btn-row">{actions}</div>
        {children}
      </Panel>
    </div>
  );
}
