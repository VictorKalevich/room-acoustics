// Плитка инструмента: переход к инструменту и отметка «в избранное» (V2-019).
import { Icon, IconButton } from '../../design-system';
import { toggleFavorite } from '../../application/settings';
import { useApp } from '../../shared/context';
import { href } from '../../shared/router';
import { TOOL_CATEGORIES, type ToolInfo } from './catalog';

export function ToolTile({ tool }: { tool: ToolInfo }) {
  const { settings, updateSettings } = useApp();
  const fav = settings.favorites.includes(tool.id);
  const cat = TOOL_CATEGORIES.find((c) => c.id === tool.category)!;
  return (
    <div class="al-tile" data-tool={tool.id}>
      <div class="al-tile__head">
        <span class="al-tile__icon"><Icon name={cat.icon} /></span>
        <a class="al-tile__link al-tile__title" href={href({ name: 'tool', toolId: tool.id })}>{tool.title}</a>
        <span class="al-tile__aside">
          <IconButton icon="star" small pressed={fav} label={fav ? `Убрать «${tool.title}» из избранного` : `Добавить «${tool.title}» в избранное`} onClick={() => updateSettings((s) => toggleFavorite(s, tool.id))} />
        </span>
      </div>
      <p class="al-tile__text">{tool.summary}</p>
    </div>
  );
}
