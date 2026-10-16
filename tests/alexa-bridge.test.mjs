import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {EventEmitter} from 'node:events';
import {AlexaLogin} from '../bridge/alexa-login.mjs';
import {AlexaCloud, MultipartDirectives, liveViewEvent, eventBody} from '../bridge/alexa-cloud.mjs';
import {createAlexaBridge} from '../bridge/alexa-bridge.mjs';

test('manual login stays in memory by default and never includes credentials in status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'casa-alexa-'));
  let callback, options;
  const library = {generateAlexaCookie(o, cb) {options = o; callback = cb;}, stopProxyServer() {}};
  const login = new AlexaLogin({directory: dir, library});
  try {
    await login.begin();
    assert.equal(options.proxyListenBind, '127.0.0.1'); assert.equal(options.proxyOnly, true);
    callback(new Error('Please open http://127.0.0.1:8878/ with your browser'));
    assert.equal(login.status().phase, 'awaiting_login');
    await callback(null, {accessToken: 'private-access', refreshToken: 'private-refresh', localCookie: 'private-cookie'});
    assert.equal(login.status().authenticated, true);
    assert.ok(!JSON.stringify(login.status()).includes('private-'));
    await assert.rejects(readFile(join(dir, 'registration.json')));
    login.close(); assert.equal(login.status().authenticated, false);
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('persistent login is opt-in and stored with owner-only permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'casa-alexa-')); let callback;
  const login = new AlexaLogin({directory: dir, library: {generateAlexaCookie(o, cb) {callback = cb;}, stopProxyServer() {}}});
  try {
    await login.begin({remember: true});
    await callback(null, {accessToken: 'test-access', refreshToken: 'test-refresh'});
    assert.equal((await stat(join(dir, 'registration.json'))).mode & 0o777, 0o600);
  } finally {login.close(); await rm(dir, {recursive: true, force: true});}
});

test('a delayed login callback after closing cannot resurrect the session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'casa-alexa-')); let callback;
  const login = new AlexaLogin({directory: dir, library: {generateAlexaCookie(o, cb) {callback = cb;}, stopProxyServer() {}}});
  try {await login.begin(); login.close(); await callback(null, {accessToken: 'late', refreshToken: 'late'}); assert.equal(login.status().authenticated, false);}
  finally {await rm(dir, {recursive: true, force: true});}
});

test('multipart directives survive every single-byte boundary and UTF-8 split', () => {
  const results = [], boundary = 'Amazon:boundary_123';
  const source = Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({directive: {header: {namespace: 'Test', name: 'Sessão'}, payload: {nested: '{not-a-boundary}'}}}) + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\nbinary\r\n--' + boundary + '--\r\n');
  const parser = new MultipartDirectives(`multipart/mixed; boundary="${boundary}"`, value => results.push(value));
  for (let i = 0; i < source.length; i++) parser.write(source.subarray(i, i + 1));
  assert.equal(results.length, 1); assert.equal(results[0].directive.header.name, 'Sessão'); assert.equal(parser.ended, true);
});

test('multipart rejects invalid or oversized input without treating it as video', () => {
  assert.throws(() => new MultipartDirectives('text/html', () => {}));
  const parser = new MultipartDirectives('multipart/mixed; boundary=x', () => {}, 64);
  assert.throws(() => parser.write(Buffer.alloc(65)), /limite/);
});

test('LiveView requests use the observed endpoint/payload contract without a fabricated payloadVersion', () => {
  let i = 0;
  const event = liveViewEvent('amzn1.alexa.endpoint.some-camera', new Date('2026-10-16T03:00:00Z'), () => 'id-' + (++i));
  assert.equal(event.payload.deviceRequestStartTime, '2026-10-16T03:00:00.000Z');
  assert.equal(event.payload.sessionType, 'SINGLEVIEW'); assert.equal(event.payload.requestId, 'id-2');
  assert.equal(event.header.payloadVersion, undefined); assert.equal(event.payload.sessionId, undefined);
  assert.throws(() => liveViewEvent('serial-number'));
  const metadata = JSON.parse(eventBody(event, 'test-boundary').body.toString().split('\r\n\r\n')[1].split('\r\n--')[0]);
  assert.deepEqual(metadata.event, event);
});

test('discovery never exposes account tokens or raw device serials in the public model', async () => {
  const login = {registration: {localCookie: 'private-cookie', csrf: 'private-csrf', amazonPage: 'amazon.com.br'}};
  const cloud = new AlexaCloud(login, {fetchImpl: async (url) => new Response(JSON.stringify(url.includes('graphql') ? {data: {endpoints: {items: [{id: 'row-id', endpointId: 'amzn1.alexa.endpoint.test-camera', friendlyName: 'Echo Show', displayCategories: {primary: {value: 'CAMERA'}}, legacyIdentifiers: {dmsIdentifier: {deviceSerialNumber: {value: {text: 'private-serial'}}}}, legacyAppliance: {manufacturerName: 'Amazon'}}]}}} : {devices: [{deviceSerialNumber: 'private-serial'}]}))});
  const result = await cloud.discover(); assert.equal(result.devices.length, 1);
  assert.ok(!JSON.stringify(cloud.status()).includes('private-'));
  assert.ok(!JSON.stringify(cloud.status()).includes('amzn1.alexa.endpoint.test-camera'));
  assert.equal(cloud.status().video.frames, 0);
});

test('discovery refuses unsupported markets before transmitting cookies', async () => {
  let calls = 0;
  const cloud = new AlexaCloud({registration: {localCookie: 'private-cookie', amazonPage: 'attacker.invalid'}}, {fetchImpl: () => {calls++;}});
  await assert.rejects(cloud.discover()); assert.equal(calls, 0);
});

test('HTTP control endpoints reject cross-origin changes and arbitrary Host headers', async () => {
  let starts = 0;
  const login = {status: () => ({phase: 'disconnected'}), begin: async () => {starts++; return {};}, restore() {}, close() {}};
  const cloud = {status: () => ({video: {frames: 0}}), stop() {}};
  const bridge = createAlexaBridge({port: 0, login, cloud, restore: false});
  const url = await bridge.start();
  try {
    const wrongOrigin = await fetch(url + 'api/login', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://other.invalid'}, body: '{}'});
    assert.equal(wrongOrigin.status, 403); assert.equal(starts, 0);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(url + 'api/status', {headers: {Host: 'other.invalid'}}, res => {res.resume(); resolve(res.statusCode);});
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    const okay = await fetch(url + 'api/login', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: url.slice(0, -1)}, body: '{}'});
    assert.equal(okay.status, 200); assert.equal(starts, 1);
  } finally {await bridge.close();}
});

function transport(status = 200) {
  const client = new EventEmitter(), streams = [];
  client.destroy = () => {client.destroyed = true;};
  client.request = headers => {
    const stream = new EventEmitter(); streams.push(stream);
    stream.close = () => stream.emit('close'); stream.end = () => {};
    queueMicrotask(() => stream.emit('response', {':status': status, 'content-type': 'multipart/mixed; boundary=test'}));
    return stream;
  };
  const cloud = new AlexaCloud({registration: {}}, {connectImpl() {queueMicrotask(() => client.emit('connect')); return client;}});
  cloud.accessToken = async () => 'test-only-token';
  cloud.prepareViewer = async () => {};
  return {cloud, client, streams};
}

test('HTTP 200 and a LiveView session never count as a received image', async () => {
  const {cloud, streams} = transport();
  try {
    await cloud.openChannel();
    streams[0].emit('data', Buffer.from('--test\r\nContent-Type: application/json\r\n\r\n{"directive":{"header":{"namespace":"Alexa.Camera.LiveViewController","name":"StartLiveView"},"payload":{"sessionId":"private-session"}}}\r\n--test--\r\n'));
    assert.equal(cloud.status().channel.phase, 'ready');
    assert.equal(cloud.status().video.phase, 'session_received');
    assert.equal(cloud.status().video.frames, 0);
    assert.ok(!JSON.stringify(cloud.status()).includes('private-session'));
  } finally {cloud.stop();}
});

test('an authorization rejection fails the channel and releases the transport', async () => {
  const {cloud, client} = transport(403);
  await assert.rejects(cloud.openChannel(), /HTTP 403/);
  assert.equal(cloud.status().channel.phase, 'failed'); assert.equal(client.destroyed, true);
  assert.equal(cloud.status().video.frames, 0);
});

test('canceling while a token is pending prevents a late network connection', async () => {
  let finishToken, tokenStarted, connections = 0;
  const started = new Promise(resolve => {tokenStarted = resolve;});
  const cloud = new AlexaCloud({}, {connectImpl() {connections++;}});
  cloud.prepareViewer = async () => {};
  cloud.accessToken = () => new Promise(resolve => {finishToken = resolve; tokenStarted();});
  const opening = cloud.openChannel(); await started; cloud.stop(); finishToken('test-token');
  await assert.rejects(opening, /cancelada/);
  assert.equal(connections, 0); assert.equal(cloud.channel.phase, 'disconnected');
});

test('a failed token exchange is shown as failed rather than connecting forever', async () => {
  const {cloud} = transport(); cloud.accessToken = async () => {throw new Error('Test rejected');};
  await assert.rejects(cloud.openChannel(), /Test rejected/); assert.equal(cloud.channel.phase, 'failed');
});

test('stop requests use the received session and close locally even if Amazon rejects them', async () => {
  const {cloud, client} = transport(); await cloud.openChannel();
  cloud.onJSON({directive: {header: {namespace: 'Alexa.Camera.LiveViewController', name: 'StartLiveView'}, payload: {sessionId: 'test-session'}}});
  let event;
  cloud.sendEvent = async value => {event = value; throw new Error('Test stop failure');};
  await assert.rejects(cloud.stopCamera(), /Test stop failure/);
  assert.equal(event.header.name, 'RequestStopLiveView'); assert.deepEqual(event.payload, {sessionId: 'test-session'});
  assert.equal(client.destroyed, true); assert.equal(cloud.channel.phase, 'disconnected');
  assert.equal(cloud.status().video.phase, 'disconnected'); assert.deepEqual(cloud.rawCameraDirectives, []);
});

test('viewer registration announces LiveView 2.2 before opening the camera channel', async () => {
  let manifest, authorization;
  const login = {registration: {accessToken: 'private-access'}};
  const cloud = new AlexaCloud(login, {fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.amazonalexa.com/v1/devices/@self/capabilities');
    manifest = JSON.parse(options.body); authorization = options.headers.authorization;
    return new Response(null, {status: 204});
  }});
  cloud.accessToken = async () => 'private-bearer';
  await cloud.prepareViewer();
  const liveView = manifest.capabilities.find(item => item.interface === 'Alexa.Camera.LiveViewController');
  assert.equal(liveView.version, '2.2');
  assert.deepEqual(liveView.configurations.supportedDisplayModes, ['FULL_SCREEN']);
  assert.equal(authorization, 'Bearer private-bearer');
  assert.ok(!JSON.stringify(cloud.status()).includes('private-'));
});

test('canceling token renewal prevents a delayed capability publication', async () => {
  let finishToken, calls = 0;
  const cloud = new AlexaCloud({registration: {}}, {fetchImpl() {calls++;}});
  cloud.accessToken = () => new Promise(resolve => {finishToken = resolve;});
  const registration = cloud.prepareViewer(); cloud.stop(); finishToken('test-token');
  await assert.rejects(registration, /cancelada/); assert.equal(calls, 0);
});

test('RTC signaling forwards only session directives and never LiveView encryption keys', async () => {
  const cloud = new AlexaCloud({});
  cloud.onJSON({directive: {header: {namespace: 'Alexa.RTCSessionController', name: 'InitiateSession', correlationToken: 'private-correlation'}, payload: {sessionId: 'test-session', sessionDomain: 'test-domain', iceServers: []}}});
  cloud.onJSON({directive: {header: {namespace: 'Alexa.Camera.LiveViewController', name: 'StartLiveView', keys: 'private-keys'}, payload: {sessionId: 'test-session'}}});
  assert.equal(cloud.signaling().signals.length, 1);
  assert.equal(cloud.signaling(1).signals.length, 0);
  assert.throws(() => cloud.signaling(-1));
  assert.ok(!JSON.stringify(cloud.signaling()).includes('private-'));
  const events = []; cloud.sendEvent = async event => {events.push(event); return {httpStatus: 200};};
  await assert.rejects(cloud.offer('unrecognized-session', 'v=0\r\nm=video test\r\n'), /indisponível/);
  await assert.rejects(cloud.offer('test-session', 'not SDP'), /inválida/);
  await cloud.offer('test-session', 'v=0\r\nm=video test\r\n');
  assert.equal(events[0].header.correlationToken, 'private-correlation');
  assert.equal(events[0].header.payloadVersion, '3.1');
  assert.equal(events[0].payload.offer.format, 'SDP');
  assert.ok(!JSON.stringify(cloud.status()).includes('private-'));
});

test('frame telemetry requires a real known session, positive dimensions and increasing frames', () => {
  const cloud = new AlexaCloud({});
  const frame = {sessionId: 'test-session', frames: 1, width: 1280, height: 720};
  assert.throws(() => cloud.reportFrames(frame), /indisponível/);
  cloud.rtcSessions.set('test-session', {}); cloud.lastLiveView = {sessionId: 'test-session', phase: 'session_received'};
  assert.throws(() => cloud.reportFrames({...frame, width: 0}), /inválido/);
  assert.equal(cloud.reportFrames(frame).phase, 'streaming');
  assert.throws(() => cloud.reportFrames(frame), /inválido/);
  cloud.onJSON({directive: {header: {namespace: 'Alexa.Camera.LiveViewController', name: 'StopLiveView'}, payload: {sessionId: 'previous-session'}}});
  assert.equal(cloud.status().video.phase, 'streaming');
  cloud.onJSON({directive: {header: {namespace: 'Alexa.Camera.LiveViewController', name: 'StopLiveView'}, payload: {sessionId: 'test-session'}}});
  assert.equal(cloud.status().video.phase, 'ended'); assert.equal(cloud.status().video.frames, 0);
});

test('Amazon event errors expose the error code without leaking response descriptions', async () => {
  const {cloud, client} = transport(); await cloud.openChannel();
  client.request = () => {
    const stream = new EventEmitter(); stream.close = () => {};
    stream.end = () => queueMicrotask(() => {
      stream.emit('response', {':status': 500, 'content-type': 'application/json'});
      stream.emit('data', Buffer.from(JSON.stringify({payload: {code: 'INTERNAL_SERVICE_EXCEPTION', description: 'private-diagnostic'}})));
      stream.emit('end');
    });
    return stream;
  };
  try {
    await assert.rejects(cloud.sendEvent(liveViewEvent('amzn1.alexa.endpoint.test')), /HTTP 500/);
    assert.equal(cloud.status().lastEvent.errorCode, 'INTERNAL_SERVICE_EXCEPTION');
    assert.ok(!JSON.stringify(cloud.status()).includes('private-diagnostic'));
  } finally {cloud.stop();}
});

test('late event responses after stopping cannot resurrect a camera session', async () => {
  const {cloud, client} = transport(); await cloud.openChannel();
  let stream, sent;
  const started = new Promise(resolve => {sent = resolve;});
  client.request = () => {
    stream = new EventEmitter(); stream.close = () => stream.emit('close'); stream.end = () => sent(); return stream;
  };
  cloud.targets.set('camera', {endpoint: 'amzn1.alexa.endpoint.test'});
  const opening = cloud.startCamera('camera'); await started;
  await cloud.stopCamera();
  stream.emit('response', {':status': 200, 'content-type': 'multipart/mixed; boundary=test'});
  stream.emit('data', Buffer.from('--test\r\nContent-Type: application/json\r\n\r\n{"directive":{"header":{"namespace":"Alexa.Camera.LiveViewController","name":"StartLiveView"},"payload":{"sessionId":"late-session"}}}\r\n--test--\r\n'));
  stream.emit('end'); await assert.rejects(opening, /cancelada/);
  assert.equal(cloud.status().video.phase, 'disconnected'); assert.equal(cloud.rtcSessions.size, 0);
});
