// Общее для панелей «Настройки»: элементы плана, блок экспорта с копированием и сохранением.
import { useRef, useState } from 'preact/hooks';
import type { Project } from '../../../state/project';
import { S } from '../../strings';

export function itemsOf(p: Project) {
  return [
    ...p.sources.filter((s) => p.current.positions[s.id]).map((s) => ({
      id: s.id, kind: (s.kind === 'sub' ? 'sub' : 'spk') as 'sub' | 'spk', pos: p.current.positions[s.id],
    })),
    { id: 'listener', kind: 'listener' as const, pos: p.current.listener },
  ];
}
export function ExportBlock({ id, title, text, file }: { id: string; title: string; text: string; file: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    try {
      navigator.clipboard.writeText(text).then(done, () => { ref.current?.select(); });
    } catch {
      ref.current?.select();
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div class="export">
      <label for={id} class="export__title">{title}</label>
      <textarea id={id} ref={ref} readOnly rows={Math.min(8, text.split('\n').length)} value={text} />
      <div class="btn-row btn-row--tight">
        <button type="button" class="btn btn--small" onClick={copy}>{copied ? S.tuning.copied : S.tuning.copy}</button>
        <button type="button" class="btn btn--small btn--ghost" onClick={download}>{S.tuning.download}</button>
      </div>
    </div>
  );
}
