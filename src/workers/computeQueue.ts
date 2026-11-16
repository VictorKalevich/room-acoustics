// Очередь воркера расчётов (035): какую задачу выполнить следующей. Без `self` и таймеров — проверяется без воркера.
// Начатую задачу очередь не держит и прервать её не может: приоритет помогает, только пока задача ещё ждёт.

/** Задача в очереди. `hidden` — её поставил скрытый раздел; без поля — видимый, как до 035. */
export interface Queued {
  id: number;
  hidden?: boolean;
}

export class ComputeQueue<T extends Queued> {
  /** В порядке поступления; смена приоритета место задачи не меняет. */
  private readonly jobs: T[] = [];

  get size(): number { return this.jobs.length; }

  push(job: T): void {
    this.jobs.push(job);
  }

  /** Следующая задача: первая по поступлению из видимых разделов, если таких нет — первая из скрытых. */
  take(): T | undefined {
    const i = this.jobs.findIndex((j) => !j.hidden);
    return this.jobs.splice(i >= 0 ? i : 0, 1)[0];
  }

  /** Снять задачу, которая ещё ждёт; начатую, завершённую и неизвестную — нечего снимать. */
  cancel(id: number): void {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i >= 0) this.jobs.splice(i, 1);
  }

  /** Раздел задачи стал скрытым или видимым. */
  setHidden(id: number, hidden: boolean): void {
    const job = this.jobs.find((j) => j.id === id);
    if (job) job.hidden = hidden;
  }
}
