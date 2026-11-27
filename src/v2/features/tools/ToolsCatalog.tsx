// Каталог инструментов (V2-019, макеты M06/D06): пять категорий, поиск, избранное, недавние. Без комнаты.
import { useState } from 'preact/hooks';
import { EmptyState, Icon, Section, TextField } from '../../design-system';
import { useApp } from '../../shared/context';
import { Screen } from '../../shared/Screen';
import { TOOL_CATEGORIES, TOOLS, searchTools, toolById } from './catalog';
import { ToolTile } from './ToolTile';

export function ToolsCatalog() {
  const { settings } = useApp();
  const [query, setQuery] = useState('');
  const found = searchTools(query);
  const favorites = settings.favorites.map(toolById).filter((t) => !!t);
  const recent = settings.recentTools.map(toolById).filter((t) => !!t);
  return (
    <Screen title="Инструменты">
      <div class="al-stack al-stack--24">
        <div class="al-stack al-stack--8">
          <h1 class="al-text-headline">Инструменты</h1>
          <p class="al-text-secondary">{TOOLS.length} инструментов работают без комнаты. Совместимые параметры можно взять из комнаты и передать в неё.</p>
        </div>
        <TextField label="Поиск инструмента" type="search" value={query} onInput={setQuery} placeholder="Например: моды, задержка, RT60" />
        {query.trim() ? (
          found.length ? (
            <Section title={`Найдено: ${found.length}`}><div class="al-tiles">{found.map((t) => <ToolTile key={t.id} tool={t} />)}</div></Section>
          ) : <EmptyState icon="search" title="Ничего не найдено" text="Попробуйте другое слово: название величины, метод или задачу." />
        ) : (
          <>
            {favorites.length > 0 && <Section title="Избранное"><div class="al-tiles">{favorites.map((t) => <ToolTile key={t.id} tool={t} />)}</div></Section>}
            {recent.length > 0 && <Section title="Недавние"><div class="al-tiles">{recent.map((t) => <ToolTile key={t.id} tool={t} />)}</div></Section>}
            {TOOL_CATEGORIES.map((cat) => (
              <Section key={cat.id} id={`cat-${cat.id}`} title={cat.title}>
                <p class="al-text-small al-text-secondary"><Icon name={cat.icon} small /> {cat.text}</p>
                <div class="al-tiles">{TOOLS.filter((t) => t.category === cat.id).map((t) => <ToolTile key={t.id} tool={t} />)}</div>
              </Section>
            ))}
          </>
        )}
      </div>
    </Screen>
  );
}
