// План работ комнаты (V2-044) в области `actionPlans`: одна запись на комнату, удаляется вместе с комнатой
// и входит в резервную копию.
import type { ActionPlan } from '../domain/advice';
import { req, type V2Db } from './db';

export const planId = (roomId: string) => `plan-${roomId}`;

export async function getPlan(db: V2Db, roomId: string): Promise<ActionPlan> {
  const p = (await db.run('actionPlans', 'readonly', (tx) => req(tx.objectStore('actionPlans').get(planId(roomId))))) as ActionPlan | undefined;
  return p && Array.isArray(p.items) ? p : { id: planId(roomId), roomId, updatedAt: '', items: [] };
}

export async function putPlan(db: V2Db, plan: ActionPlan): Promise<void> {
  await db.run('actionPlans', 'readwrite', (tx) => req(tx.objectStore('actionPlans').put(JSON.parse(JSON.stringify(plan)))));
}
