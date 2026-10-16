import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const directory = resolve('data/vision');
const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const expected = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(directory, {recursive: true, mode: 0o700});
let model;
try {model = await readFile(resolve(directory, 'hand_landmarker.task'));} catch {}
if (!model || digest(model) !== expected) {
  const response = await fetch(url, {signal: AbortSignal.timeout(90000)});
  if (!response.ok) throw new Error('Não foi possível baixar o modelo oficial de mãos.');
  model = Buffer.from(await response.arrayBuffer());
  if (digest(model) !== expected) throw new Error('O modelo recebido não corresponde à versão fixada.');
  await writeFile(resolve(directory, 'hand_landmarker.task.tmp'), model, {mode: 0o600});
  await rename(resolve(directory, 'hand_landmarker.task.tmp'), resolve(directory, 'hand_landmarker.task'));
}
// The pinned package's CommonJS build has no require imports. Wrap its exports
// in a local object so it can load in a classic Worker without eval or a CDN.
const pkg = JSON.parse(await readFile(resolve('node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'));
if (pkg.version !== '0.10.32') throw new Error('Versão inesperada do MediaPipe. Execute npm ci.');
const source = await readFile(resolve('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs'), 'utf8');
await writeFile(resolve(directory, 'vision_bundle.js'), '(function(exports){\n' + source.replace(/\/\/# sourceMappingURL=.*$/, '') + '\n})(self.CasaMediaPipe = {});\n', {mode: 0o600});
console.log('Modelo de mãos preparado para processamento local.');
