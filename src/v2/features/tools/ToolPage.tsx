// Страница инструмента (V2-019): отметка в недавних, избранное, переход к каталогу; экран инструмента — views (V2-036–V2-040).
import { useEffect } from 'preact/hooks';
import { Badge, EmptyState, IconButton, Notice, buttonClass } from '../../design-system';
import { pushRecent, toggleFavorite } from '../../application/settings';
import { useApp } from '../../shared/context';
import { href } from '../../shared/router';
import { Screen } from '../../shared/Screen';
import { TOOL_CATEGORIES, toolById } from './catalog';
import { TOOL_VIEWS } from './views';

export function ToolPage({ toolId }: { toolId: string }) {
  const { settings, updateSettings } = useApp();
  const tool = toolById(toolId);
  useEffect(() => { if (tool) void updateSettings((s) => pushRecent(s, tool.id)); }, [tool, updateSettings]);

  if (!tool) {
    return (
      <Screen title="Инструмент не найден" backHref={href({ name: 'tools' })}>
        <EmptyState icon="tools" title="Такого инструмента нет" text="Адрес мог устареть. Откройте каталог и выберите инструмент." action={<a class={buttonClass('primary')} href={href({ name: 'tools' })}>Все инструменты</a>} />
      </Screen>
    );
  }
  const fav = settings.favorites.includes(tool.id);
  const cat = TOOL_CATEGORIES.find((c) => c.id === tool.category)!;
  const View = TOOL_VIEWS[tool.id];
  return (
    <Screen title={tool.title} context={cat.title} backHref={href({ name: 'tools' })}
      actions={<IconButton icon="star" pressed={fav} label={fav ? 'Убрать из избранного' : 'Добавить в избранное'} onClick={() => updateSettings((s) => toggleFavorite(s, tool.id))} />}>
      <div class="al-stack al-stack--16">
        <div class="al-stack al-stack--8">
          <h1 class="al-text-headline">{tool.title}</h1>
          <p class="al-text-secondary">{tool.summary}</p>
          {tool.audio && <div class="al-row"><Badge tone="warning">{tool.audio === 'input' ? 'Нужен микрофон: запуск только кнопкой' : 'Воспроизводит звук: запуск только кнопкой'}</Badge></div>}
        </div>
        {View ? <View tool={tool} /> : <Notice title="Инструмент недоступен">Экран этого инструмента не найден в этой версии приложения.</Notice>}
      </div>
    </Screen>
  );
}
