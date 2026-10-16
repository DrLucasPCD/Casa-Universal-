import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../static/alexa-webrtc.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({deferred = false, keyExchange = 'DTLS'} = {}) {
  const requests = [], peers = [], windowEvents = {}, documentEvents = {}, callbacks = new Map();
  let release, callbackId = 0;
  const signals = [{sequence: 1, name: 'InitiateSession', payload: {sessionId: 'test-session', keyExchange, trickleICE: false, iceServers: [], mediaStreams: {data: [{label: '1'}]}}},
    {sequence: 2, name: 'StartPeerConnection', payload: {sessionId: 'test-session', answer: {format: 'SDP', value: 'test-answer'}, isProvisional: false}}];
  const video = {readyState: 0, videoWidth: 0, videoHeight: 0, srcObject: null, muted: false,
    play: async () => {}, requestVideoFrameCallback(fn) {callbacks.set(++callbackId, fn); return callbackId;}, cancelVideoFrameCallback(id) {callbacks.delete(id);}};
  const message = {textContent: ''};
  class Peer {
    constructor() {peers.push(this); this.iceGatheringState = 'complete'; this.transceivers = [];}
    addTransceiver(kind, options) {this.transceivers.push({kind, ...options});}
    createDataChannel() {}
    async createOffer() {return {type: 'offer', sdp: 'v=0\r\nm=video test\r\n'};}
    async setLocalDescription(value) {this.localDescription = value;}
    async setRemoteDescription(value) {this.remoteDescription = value;}
    close() {this.closed = true;}
  }
  const document = {hidden: false, addEventListener(name, fn) {documentEvents[name] = fn;}};
  const context = {window: {}, document, RTCPeerConnection: Peer, MediaStream: class {
    constructor(tracks) {this.tracks = tracks;} getTracks() {return this.tracks;} getVideoTracks() {return this.tracks.filter(t => t.kind === 'video');}
  }, addEventListener(name, fn) {windowEvents[name] = fn;}, setTimeout() {return 1;}, clearTimeout() {},
    fetch: async (path, options) => {
      requests.push({path, body: options?.body ? JSON.parse(options.body) : null});
      if (path.startsWith('/api/rtc?')) {
        if (deferred) return new Promise(resolve => {release = () => resolve({ok: true, json: async () => ({signals})});});
        return {ok: true, json: async () => ({signals})};
      }
      return {ok: true, json: async () => ({})};
    }};
  vm.runInNewContext(source, context);
  const client = context.window.CasaAlexaRTC.create({video, message});
  const track = {kind: 'video', readyState: 'live', stop() {this.readyState = 'ended';}};
  return {client, peers, requests, video, message, document, windowEvents, documentEvents, track,
    release: () => release(), frame(now) {const [id, fn] = [...callbacks][0]; callbacks.delete(id); fn(now);}};
}

test('RTC connects without requesting local capture and does not count a connection as an image', async () => {
  const h = harness(); h.client.start(); await flush();
  assert.equal(h.peers.length, 1); assert.equal(h.peers[0].remoteDescription.type, 'answer');
  h.peers[0].connectionState = 'connected'; h.peers[0].onconnectionstatechange(); await flush();
  assert.ok(h.requests.some(r => r.path === '/api/rtc/connected'));
  assert.ok(!h.requests.some(r => r.path === '/api/rtc/frames'));
  assert.equal(h.peers[0].transceivers.find(t => t.kind === 'video').direction, 'recvonly');
  h.client.stop();
});

test('frame evidence requires a decoded image, dimensions and a live video track', async () => {
  const h = harness(); h.client.start(); await flush();
  h.peers[0].ontrack({track: h.track});
  h.video.videoWidth = 1280; h.video.videoHeight = 720; h.video.readyState = 1;
  h.frame(1000); await flush(); assert.ok(!h.requests.some(r => r.path === '/api/rtc/frames'));
  h.video.readyState = 4; h.frame(2000); await flush();
  const report = h.requests.find(r => r.path === '/api/rtc/frames').body;
  assert.deepEqual(report, {sessionId: 'test-session', frames: 1, width: 1280, height: 720});
  h.client.stop(); assert.equal(h.track.readyState, 'ended'); assert.equal(h.video.srcObject, null);
});

test('a late session after cancellation cannot create a peer connection', async () => {
  const h = harness({deferred: true}); h.client.start(); await flush();
  h.client.stop(); h.release(); await flush(); assert.equal(h.peers.length, 0);
});

test('leaving the tab releases the image and requests one session stop', async () => {
  const h = harness(); h.client.start(); await flush(); h.peers[0].ontrack({track: h.track});
  h.document.hidden = true; h.documentEvents.visibilitychange(); h.windowEvents.pagehide(); await flush();
  assert.equal(h.track.readyState, 'ended'); assert.equal(h.peers[0].closed, true);
  assert.equal(h.requests.filter(r => r.path === '/api/channel/stop').length, 1);
});

test('an unsupported key exchange stops without pretending to receive video', async () => {
  const h = harness({keyExchange: 'SDES'}); h.client.start(); await flush();
  assert.equal(h.peers.length, 0); assert.match(h.message.textContent, /não suportado/);
  assert.ok(!h.requests.some(r => r.path === '/api/rtc/frames'));
  assert.ok(h.requests.some(r => r.path === '/api/channel/stop'));
});
