import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../static/gesture-engine.js', import.meta.url), 'utf8'), context);
const create = options => context.CasaGestureEngine.create({dwellMs: 100, cooldownMs: 200,
  frameTimeoutMs: 300, curtainIntervalMs: 100, ...options});
const plain = value => JSON.parse(JSON.stringify(value));
const obs = (timestamp, extra = {}) => ({timestamp, present: true, targetId: 'device', x: .5, y: .5, ...extra});
const arm = (engine, type = 'switch', position = 50) => engine.arm({id: 'device', type, position}, 0);

test('default disarmed, explicit target whitelist, finite inputs', () => {
  const engine = create();
  assert.deepEqual(plain(engine.sample(obs(0))), []);
  assert.equal(engine.report().armed, false);
  assert.throws(() => engine.arm({id: 'lock', type: 'lock'}, 0));
  assert.throws(() => engine.arm({id: 'x', type: 'curtain'}, 0));
  assert.throws(() => create({cooldownMs: NaN}));
  arm(engine);
  engine.sample(obs(0));
  engine.sample(obs(100, {x: Infinity}));
  assert.equal(engine.report().armed, false);
});

test('switch requires dwell and a new confirmation, fires once per explicit arming', () => {
  const engine = create(); arm(engine);
  assert.deepEqual(plain(engine.sample(obs(0, {confirm: true}))), []);
  assert.deepEqual(plain(engine.sample(obs(100, {confirm: true}))), []);
  engine.sample(obs(110, {confirm: false}));
  assert.equal(engine.sample(obs(120, {confirm: true}))[0].type, 'activate');
  engine.sample(obs(200, {confirm: false}));
  assert.deepEqual(plain(engine.sample(obs(350, {confirm: true}))), []);
  engine.arm({id: 'device', type: 'switch'}, 400);
  engine.sample(obs(400));
  assert.equal(engine.sample(obs(500, {confirm: true}))[0].type, 'activate');
});

test('hand loss, stale frames and target loss disarm, and do not repeat actions', () => {
  for (const lost of [obs(120, {present: false}), obs(120, {targetId: 'other'})]) {
    const engine = create(); arm(engine); engine.sample(obs(0));
    engine.sample(lost);
    assert.equal(engine.report().armed, false);
    assert.deepEqual(plain(engine.sample(obs(130, {confirm: true}))), []);
  }
  const engine = create(); arm(engine); engine.sample(obs(0));
  engine.tick(301);
  assert.equal(engine.report().reason, 'stale-frame');
  const delayed = create(); arm(delayed);
  delayed.sample(obs(0), 301);
  assert.equal(delayed.report().armed, false);
});

test('duplicate and out-of-order observations cannot create confirmation edges', () => {
  const engine = create(); arm(engine); engine.sample(obs(0));
  engine.sample(obs(100));
  assert.deepEqual(plain(engine.sample(obs(90, {confirm: true}), 101)), []);
  assert.deepEqual(plain(engine.sample(obs(100, {confirm: true}), 102)), []);
  assert.equal(engine.sample(obs(110, {confirm: true}))[0].type, 'activate');
});

test('projector recognizes four swipe directions and cooldown suppresses repeats', () => {
  for (const [x, y, key] of [[.8, .5, 'right'], [.2, .5, 'left'], [.5, .2, 'up'], [.5, .8, 'down']]) {
    const engine = create(); arm(engine, 'projector');
    engine.sample(obs(0)); engine.sample(obs(100));
    assert.equal(engine.sample(obs(120, {x, y}))[0].key, key);
    engine.sample(obs(130));
    assert.deepEqual(plain(engine.sample(obs(150, {x, y}))), []);
  }
});

test('projector OK is edge-triggered and shares cooldown with navigation', () => {
  const engine = create(); arm(engine, 'projector'); engine.sample(obs(0));
  assert.equal(engine.sample(obs(100, {confirm: true}))[0].key, 'ok');
  assert.deepEqual(plain(engine.sample(obs(110, {confirm: true}))), []);
  engine.sample(obs(120, {confirm: false}));
  assert.deepEqual(plain(engine.sample(obs(140, {confirm: true}))), []);
  engine.sample(obs(300, {confirm: false}));
  assert.equal(engine.sample(obs(310, {confirm: true}))[0].key, 'ok');
});

test('curtain coalesces proposals, clips to percent, emits stop exactly once on hand loss', () => {
  const engine = create(); arm(engine, 'curtain', 80);
  engine.sample(obs(0)); engine.sample(obs(100, {drag: true, y: .8}));
  let result = engine.sample(obs(110, {drag: true, y: .7}));
  assert.equal(result[0].position, 90);
  assert.equal(result[0].proposed, true);
  assert.deepEqual(plain(engine.sample(obs(120, {drag: true, y: .6}))), []);
  assert.deepEqual(plain(engine.sample(obs(150, {drag: true, y: .2}))), []);
  assert.equal(engine.tick(210)[0].position, 100);
  result = engine.sample(obs(220, {present: false}));
  assert.equal(result[0].type, 'curtain-stop');
  assert.deepEqual(plain(engine.tick(600)), []);
  assert.equal(engine.report().armed, false);
});

test('curtain release cancels pending percent and timeout emits stop then disarms', () => {
  const engine = create(); arm(engine, 'curtain', 10);
  engine.sample(obs(0)); engine.sample(obs(100, {drag: true, y: .2}));
  assert.equal(engine.sample(obs(110, {drag: true, y: .8}))[0].position, 0);
  engine.sample(obs(120, {drag: true, y: .1}));
  assert.equal(engine.sample(obs(130))[0].type, 'curtain-stop');
  assert.deepEqual(plain(engine.tick(200)), []);
  engine.sample(obs(240)); engine.sample(obs(350, {drag: true}));
  assert.equal(engine.tick(651)[0].type, 'curtain-stop');
  assert.equal(engine.report().armed, false);
});

test('explicit disarm and selecting another target stop an active curtain', () => {
  const engine = create(); arm(engine, 'curtain'); engine.sample(obs(0));
  engine.sample(obs(100, {drag: true}));
  assert.equal(engine.disarm(110)[0].type, 'curtain-stop');
  assert.deepEqual(plain(engine.disarm(120)), []);
  engine.arm({id: 'device', type: 'curtain', position: 50}, 130);
  engine.sample(obs(130)); engine.sample(obs(230, {drag: true}));
  assert.equal(engine.arm({id: 'projector', type: 'projector'}, 240)[0].targetId, 'device');
});
