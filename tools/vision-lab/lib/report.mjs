// Per-clip HTML report (video with the predicted skeleton overlaid, rep timeline) and
// annotated PNGs of failure frames.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

const nearest = (list, t) => list.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), list[0]);

export async function annotate(page, dir, raw, frames, failures) {
  mkdirSync(join(dir, 'failures'), { recursive: true });
  for (const [i, f] of failures.entries()) {
    const src = nearest(raw, f.t);
    const st = nearest(frames, f.t);
    const label = `${f.kind}  t=${f.t}ms  count=${st.count}  state=${st.state}  tracking=${st.tracking}${st.issue ? `  issue=${st.issue}` : ''}  angle=${st.angle?.toFixed?.(0) ?? '-'}`;
    const png = await page.evaluate(async (b64, pose, bones, label) => {
      const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height + 28);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 28);
      g.fillStyle = '#111'; g.fillRect(0, 0, c.width, 28);
      g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(label, 8, 20);
      if (pose) {
        const P = (p) => [p.x * img.width, p.y * img.height + 28];
        g.lineWidth = 3;
        for (const [a, b] of bones) {
          g.strokeStyle = Math.min(pose[a].visibility, pose[b].visibility) >= 0.5 ? '#a855f7' : '#f87171';
          g.beginPath(); g.moveTo(...P(pose[a])); g.lineTo(...P(pose[b])); g.stroke();
        }
        for (const p of pose.slice(11, 29)) { g.fillStyle = p.visibility >= 0.5 ? '#fff' : '#f87171'; g.beginPath(); g.arc(...P(p), 4, 0, 7); g.fill(); }
      } else { g.fillStyle = '#f87171'; g.fillText('NO POSE DETECTED', 8, 56); }
      const blob = await c.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (const x of buf) s += String.fromCharCode(x);
      return btoa(s);
    }, readFileSync(src.frame).toString('base64'), src.pose, BONES, label);
    const name = `${String(i).padStart(2, '0')}-${f.kind}-${f.t}ms.png`;
    writeFileSync(join(dir, 'failures', name), Buffer.from(png, 'base64'));
    f.png = `failures/${name}`;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderReport({ clip, raw, replayed, score, failures, fps, model }) {
  const data = { poses: raw.map((f) => f.pose && f.pose.map((p) => [p.x, p.y, p.visibility])), frames: replayed.frames, fps, bones: BONES, trueEnds: clip.reps?.map((r) => r.end_ms) ?? [], predEnds: replayed.predEnds };
  const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(0)}%`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(clip.id)} · vision lab</title>
<style>body{font:14px system-ui;background:#0b0b10;color:#eee;margin:16px;max-width:1100px}
.stage{position:relative;display:inline-block}video,canvas{display:block;max-width:100%}canvas{position:absolute;inset:0;pointer-events:none}
table{border-collapse:collapse}td,th{border:1px solid #333;padding:4px 8px}#hud{font:16px monospace;margin:8px 0}
#tl{width:100%;height:60px;background:#15151c;cursor:pointer}.fail img{max-width:520px;border:1px solid #333;margin:4px}</style></head><body>
<h1>${esc(clip.id)} <small>(${esc(clip.movement)}, ${esc(clip.split)}${clip.adversarial ? ', adversarial' : ''}, MediaPipe ${esc(model)}, ${fps} fps)</small></h1>
<table><tr><th>true reps</th><th>predicted</th><th>TP</th><th>FP</th><th>missed</th><th>precision</th><th>recall</th><th>tracking OK</th></tr>
<tr><td>${score ? data.trueEnds.length : 'unlabeled'}</td><td>${replayed.predEnds.length}</td><td>${score?.tp ?? '–'}</td><td>${score?.fp ?? '–'}</td><td>${score?.fn ?? '–'}</td><td>${pct(score?.precision)}</td><td>${pct(score?.recall)}</td><td>${pct(replayed.trackingOkRatio)}</td></tr></table>
<div id="hud"></div>
<div class="stage"><video id="v" src="${esc(clip.video)}" controls muted playsinline></video><canvas id="c"></canvas></div>
<p>Timeline: <span style="color:#22c55e">▲ labeled rep end</span> · <span style="color:#a855f7">▼ predicted rep</span> · <span style="color:#f87171">■ tracking not OK</span> (click to seek)</p>
<canvas id="tl" width="1100" height="60" style="position:static"></canvas>
<h2>Failure frames</h2><div class="fail">${failures.map((f) => `<figure><img src="${esc(f.png ?? '')}"><figcaption>${esc(f.kind)} at ${f.t} ms</figcaption></figure>`).join('') || 'None.'}</div>
<script>const D=${JSON.stringify(data)};
const v=document.getElementById('v'),c=document.getElementById('c'),g=c.getContext('2d'),hud=document.getElementById('hud');
const dur=()=>D.frames.length?D.frames[D.frames.length-1].t:1;
function draw(){const i=Math.min(D.frames.length-1,Math.max(0,Math.round(v.currentTime*D.fps)));c.width=v.clientWidth;c.height=v.clientHeight;
g.clearRect(0,0,c.width,c.height);const p=D.poses[i],f=D.frames[i];
if(p){g.lineWidth=3;for(const[a,b]of D.bones){g.strokeStyle=Math.min(p[a][2],p[b][2])>=.5?'#a855f7':'#f87171';g.beginPath();g.moveTo(p[a][0]*c.width,p[a][1]*c.height);g.lineTo(p[b][0]*c.width,p[b][1]*c.height);g.stroke();}}
if(f)hud.textContent='t='+f.t+'ms  count='+f.count+'  state='+f.state+'  tracking='+f.tracking+(f.issue?'  issue='+f.issue:'')+'  angle='+(f.angle==null?'-':f.angle.toFixed(0));
requestAnimationFrame(draw);}
v.addEventListener('loadeddata',()=>requestAnimationFrame(draw));
const tl=document.getElementById('tl'),h=tl.getContext('2d'),X=t=>t/dur()*tl.width;
D.frames.forEach(f=>{if(f.tracking!=='ok'){h.fillStyle='#7f1d1d';h.fillRect(X(f.t),25,Math.max(1,tl.width/D.frames.length),10);}});
h.fillStyle='#22c55e';D.trueEnds.forEach(t=>{h.beginPath();h.moveTo(X(t),24);h.lineTo(X(t)-6,36);h.lineTo(X(t)+6,36);h.fill();});
h.fillStyle='#a855f7';D.predEnds.forEach(t=>{h.beginPath();h.moveTo(X(t),24);h.lineTo(X(t)-6,10);h.lineTo(X(t)+6,10);h.fill();});
tl.onclick=e=>{v.currentTime=(e.offsetX/tl.clientWidth)*dur()/1000;};
</script></body></html>`;
}
