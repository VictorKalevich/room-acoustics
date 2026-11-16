// 035: расчёт видимого раздела не ждёт задачи скрытых (шаг 8 плана рефакторинга). Комната волновая — расчёты идут в
// воркере. Воркер занят чужой долгой задачей (подробная карта слушателя, отправлена ему напрямую), пока интерфейс ставит задачи
// видимого и скрытого разделов; порядок ответов показывает, какую задачу воркер взял раньше. Начатую задачу видимый
// раздел всё равно ждёт — поэтому обе задачи должны успеть встать в очередь, пока воркер занят.
import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../src/state/project';
import { draftSaved } from './helpers';

const BUSY = 900001;

interface Entry { ev: 'job' | 'done' | 'cancel'; id: number; type?: string }

/** Проект с волновой комнатой и запись задач воркера: отправленные задачи и ответы по порядку. */
const prepare = (page: Page) => page.addInitScript(() => {
  if (!sessionStorage.getItem('prio')) {
    sessionStorage.setItem('prio', '1');
    localStorage.setItem('ra-draft-pending', JSON.stringify({
      id: 'prio', name: 'Приоритет', room: { model: 'wave' }, roomReady: true,
      current: { placed: true, listener: { x: 2.3, y: 1.6, z: 1.1 }, positions: {} },
    }));
  }
  const w = window as unknown as { __log: Entry[]; __worker: Worker };
  w.__log = [];
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url: string | URL, opts?: WorkerOptions) {
      super(url, opts);
      w.__worker = this;
      this.addEventListener('message', (e: MessageEvent<{ id: number; kind: string }>) => {
        if (e.data.kind !== 'progress') w.__log.push({ ev: 'done', id: e.data.id });
      });
    }
    postMessage(m: unknown, t?: Transferable[] | StructuredSerializeOptions) {
      const job = m as { id?: number; type?: string; cancel?: number };
      if (job && job.type) w.__log.push({ ev: 'job', id: job.id!, type: job.type });
      else if (job && job.cancel !== undefined) w.__log.push({ ev: 'cancel', id: job.cancel });
      return super.postMessage(m, t as Transferable[]);
    }
  };
});

const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: Entry[] }).__log);
const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);

/** Все отправленные задачи получили ответ (снятые не ждём: ответа у них нет), и за секунду не ушло новых. */
async function idle(page: Page) {
  let last = -1;
  await expect.poll(async () => {
    const l = await log(page);
    const answered = new Set(l.filter((x) => x.ev === 'done' || x.ev === 'cancel').map((x) => x.id));
    const open = l.some((x) => x.ev === 'job' && !answered.has(x.id)) || (l.some((x) => x.id === BUSY) && !l.some((x) => x.ev === 'done' && x.id === BUSY));
    const quiet = l.length === last;
    last = l.length;
    return !open && quiet;
  }, { intervals: [1000], timeout: 40_000 }).toBe(true);
}

/** Занять воркер на несколько секунд: подробная карта слушателя рабочего проекта; интерфейс этого ответа не ждёт. */
async function busy(page: Page) {
  let project!: Project;
  await draftSaved(page, 'проект с волновой комнатой', (d) => { project = d; return d.id === 'prio'; });
  await page.evaluate(([id, p]) => {
    (window as unknown as { __worker: Worker }).__worker.postMessage({ id, type: 'listenerMap', payload: { room: p.room, sources: p.sources, constraints: p.constraints, setup: p.current, ppo: 48 } });
  }, [BUSY, project] as const);
}

/** Порядок задач после записи `from`: отправка и ответы по видам. */
async function order(page: Page, from: number) {
  const l = (await log(page)).slice(from);
  const type = (id: number) => (id === BUSY ? 'busy' : l.find((x) => x.ev === 'job' && x.id === id)?.type);
  return {
    posted: l.filter((x) => x.ev === 'job' && x.id !== BUSY).map((x) => x.type),
    done: l.filter((x) => x.ev === 'done').map((x) => type(x.id)),
    /** Ответ помехи пришёл после того, как ушли обе задачи: обе ждали в очереди. */
    busyUntilBoth: (() => {
      const at = (t: string) => l.findIndex((x) => x.ev === 'job' && x.id !== BUSY && x.type === t);
      const end = l.findIndex((x) => x.ev === 'done' && x.id === BUSY);
      return end > at('integrate') && end > at('listenerMap') && at('integrate') >= 0 && at('listenerMap') >= 0;
    })(),
  };
}
const pair = (types: (string | undefined)[]) => types.filter((t) => t === 'integrate' || t === 'listenerMap');

async function openSubSettings(page: Page) {
  await page.goto('/#manual');
  await expect(page.locator('[data-id="listener"]').first()).toBeVisible();
  await go(page, 'tuning/sub');
  await page.getByText('Настройки вручную').click();
  await idle(page);
}

test.beforeEach(async ({ page }) => { await prepare(page); });

test('пока воркер занят, «Подобрать настройки» видимой «Настройки» считается раньше карты скрытого «Вручную»', async ({ page }) => {
  await openSubSettings(page);
  const from = (await log(page)).length;
  await busy(page);
  await page.locator('#sub1-g').fill('2');
  await expect.poll(async () => (await order(page, from)).posted).toContain('listenerMap');
  await page.getByRole('button', { name: 'Подобрать настройки' }).click();
  await expect(page.locator('.tuning-result')).toBeVisible({ timeout: 30_000 });
  await idle(page);
  const o = await order(page, from);
  expect(pair(o.posted)).toEqual(['listenerMap', 'integrate']);
  expect(o.busyUntilBoth).toBe(true);
  expect(pair(o.done)).toEqual(['integrate', 'listenerMap']);
});

test('при возврате на «Расстановку» её карта считается раньше задачи ставшей скрытой «Настройки»', async ({ page }) => {
  await openSubSettings(page);
  const from = (await log(page)).length;
  await busy(page);
  await page.locator('#sub1-g').fill('2');
  await page.getByRole('button', { name: 'Подобрать настройки' }).click();
  await expect.poll(async () => (await order(page, from)).posted).toContain('integrate');
  await go(page, 'manual');
  await expect.poll(async () => (await order(page, from)).posted).toContain('listenerMap');
  await idle(page);
  const o = await order(page, from);
  expect(pair(o.posted)).toEqual(['integrate', 'listenerMap']);
  expect(o.busyUntilBoth).toBe(true);
  expect(pair(o.done)).toEqual(['listenerMap', 'integrate']);
});
