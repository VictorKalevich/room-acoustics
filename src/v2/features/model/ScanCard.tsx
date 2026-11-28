// Скан помещения в модели (V2-046): повторное применение скана к выбранной конфигурации с отменой. Новую комнату по
// скану создают на экране создания (D61); выбор файла и распознавание — общие (features/scan).
import { Button, Card, useToast } from '../../design-system';
import { applyScan, scanInfo } from '../../application/scan';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { SCAN_FORMATS_TEXT, ScanPicker, ScanReview, n2, useScanImport } from '../scan/ScanImport';
import type { ConfigEdit } from './useConfig';

export function ScanCard({ edit }: { edit: ConfigEdit }) {
  const { clock } = useApp();
  const toast = useToast();
  const scan = useScanImport();
  const info = scanInfo(edit.config);
  const apply = () => {
    const s = scan.ready;
    if (!s) return;
    let notes: string[] = [];
    void edit.apply((x) => { const r = applyScan(x, s.choice, s.info, clock.newId, clock.now()); notes = r.notes; return r.config; }, 'Скан помещения')
      .then((ok) => { if (ok) { toast.show(['Скан применён: размеры, проёмы и мебель из скана.', ...notes].join(' ')); scan.clear(); } });
  };
  return (
    <Card title="Скан помещения" subtitle={SCAN_FORMATS_TEXT}>
      <div class="al-stack al-stack--16">
        {info && <p class="al-text-small al-text-secondary">{`Применён скан «${info.fileName}»: ${n2(info.depth)} × ${n2(info.width)} × ${n2(info.height)} м, ${dateTime(info.appliedAt)}. Найденное в скане помечено; новое применение заменяет только его.`}</p>}
        <ScanPicker scan={scan} />
        {scan.found && !scan.busy && (
          <div class="al-stack al-stack--16">
            <ScanReview scan={scan} />
            <div class="al-row">
              <Button variant="primary" small disabled={!scan.ready} onClick={apply}>Применить к конфигурации</Button>
              <Button variant="ghost" small onClick={scan.clear}>Отказаться</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
