// Page run inside a WebView: camera + MediaPipe pose on the phone. It posts landmarks
// (never video) to React Native, where the tested rep pipeline counts them.
export const MEDIAPIPE_VERSION = '1.2.3';
export const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export function poseHtml({ facing = 'user', fps = 20 } = {}) {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .mirror{transform:scaleX(-1)}
</style></head>
<body>
<video id="v" playsinline muted autoplay></video><canvas id="c"></canvas>
<script type="module">
const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));
const SKELETON = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
const v = document.getElementById('v'), c = document.getElementById('c'), ctx = c.getContext('2d');
let facing = ${JSON.stringify(facing)}, stream = null, landmarker = null, last = 0;

function draw(pose, ok) {
  c.width = v.videoWidth; c.height = v.videoHeight;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!pose) return;
  ctx.strokeStyle = ctx.fillStyle = ok ? '#c9ed96' : '#f0c674';
  ctx.lineWidth = 5;
  for (const [a, b] of SKELETON) {
    const p = pose[a], q = pose[b];
    if (!p || !q || p.visibility < 0.3 || q.visibility < 0.3) continue;
    ctx.beginPath(); ctx.moveTo(p.x * c.width, p.y * c.height); ctx.lineTo(q.x * c.width, q.y * c.height); ctx.stroke();
  }
}

async function startCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
  v.srcObject = stream;
  v.className = c.className = facing === 'user' ? 'mirror' : '';
  await v.play().catch(() => {});
}

async function main() {
  try {
    await startCamera();
  } catch (e) {
    post({ type: 'error', kind: 'camera', message: String(e && e.name || e) });
    return;
  }
  try {
    const { FilesetResolver, PoseLandmarker } = await import('${MEDIAPIPE_CDN}/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks('${MEDIAPIPE_CDN}/wasm');
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: '${POSE_MODEL_URL}', delegate }, runningMode: 'VIDEO', numPoses: 1 });
    try { landmarker = await PoseLandmarker.createFromOptions(files, opts('GPU')); }
    catch { landmarker = await PoseLandmarker.createFromOptions(files, opts('CPU')); }
  } catch (e) {
    post({ type: 'error', kind: 'model', message: String(e && e.message || e) });
    return;
  }
  post({ type: 'ready' });
  const tick = () => {
    const now = performance.now();
    if (v.readyState >= 2 && now - last >= ${Math.round(1000 / fps)}) {
      last = now;
      const res = landmarker.detectForVideo(v, now);
      const lm = res.landmarks && res.landmarks[0];
      const pose = lm ? lm.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), visibility: +(p.visibility ?? 0).toFixed(3) })) : null;
      const arms = pose ? Math.max(Math.min(pose[11].visibility, pose[13].visibility, pose[15].visibility), Math.min(pose[12].visibility, pose[14].visibility, pose[16].visibility)) : 0;
      draw(pose, arms >= 0.5);
      post({ type: 'frame', t: Math.round(now), pose });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onMessage(e) {
  try {
    const m = JSON.parse(e.data);
    if (m.type === 'facing') { facing = m.facing; startCamera().catch((err) => post({ type: 'error', kind: 'camera', message: String(err) })); }
    if (m.type === 'stop' && stream) stream.getTracks().forEach((t) => t.stop());
  } catch {}
}
document.addEventListener('message', onMessage);
window.addEventListener('message', onMessage);
main();
</script></body></html>`;
}
