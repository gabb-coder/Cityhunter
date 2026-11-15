// Scan to catch.
//
// The prey's PIN screen also shows a QR code holding the same thing the
// hunter would type: which prey this is, and their PIN. The hunter can scan
// it with the camera instead of typing four digits out of breath. The code
// is on the prey's own screen only, exactly like the PIN, and the host
// still checks the distance.
//
// Decoding uses the browser's own detector where there is one (Chrome on
// Android) and the bundled jsQR library everywhere else (iPhone).

/* global qrcode, jsQR, BarcodeDetector */
import { $, setText } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { app } from '../state.js';
import { act, openModal, closeModal } from './core.js';

const SC = CONFIG.scan;
const PREFIX = 'ch:';

export const scanText = (id, pin) => PREFIX + id + ':' + pin;

export function parseScan(text) {
  const m = new RegExp('^' + PREFIX + '([a-z0-9]{4,16}):(\\d{' + CONFIG.catch.pinLength + '})$').exec(String(text || '').trim());
  return m ? { id: m[1], pin: m[2] } : null;
}

// Always black on white, whatever the theme: that is what cameras read best.
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

// ---------------------------------------------------------------- scanner
let stream = null;
let timer = null;
let detector = null;
let working = false;
let onResult = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = reject;
    document.head.appendChild(el);
  });
}

// Pick a decoder once.
async function ready() {
  if (detector) return;
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      const d = new BarcodeDetector({ formats: ['qr_code'] });
      detector = async (canvas) => {
        const found = await d.detect(canvas);
        return found.length ? found[0].rawValue : null;
      };
      return;
    }
  } catch (e) { /* fall through to jsQR */ }
  if (typeof jsQR === 'undefined') await loadScript('vendor/jsQR.js');
  detector = async (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return hit ? hit.data : null;
  };
}

function stop() {
  clearInterval(timer);
  timer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  working = false;
}

const status = (text) => setText($('#scan-status'), text);

async function frame(canvas) {
  const video = $('#scan-video');
  // The scanner was closed some other way (tapped outside, layer changed).
  if (!video || $('#modal').hidden) return stop();
  if (working || video.readyState < 2 || !video.videoWidth) return;
  working = true;
  try {
    const scale = Math.min(1, SC.maxSidePx / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
    const text = await detector(canvas);
    if (text != null && stream) {
      const hit = parseScan(text);
      if (!hit) status('That is not a catch code. Point at the code on the prey’s PIN screen.');
      else {
        const done = onResult;
        stop();
        closeModal();
        if (done) done(hit);
      }
    }
  } catch (e) { /* a bad frame: try the next one */ }
  working = false;
}

export async function openScanner(cb) {
  onResult = cb;
  openModal(
    '<h2>Scan their code</h2>' +
    '<p class="muted">Point the camera at the code on the prey’s PIN screen.</p>' +
    '<div class="scan-view"><video id="scan-video" playsinline muted autoplay></video><span class="scan-frame" aria-hidden="true"></span></div>' +
    '<p class="small scan-status" id="scan-status" role="status">Starting the camera…</p>' +
    '<button type="button" class="btn btn-quiet" data-act="scan-close">' + icon('backspace', 18) + 'Type the PIN instead</button>');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
    const [media] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }),
      ready()
    ]);
    const video = $('#scan-video');
    if (!video || $('#modal').hidden) {            // closed while the permission prompt was up
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = media;
    video.srcObject = media;
    await video.play().catch(() => {});
    status('Looking for a code…');
    const canvas = document.createElement('canvas');
    timer = setInterval(() => frame(canvas), SC.everyMs);
  } catch (e) {
    stop();
    status('The camera could not be used. Allow camera access for this site, or type the PIN instead.');
  }
}

act('scan-close', () => {
  stop();
  closeModal();
});
app.bus.on('cleanup', stop);
app.bus.on('layer', (name) => name !== 'catch' && stop());
document.addEventListener('visibilitychange', () => document.hidden && stream && (stop(), closeModal()));

app.scan = { parse: parseScan, text: scanText, active: () => !!stream };
