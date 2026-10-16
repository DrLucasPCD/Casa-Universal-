(function (root) {
  'use strict';

  // Pure intention generator. It never accesses a camera, network or device.
  // A UI must select a calibrated target and explicitly arm it. All timestamps
  // use one monotonic millisecond clock. Coordinates are normalized to [0, 1].
  // sample({timestamp, present, targetId, x, y, confirm, drag}, now) and tick(now)
  // return intentions; consuming them does not imply a command was executed.
  function create(options = {}) {
    const defaults = {dwellMs: 650, cooldownMs: 700, frameTimeoutMs: 500,
      curtainIntervalMs: 250, curtainStep: 2, swipeDistance: 0.18, swipeWindowMs: 700};
    const config = {...defaults, ...options};
    Object.keys(defaults).forEach(key => {
      if (!Number.isFinite(config[key]) || config[key] <= 0) throw new TypeError('Invalid ' + key);
    });
    if (config.curtainStep > 100 || config.swipeDistance > 1) throw new RangeError('Invalid gesture range');
    const validTime = value => Number.isFinite(value) && value >= 0;
    const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
    const percent = value => Math.min(100, Math.max(0, Math.round(value)));
    let clock = -1, clockArmed = -1, lastFrame = null, target = null, armed = false, reason = 'not-armed';
    let dwellStart = null, previousConfirm = false, latched = false, lastAction = -Infinity;
    let anchor = null, dragStart = null, lastPosition = null, pendingPosition = null, lastPositionAt = -Infinity;

    function clearTracking() {
      dwellStart = null; previousConfirm = false; latched = false; anchor = null;
      dragStart = null; pendingPosition = null; lastPosition = target?.position ?? null;
      lastPositionAt = -Infinity;
    }
    function intent(type, timestamp, extra = {}) {
      return {type, targetId: target.id, timestamp, ...extra};
    }
    function stop(now, why, disarm) {
      const result = dragStart ? [intent('curtain-stop', now, {reason: why})] : [];
      clearTracking();
      if (disarm) { armed = false; reason = why; }
      return result;
    }
    function advance(now) {
      if (!validTime(now) || now < clock) return false;
      clock = now;
      return true;
    }
    function arm(selection, now) {
      if (!validTime(now) || now < clock) throw new TypeError('Invalid timestamp');
      if (!selection || typeof selection.id !== 'string' || !selection.id.trim() || selection.id.length > 160 ||
          !['switch', 'projector', 'curtain'].includes(selection.type)) throw new TypeError('Invalid target');
      if (selection.type === 'curtain' && (!Number.isFinite(selection.position) || selection.position < 0 || selection.position > 100)) {
        throw new TypeError('Curtain needs an observed starting position');
      }
      const result = stop(now, 'target-changed', false);
      clock = now; clockArmed = now; target = {id: selection.id, type: selection.type,
        ...(selection.type === 'curtain' ? {position: selection.position} : {})};
      armed = true; reason = 'armed'; lastFrame = null; lastAction = -Infinity;
      clearTracking();
      return result;
    }
    function disarm(now) {
      if (!advance(now)) return [];
      return stop(now, 'disarmed', true);
    }
    function flush(now) {
      if (pendingPosition === null || now - lastPositionAt < config.curtainIntervalMs) return [];
      const position = pendingPosition;
      pendingPosition = null; lastPosition = position; lastPositionAt = now;
      return [intent('curtain-position', now, {position, proposed: true})];
    }
    function tick(now) {
      if (!advance(now) || !armed) return [];
      if (lastFrame === null ? now - clockArmed > config.frameTimeoutMs : now - lastFrame > config.frameTimeoutMs) {
        return stop(now, 'stale-frame', true);
      }
      return dragStart ? flush(now) : [];
    }
    function sample(observation, now = observation?.timestamp) {
      if (!advance(now) || !armed) return [];
      if (!observation || !validTime(observation.timestamp) || observation.timestamp > now ||
          now - observation.timestamp > config.frameTimeoutMs) return stop(now, 'stale-frame', true);
      if (lastFrame !== null && observation.timestamp <= lastFrame) return [];
      if ((lastFrame !== null && observation.timestamp - lastFrame > config.frameTimeoutMs) ||
          (lastFrame === null && observation.timestamp - clockArmed > config.frameTimeoutMs)) return stop(now, 'stale-frame', true);
      lastFrame = observation.timestamp;
      if (observation.present !== true) return stop(now, 'hand-lost', true);
      if (!unit(observation.x) || !unit(observation.y) ||
          (observation.confirm !== undefined && typeof observation.confirm !== 'boolean') ||
          (observation.drag !== undefined && typeof observation.drag !== 'boolean')) return stop(now, 'invalid-observation', true);
      if (observation.targetId !== target.id) return stop(now, 'target-lost', true);
      const risingConfirm = observation.confirm === true && !previousConfirm;
      previousConfirm = observation.confirm === true;
      if (dwellStart === null) dwellStart = observation.timestamp;
      if (observation.timestamp - dwellStart < config.dwellMs) return [];
      const cooled = now - lastAction >= config.cooldownMs;
      if (target.type === 'switch') {
        if (risingConfirm && !latched && cooled) {
          latched = true; lastAction = now;
          return [intent('activate', now)];
        }
        return [];
      }
      if (target.type === 'projector') {
        if (risingConfirm && cooled) {
          lastAction = now; anchor = null;
          return [intent('projector-key', now, {key: 'ok'})];
        }
        if (!anchor || now - anchor.timestamp > config.swipeWindowMs) {
          anchor = {x: observation.x, y: observation.y, timestamp: now};
          return [];
        }
        const dx = observation.x - anchor.x, dy = observation.y - anchor.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < config.swipeDistance || !cooled) return [];
        const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        lastAction = now; anchor = null;
        return [intent('projector-key', now, {key})];
      }
      if (!observation.drag) return stop(now, 'released', false);
      if (!dragStart) {
        dragStart = {y: observation.y, position: lastPosition ?? target.position};
        return [];
      }
      const proposed = percent(dragStart.position + (dragStart.y - observation.y) * 100);
      // Coalesce intermediate frames; a tick can emit the latest proposal only.
      pendingPosition = Math.abs(proposed - lastPosition) >= config.curtainStep ? proposed : null;
      return flush(now);
    }
    function report() {
      return {armed, reason, target: target ? {...target} : null,
        dwelling: dwellStart !== null, dragging: dragStart !== null,
        proposedPosition: pendingPosition ?? lastPosition};
    }
    return {arm, disarm, sample, tick, report};
  }
  root.CasaGestureEngine = {create};
})(globalThis);
