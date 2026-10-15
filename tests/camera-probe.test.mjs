import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../static/echo-camera.js', import.meta.url), 'utf8');
const context = {setTimeout, clearTimeout};
vm.runInNewContext(code, context);

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {resolve = a; reject = b;});
  return {promise, resolve, reject};
}
function fixtures(media, options = {}) {
  const events = new EventTarget(), reports = [];
  const video = {
    srcObject: null, readyState: 0, videoWidth: 0, videoHeight: 0,
    pause() {}, play: () => Promise.resolve(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events)
  };
  const probe = context.CasaCameraProbe.create({video, mediaDevices: media,
    secureContext: true, onChange: r => reports.push(r), frameTimeout: 25, ...options});
  return {probe, video, reports, events};
}
function streamFixture() {
  const track = new EventTarget();
  track.readyState = 'live';
  track.stops = 0;
  track.stop = () => {track.stops++; track.readyState = 'ended';};
  return {track, stream: {getTracks: () => [track], getVideoTracks: () => [track]}};
}

test('capture requires explicit start and requests video without audio', async () => {
  const pending = deferred();
  let calls = 0, constraints;
  const {probe, reports} = fixtures({getUserMedia: c => {calls++; constraints = c; return pending.promise;}});
  assert.equal(calls, 0);
  const attempt = probe.start();
  assert.equal(calls, 1);
  assert.equal(constraints.audio, false);
  assert.equal(reports.at(-1).phase, 'requesting');
  pending.reject({name: 'NotAllowedError', message: 'private-system-text'});
  await attempt;
  assert.equal(reports.at(-1).code, 'NotAllowedError');
  assert.ok(!reports.some(r => r.phase === 'ready'));
  assert.ok(!JSON.stringify(reports).includes('private-system-text'));
});
test('a late permission grant after stop releases the camera and never previews it', async () => {
  const pending = deferred(), {stream, track} = streamFixture();
  const {probe, video, reports} = fixtures({getUserMedia: () => pending.promise});
  const attempt = probe.start();
  probe.stop();
  pending.resolve(stream);
  await attempt;
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(reports.at(-1).phase, 'stopped');
  assert.ok(!reports.some(r => r.phase === 'ready'));
});
test('a stream without decoded frames times out instead of reporting success', async () => {
  const {stream, track} = streamFixture();
  const {probe, reports, video} = fixtures({getUserMedia: async () => stream});
  await probe.start();
  assert.equal(reports.at(-1).code, 'NoFrames');
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.ok(!reports.some(r => r.phase === 'ready'));
});
test('video is confirmed only with image dimensions and a live track, then stopped', async () => {
  const {stream, track} = streamFixture();
  const {probe, video, reports, events} = fixtures({getUserMedia: async () => stream});
  const attempt = probe.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reports.at(-1).phase, 'waiting');
  Object.assign(video, {readyState: 2, videoWidth: 640, videoHeight: 480});
  events.dispatchEvent(new Event('loadeddata'));
  await attempt;
  assert.equal(reports.at(-1).phase, 'ready');
  assert.equal(reports.at(-1).width, 640);
  assert.equal(reports.at(-1).height, 480);
  probe.stop();
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(reports.at(-1).phase, 'stopped');
});
test('stopping during preview cancels the wait without a later timeout overwriting state', async () => {
  const {stream, track} = streamFixture();
  const {probe, reports} = fixtures({getUserMedia: async () => stream});
  const attempt = probe.start();
  await new Promise(resolve => setImmediate(resolve));
  probe.stop();
  await attempt;
  assert.equal(track.stops, 1);
  assert.equal(reports.at(-1).phase, 'stopped');
  assert.ok(!reports.some(r => r.code === 'NoFrames'));
});
test('insecure context and missing API never attempt to request media', async () => {
  let calls = 0;
  const insecure = fixtures({getUserMedia: () => {calls++;}}, {secureContext: false});
  await insecure.probe.start();
  assert.equal(insecure.probe.report().code, 'InsecureContext');
  assert.equal(calls, 0);
  const absent = fixtures(undefined);
  await absent.probe.start();
  assert.equal(absent.probe.report().code, 'NoCameraAPI');
});
test('system termination removes the live image and reports a stopped stream', async () => {
  const {stream, track} = streamFixture();
  const {probe, video, reports, events} = fixtures({getUserMedia: async () => stream});
  const attempt = probe.start();
  await new Promise(resolve => setImmediate(resolve));
  Object.assign(video, {readyState: 2, videoWidth: 640, videoHeight: 480});
  events.dispatchEvent(new Event('playing'));
  await attempt;
  track.dispatchEvent(new Event('ended'));
  assert.equal(video.srcObject, null);
  assert.equal(reports.at(-1).code, 'StreamEnded');
});
