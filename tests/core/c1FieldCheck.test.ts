import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseMicFile } from '../../src/core/micCurve';
import { NoiseMeter, FFT_SIZE } from '../../src/core/noise';
import type { MicProfile } from '../../src/core/micCalibration';
import { builtinProfiles } from '../../src/core/micBuiltins';
import { SPECTRUM_SIZE } from '../../src/core/noiseSpectrum';

it('field kit: real TXT and WAV yield the expected raw/corrected PSD and integral without installing a profile', () => {
  const { f, db } = parseMicFile(readFileSync('public/field-check/c1-correction.txt','utf8'));
  expect(f).toEqual([20,40,63,100,250,500,1000,2000,4000,8000,16000,20000]);
  expect(db).toEqual([6,6,6,6,3,0,0,-3,-6,-6,0,0]);
  expect(() => parseMicFile(readFileSync('public/field-check/c1-invalid-duplicate.txt','utf8'))).toThrow();
  expect(builtinProfiles.some(p => p.name === 'C1 TEST')).toBe(false);
  const profile: MicProfile = { id:'field-test', name:'C1 TEST', version:1, origin:'user', deviceModel:'test',
    inputKind:'unknown', captureMode:'test', orientation:null, sourceURL:null, sourceDate:null, method:'fixture',
    referenceHz:1000, validRangeHz:[20,20000], digitizationUncertaintyDb:null, validationStatus:'unverified',
    notes:'', directivitySource:null, curve:{kind:'correction',frequencyHz:f,correctionDb:db} };
  const wav = readFileSync('public/field-check/c1-tones.wav');
  const rate = wav.readUInt32LE(24);
  expect([wav.toString('ascii',36,40), wav.readUInt16LE(22), rate, wav.readUInt16LE(34), wav.length - 44])
    .toEqual(['data',1,24000,16,720000]);
  const meter = new NoiseMeter(rate,profile);
  for (let off = 44, seq = 0; off + 2 * FFT_SIZE <= wav.length; off += 2 * FFT_SIZE, seq++)
    meter.push(Float32Array.from({length:FFT_SIZE}, (_,i) => wav.readInt16LE(off+2*i)/32768),seq);
  const {binHz} = meter.spectral;
  const raw = meter.spectral.average('session','Z'), corrected = meter.spectral.average('session','Z',true);
  const meta = {period:'session',weight:'Z'};
  const output = {schema:3,path:{sampleRate:rate},measurement:meter.snapshot(),
    spectralAnalysis:{...meta,binHz,fftSize:SPECTRUM_SIZE,validSpectralSeconds:raw.seconds,psd:Array.from(raw.density)},
    calibration:{profile,maxBoostDb:12,correctedSpectrum:{...meta,seconds:corrected.seconds,psd:Array.from(corrected.density),
      meanSquare:corrected.density.reduce((sum,v) => sum + v,0)*binHz}}};
  const run = () => spawnSync(process.execPath,['scripts/check-c1-session.mjs','-'],{input:JSON.stringify(output),encoding:'utf8'});
  const result = run();
  expect(result.status,result.stderr).toBe(0);
  output.calibration.correctedSpectrum.meanSquare *= 2;
  expect(run().status).toBe(1);
  output.calibration.correctedSpectrum.meanSquare /= 2;
  output.calibration.correctedSpectrum.psd[Math.round(6000/binHz)] *= 2;
  expect(run().status).toBe(1);
});
