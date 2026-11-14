// Form review: replays a rep's landmark skeleton (never video) next to the proper-form demo.
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { formatFault, IDEAL } from '../lib/form.js';
import { Card, Icon, PrimaryButton, Sheet } from './kit.js';
import { R, T, type } from '../theme.js';

const DISCLAIMER = 'Based on camera landmarks, side view; not medical advice.';
const IDX = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};
const BONES = [['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle']];
const FRAME_MS = 50;
const IDEAL_FRAMES = Array.from({ length: 48 }, (_, i) => i / 47);

/** Loops 0..n-1 while mounted. */
function useLoop(n, ms = FRAME_MS) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (n < 2) return undefined;
    const id = setInterval(() => setI((k) => (k + 1) % n), ms);
    return () => clearInterval(id);
  }, [n, ms]);
  return i;
}

/** Shared bounding box so the skeleton does not jump around while it plays. */
function fit(poses, side, size) {
  const pts = poses.flatMap((p) => Object.values(IDX[side]).map((k) => p[k]).concat(p[0] ? [p[0]] : []));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 0.01);
  const pad = 14;
  const scale = (size - 2 * pad) / span;
  const offX = (size - (Math.max(...xs) - minX) * scale) / 2;
  const offY = (size - (Math.max(...ys) - minY) * scale) / 2;
  return (p) => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale });
}

const angleDeg = (a, b, c) => {
  const v1 = Math.atan2(a.y - b.y, a.x - b.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(((v1 - v2) * 180) / Math.PI);
  if (d > 180) d = 360 - d;
  return Math.round(d);
};

/** One skeleton. `focus` = [a, joint, c] names drawn red with the live angle at the joint. */
function Skeleton({ poses, index, side = 'left', color, focus, highlight, size = 150, label }) {
  const map = useMemo(() => fit(poses, side, size), [poses, side, size]);
  const pose = poses[index] ?? poses[0];
  const k = IDX[side];
  const P = (name) => map(pose[k[name]]);
  const inFocus = (a, b) => focus && focus.includes(a) && focus.includes(b);
  const head = pose[0] ? map(pose[0]) : null;
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={size} height={size} rx={R.sm} fill={T.surface} stroke={highlight ? T.red : T.border} strokeWidth={highlight ? 2 : 1} />
        {BONES.map(([a, b]) => {
          const p = P(a);
          const q = P(b);
          return <Line key={a + b} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={inFocus(a, b) ? T.red : color} strokeWidth={inFocus(a, b) ? 5 : 4} strokeLinecap="round" />;
        })}
        {head ? <Circle cx={head.x} cy={head.y} r={8} fill="none" stroke={color} strokeWidth={3} /> : null}
        {Object.keys(k).map((n) => {
          const p = P(n);
          return <Circle key={n} cx={p.x} cy={p.y} r={focus?.[1] === n ? 6 : 3.5} fill={focus?.[1] === n ? T.red : color} />;
        })}
        {focus ? (() => {
          const j = P(focus[1]);
          return <SvgText x={j.x + 8} y={j.y - 8} fill={T.red} fontSize={13} fontWeight="700">{`${angleDeg(P(focus[0]), j, P(focus[2]))}°`}</SvgText>;
        })() : null}
        {highlight ? <SvgText x={8} y={18} fill={T.red} fontSize={11} fontWeight="700">worst frame</SvgText> : null}
      </Svg>
      {label ? <Text style={[type.small, { marginTop: 4 }]}>{label}</Text> : null}
    </View>
  );
}

/** The proper-form demo animation in green. */
export function IdealDemo({ movement, size = 150 }) {
  const poses = useMemo(() => IDEAL_FRAMES.map((p) => IDEAL[movement].phase(p)), [movement]);
  const i = useLoop(poses.length, 60);
  return <Skeleton poses={poses} index={i} color={T.green} size={size} label="Proper form" />;
}

function ClipPlayer({ movement, clip, fault }) {
  const poses = useMemo(() => clip.frames.map((f) => f.pose), [clip]);
  const worst = useMemo(() => {
    let best = 0;
    clip.frames.forEach((f, j) => { if (Math.abs(f.t - fault.t) < Math.abs(clip.frames[best].t - fault.t)) best = j; });
    return best;
  }, [clip, fault]);
  const i = useLoop(poses.length);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginVertical: 12 }}>
      <Skeleton
        poses={poses} index={i} side={clip.analysis.side} color={T.violetText}
        focus={fault.joint} highlight={Math.abs(i - worst) <= 1} label={`Your rep ${clip.index}`}
      />
      <IdealDemo movement={movement} />
    </View>
  );
}

function FaultDetail({ fault }) {
  const { say } = useApp();
  return (
    <View>
      <Text style={[type.label, { marginTop: 4 }]}>Why it matters</Text>
      <Text style={type.body}>{fault.why}</Text>
      <Text style={[type.label, { marginTop: 10 }]}>How to fix it</Text>
      {fault.fix.map((s, n) => <Text key={s} style={type.body}>{n + 1}. {s}</Text>)}
      <TouchableOpacity
        onPress={() => say(fault.cue)} accessibilityRole="button" accessibilityLabel={`Hear cue: ${fault.cue}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}
      >
        <Icon name="volume-high" size={18} color={T.violetText} />
        <Text style={{ color: T.violetText, fontWeight: '700', fontSize: 15 }}>Cue: “{fault.cue}”</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Sheet listing flagged reps; tap one to replay it beside the proper-form demo. */
export function FormReviewSheet({ visible, onClose, movement, clips = [] }) {
  const rows = clips.flatMap((c) => c.analysis.faults.map((f) => ({ clip: c, fault: f, key: `${c.index}-${f.id}` })));
  const [open, setOpen] = useState(null);
  useEffect(() => { if (visible) setOpen(rows[0]?.key ?? null); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet visible={visible} onClose={onClose} title="Form review">
      <Text style={[type.small, { marginBottom: 10 }]}>{exerciseName(movement)} · {DISCLAIMER}</Text>
      {rows.length === 0 ? <Text style={type.body}>Nothing flagged on this set.</Text> : null}
      {rows.map(({ clip, fault, key }) => (
        <Card key={key} style={{ marginBottom: 10 }} onPress={() => setOpen(open === key ? null : key)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fault.severity === 'major' ? T.red : T.amber }} />
            <Text style={[type.title, { flex: 1, fontSize: 15 }]}>Rep {clip.index} · {formatFault(fault)}</Text>
            <Icon name={open === key ? 'chevron-up' : 'chevron-down'} size={20} color={T.textDim} />
          </View>
          {open === key ? (
            <>
              <ClipPlayer movement={movement} clip={clip} fault={fault} />
              <FaultDetail fault={fault} />
            </>
          ) : null}
        </Card>
      ))}
      <PrimaryButton secondary onPress={onClose}>Done</PrimaryButton>
    </Sheet>
  );
}

/** Proper-form demo plus checkpoints for the selected lift. */
export function HowToSheet({ visible, onClose, movement }) {
  const ideal = IDEAL[movement];
  return (
    <Sheet visible={visible} onClose={onClose} title={`How to: ${exerciseName(movement)}`}>
      {ideal ? (
        <>
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            {visible ? <IdealDemo movement={movement} size={200} /> : null}
          </View>
          {ideal.checkpoints.map((c, n) => (
            <Text key={c} style={[type.body, { marginBottom: 6 }]}>{n + 1}. {c}</Text>
          ))}
          <Text style={[type.small, { marginTop: 8 }]}>Film side-on so Jim can see your shoulder, hip and working joints. {DISCLAIMER}</Text>
        </>
      ) : <Text style={type.body}>No demo for this lift yet.</Text>}
      <PrimaryButton secondary onPress={onClose}>Done</PrimaryButton>
    </Sheet>
  );
}
