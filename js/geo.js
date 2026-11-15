// GPS watcher.
//
// status: idle | waiting | ok | weak | lost | denied | unsupported
//   weak  accuracy worse than CONFIG.gps.weakAccuracyM
//   lost  no fix for CONFIG.gps.lostAfterSec
//
// watchPosition alone is not enough: a phone that is standing still (a prey
// hiding, say) may not fire callbacks for a while. A light getCurrentPosition
// poll asks the device whether it still vouches for a recent position
// (CONFIG.gps.keepAliveMaxAgeSec), so "lost" means the device really has
// nothing, not that the player stopped moving.

import { CONFIG } from './config.js';
import { Emitter, dist, bearing } from './util.js';

const C = CONFIG.gps;
const OPTS = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };

export class Geo extends Emitter {
  constructor() {
    super();
    this.fix = null;          // { lat, lng, acc, hdg, at }
    this.status = 'idle';
    this.startedAt = 0;
    this.watchId = null;
    this.timer = null;
    this.blocked = false;     // test hook: pretend the signal is gone
    this.simulated = false;
    this.lastMove = null;
    this.compass = null;      // degrees from north, from the phone's compass
    this.compassAt = 0;
    this.compassOn = false;
  }

  // Compass heading, so the direction wedge works while standing still.
  // iOS only grants this from a tap, so call it from a click handler.
  async enableCompass() {
    if (this.compassOn) return;
    const D = window.DeviceOrientationEvent;
    if (!D) return;
    this.compassOn = true;
    // Listen first: Android delivers readings without asking. iOS only
    // starts delivering them once the permission below is granted.
    const onOrient = (e) => this._onOrient(e);
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    try {
      if (typeof D.requestPermission === 'function') await D.requestPermission();
    } catch (e) { /* refused or not from a tap: the wedge falls back to direction of travel */ }
  }

  _onOrient(e) {
    let hdg = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) hdg = e.webkitCompassHeading;   // iOS
    else if (e.absolute && e.alpha != null) hdg = 360 - e.alpha;                                                    // Android
    if (hdg == null || !isFinite(hdg)) return;
    const turn = (screen.orientation && screen.orientation.angle) || 0;
    hdg = (hdg + turn + 360) % 360;
    const moved = this.compass == null || Math.abs(((hdg - this.compass + 540) % 360) - 180) >= 4;
    this.compassAt = Date.now();
    if (!moved) return;
    this.compass = hdg;
    this.emit('heading', hdg);
  }

  // Best heading right now: a live compass reading, else direction of travel.
  heading() {
    if (this.compass != null && Date.now() - this.compassAt < 3000) return this.compass;
    return this.fix ? this.fix.hdg : null;
  }

  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this._check(), 1000);
    if (this.simulated) return;
    if (!('geolocation' in navigator)) return this._status('unsupported');
    this._status('waiting');
    this.watchId = navigator.geolocation.watchPosition((p) => this._onPos(p), (e) => this._onErr(e), OPTS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.status = 'idle';
  }

  // Seconds since the last fix (or since start if there never was one).
  silence() {
    return (Date.now() - (this.fix ? this.fix.at : this.startedAt)) / 1000;
  }
  get lost() {
    return this.status === 'lost' || this.status === 'denied' || this.status === 'unsupported';
  }

  _status(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  _onPos(pos) {
    if (this.blocked || this.simulated) return;
    const c = pos.coords;
    this._fix(c.latitude, c.longitude, c.accuracy, c.speed > 0.5 && isFinite(c.heading) && c.heading != null ? c.heading : null);
  }

  _fix(lat, lng, acc, hdg) {
    const p = { lat, lng };
    // No compass heading: derive one from the last stretch actually walked.
    if (hdg == null && this.lastMove && dist(this.lastMove, p) >= CONFIG.gps.minMoveM) hdg = bearing(this.lastMove, p);
    if (!this.lastMove || dist(this.lastMove, p) >= CONFIG.gps.minMoveM) this.lastMove = p;
    if (hdg == null && this.fix) hdg = this.fix.hdg;
    this.fix = { lat, lng, acc: Math.max(1, Math.round(acc || 0)), hdg, at: Date.now() };
    this._status(this.fix.acc > C.weakAccuracyM ? 'weak' : 'ok');
    this.emit('fix', this.fix);
  }

  _onErr(err) {
    if (err && err.code === 1) this._status('denied');
  }

  _check() {
    if (this.status === 'denied' || this.status === 'unsupported') return;
    const quiet = this.silence();
    if (quiet > C.lostAfterSec) this._status('lost');
    // Keep-alive poll while the watch is quiet.
    if (!this.simulated && !this.blocked && quiet > 4 && Math.round(quiet) % 4 === 0) {
      navigator.geolocation.getCurrentPosition((p) => this._onPos(p), () => {}, { enableHighAccuracy: true, maximumAge: C.keepAliveMaxAgeSec * 1000, timeout: 5000 });
    }
    if (this.simulated && !this.blocked && this.fix) this._fix(this.fix.lat, this.fix.lng, this.fix.acc, this.fix.hdg);
  }

  // ---- desk testing (?sim=lat,lng): tap the map to walk there ----
  simulate(lat, lng, acc = 5) {
    this.simulated = true;
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (!this.blocked) this._fix(lat, lng, acc, null);
  }
}
