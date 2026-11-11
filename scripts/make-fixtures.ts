// Генерирует синтетические сканы для ручной проверки: npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeRoomScan, toOBJ, toSTL } from '../tests/fixtures/synthetic';

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
console.log('Готово:', `${out}/sample-room.obj`, `${out}/sample-room-cm.stl`);
