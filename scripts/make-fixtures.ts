// Генерирует синтетические сканы для ручной проверки: npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeRoomScan, toOBJ, toSTL } from '../tests/fixtures/synthetic';
import { BUILD, legacyExport, sessionRecord, testProfile, toneMeter } from '../tests/fixtures/noise';
import { exportRecord } from '../src/core/noiseFile';

const out = 'tests/fixtures/out';
mkdirSync(out, { recursive: true });
const room = makeRoomScan({ depth: 5, width: 4, height: 2.5, noise: 0.01, furniture: true, openings: true, rotationDeg: 25 });
writeFileSync(`${out}/sample-room.obj`, toOBJ(room));
const cm = makeRoomScan({ depth: 6.2, width: 3.8, height: 2.7, noise: 0.01, furniture: true, openings: true, units: 'cm', upAxis: 'z' });
writeFileSync(`${out}/sample-room-cm.stl`, Buffer.from(toSTL(cm)));
const cor = makeRoomScan({ depth: 5, width: 4, height: 2.5, noise: 0.01, furniture: true, corridor: true, rotationDeg: 10 });
writeFileSync(`${out}/sample-corridor.obj`, toOBJ(cor));
// 020: «комната» 70 × 60 м — распознаётся, но таких размеров не бывает: скан не применяется, открывается поправка
const hall = makeRoomScan({ depth: 70, width: 60, height: 3, noise: 0.01, furniture: false, openings: false });
writeFileSync(`${out}/sample-hall.obj`, toOBJ(hall));
// 022: без потолка и с нишей — распознаётся неуверенно (< 50 %): сначала открывается «Поправить границы»
const low = makeRoomScan({ depth: 5, width: 4, height: 2.5, noise: 0.01, ceiling: false, lShape: true });
writeFileSync(`${out}/sample-low.obj`, toOBJ(low));
// 056: синтетические измерения шумомера для импорта в историю — расширенный JSON schema 4 и прежний schema 3
writeFileSync(`${out}/noise-session-schema4.json`,
  exportRecord(sessionRecord(toneMeter({ seconds: 20, amp: 0.1 }), { id: 'sample-noise-48000', name: 'Тон 1 кГц, 48 кГц' }), BUILD));
writeFileSync(`${out}/noise-legacy-schema3.json`,
  JSON.stringify(legacyExport(toneMeter({ seconds: 20, amp: 0.05, profile: testProfile }), 'A', 'session', 'Тон 1 кГц, schema 3')));
console.log('Готово:', `${out}/sample-room.obj`, `${out}/sample-room-cm.stl`);
