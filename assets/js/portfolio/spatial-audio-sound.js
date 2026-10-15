// 공간음향 차폐 데모 소리. 계산한 수치를 Web Audio 로 실제 소리에 입힙니다. (실제 게임에서는 이 자리가 Wwise RTPC 입니다)
//   거리       → 볼륨 (역거리 감쇠)
//   차폐 계수  → 볼륨 + 로우패스 컷오프
//   밀폐도     → 리버브 센드 = 1 − 밀폐도² (청취자가 있는 공간의 울림. 바닥 아래로 나간 레이가 열린 것으로 잡혀 밀폐도가 0.5 아래로는 잘 안 내려가므로 제곱으로 당깁니다)
//   방향       → HRTF 패닝. 화면을 보는 방향이 청취자가 보는 방향입니다. (화면 오른쪽 = 오른쪽 귀)
//               직선이 막혔으면 우회 경로에서 청취자에게 보이는 마지막 점(문, 벽 끝) 쪽에서 경로 길이만큼 떨어져 들립니다.
// 소리는 파일 없이 합성합니다. (비트 루프, 핑크 노이즈, 리버브 임펄스)

export const REF_DISTANCE = 1.5; // m. 이 안에서는 거리 감쇠 없음
export const ROLLOFF = 0.8;
export const OCCLUSION_DB = -24; // 차폐 계수 1 일 때
export const CUTOFF_OPEN = 20000; // Hz
export const CUTOFF_CLOSED = 320; // Hz. 차폐 계수 1 일 때
export const REVERB_MAX = 2; // 센드 100% 일 때 게인. 컨볼버가 임펄스 크기를 맞추므로 1 보다 큽니다 (젖은 소리가 마른 소리보다 약 3 dB 작게)

const SMOOTH = 0.05; // s. 값이 바뀔 때 튀지 않게 따라가는 시간
const LOOP_BPM = 120;
const LOOP_BARS = 2;
const STEPS = 16;
const NOISE_SECONDS = 4;
const IMPULSE_SECONDS = 1.2;
const IMPULSE_DECAY = 6.5; // RT60 약 1초
const PREDELAY = 0.012;

export const distanceGain = (distance) =>
  REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (Math.max(distance, REF_DISTANCE) - REF_DISTANCE));
export const occlusionDb = (occlusion) => OCCLUSION_DB * occlusion;
export const occlusionCutoff = (occlusion) => CUTOFF_OPEN * (CUTOFF_CLOSED / CUTOFF_OPEN) ** occlusion;
export const reverbAmount = (openness) => 1 - Math.min(Math.max(openness, 0), 1) ** 2;
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (gain) => 20 * Math.log10(Math.max(gain, 1e-6));

export function supportsWebAudio() {
  return typeof window !== 'undefined' && 'AudioContext' in window && 'OfflineAudioContext' in window;
}

/* 합성 ------------------------------------------------------------------- */

// 고정 시드 난수 (mulberry32). 같은 소리가 늘 같게 나옵니다.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function whiteNoise(context, seconds, seed) {
  const buffer = context.createBuffer(1, Math.round(seconds * context.sampleRate), context.sampleRate);
  const data = buffer.getChannelData(0);
  const next = random(seed);
  for (let index = 0; index < data.length; index++) data[index] = next() * 2 - 1;
  return buffer;
}

const midi = (note) => 440 * 2 ** ((note - 69) / 12);

export function rms(data) {
  let sum = 0;
  for (let index = 0; index < data.length; index++) sum += data[index] * data[index];
  return Math.sqrt(sum / (data.length || 1));
}

function peak(data) {
  let max = 0;
  for (let index = 0; index < data.length; index++) max = Math.max(max, Math.abs(data[index]));
  return max;
}

function scale(buffer, factor) {
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] *= factor;
  }
}

// 2마디 비트 루프: 킥(저음), 스네어 / 하이햇(고음), 플럭 아르페지오(중음), 패드(지속음).
// 벽 뒤에서는 로우패스에 고음이 깎여 킥만 남는 식으로 차폐가 귀에 바로 들리게 음역을 나눴습니다.
export function renderLoop(context) {
  const rate = context.sampleRate;
  const step = 60 / LOOP_BPM / 4;
  const seconds = LOOP_BARS * STEPS * step;
  const offline = new OfflineAudioContext(1, Math.round(seconds * rate), rate);
  const noise = whiteNoise(offline, 1, 7);
  const out = offline.destination;

  const envelope = (at, level, decay) => {
    const gain = new GainNode(offline, { gain: 0 });
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + decay);
    gain.connect(out);
    return gain;
  };
  const burst = (at, level, decay, type, frequency) => {
    const source = new AudioBufferSourceNode(offline, { buffer: noise });
    const filter = new BiquadFilterNode(offline, { type, frequency, Q: 0.9 });
    source.connect(filter).connect(envelope(at, level, decay));
    source.start(at);
    source.stop(at + decay + 0.01);
  };
  const tone = (at, type, frequency, level, decay, filter = null) => {
    const osc = new OscillatorNode(offline, { type, frequency });
    const gain = envelope(at, level, decay);
    if (filter) osc.connect(filter).connect(gain);
    else osc.connect(gain);
    osc.start(at);
    osc.stop(at + decay + 0.01);
    return osc;
  };

  const kick = (at) => {
    const osc = tone(at, 'sine', 160, 0.9, 0.38);
    osc.frequency.setValueAtTime(160, at);
    osc.frequency.exponentialRampToValueAtTime(46, at + 0.09);
  };
  const snare = (at, level) => {
    burst(at, level, 0.18, 'bandpass', 1800);
    tone(at, 'sine', 190, level * 0.6, 0.12);
  };
  const hat = (at, level, decay = 0.04) => burst(at, level, decay, 'highpass', 7000);
  const pluck = (at, note) => {
    const filter = new BiquadFilterNode(offline, { type: 'lowpass', frequency: 2600, Q: 2 });
    filter.frequency.setValueAtTime(2600, at);
    filter.frequency.exponentialRampToValueAtTime(500, at + 0.2);
    tone(at, 'sawtooth', midi(note), 0.22, 0.32, filter);
  };

  // 패드 세 음은 루프 길이(4초) 동안 정수 번 진동해서 이어 붙어도 끊기지 않습니다.
  const pad = new GainNode(offline, { gain: 0.05 });
  pad.connect(new BiquadFilterNode(offline, { type: 'lowpass', frequency: 700, Q: 0.5 })).connect(out);
  for (const frequency of [110, 110.25, 165]) {
    const osc = new OscillatorNode(offline, { type: 'sawtooth', frequency });
    osc.connect(pad);
    osc.start(0);
    osc.stop(seconds);
  }

  const bars = [
    { kick: [0, 8, 10], snare: [[4, 0.5], [12, 0.5]], open: [], pluck: { 0: 57, 2: 64, 4: 60, 6: 67, 8: 57, 10: 64, 12: 69, 14: 67 } },
    { kick: [0, 8, 10], snare: [[4, 0.5], [12, 0.5], [15, 0.2]], open: [14], pluck: { 0: 57, 2: 64, 4: 60, 6: 67, 8: 64, 9: 67, 10: 69, 12: 67, 14: 64 } },
  ];
  bars.forEach((bar, index) => {
    const base = index * STEPS * step;
    bar.kick.forEach((at) => kick(base + at * step));
    bar.snare.forEach(([at, level]) => snare(base + at * step, level));
    for (let at = 0; at < STEPS; at++) {
      if (bar.open.includes(at)) hat(base + at * step, 0.3, 0.35);
      else hat(base + at * step, at % 2 ? 0.12 : 0.3);
    }
    for (const [at, note] of Object.entries(bar.pluck)) pluck(base + Number(at) * step, note);
  });

  return offline.startRendering().then((buffer) => {
    scale(buffer, 0.85 / (peak(buffer.getChannelData(0)) || 1));
    return buffer;
  });
}

// 핑크 노이즈 (Paul Kellet 필터). 끝 0.1초를 처음과 겹쳐 이어 붙어도 끊기지 않게 합니다.
export function renderNoise(context, targetRms) {
  const rate = context.sampleRate;
  const length = Math.round(NOISE_SECONDS * rate);
  const overlap = Math.round(0.1 * rate);
  const raw = new Float32Array(length + overlap);
  const next = random(11);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let index = 0; index < raw.length; index++) {
    const white = next() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    raw[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  const buffer = context.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  data.set(raw.subarray(0, length));
  for (let index = 0; index < overlap; index++) {
    const weight = index / overlap;
    data[index] = raw[index] * weight + raw[length + index] * (1 - weight);
  }
  scale(buffer, targetRms / (rms(data) || 1));
  return buffer;
}

// 리버브 임펄스: 지수 감쇠 노이즈. 뒤로 갈수록 고음을 더 깎습니다. (ConvolverNode 가 크기를 맞추므로 진폭은 상관없음)
export function renderImpulse(context) {
  const rate = context.sampleRate;
  const length = Math.round(IMPULSE_SECONDS * rate);
  const predelay = Math.round(PREDELAY * rate);
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const next = random(101 + channel);
    let low = 0;
    for (let index = predelay; index < length; index++) {
      const t = (index - predelay) / rate;
      const damp = 0.6 - 0.5 * Math.min(t / IMPULSE_SECONDS, 1);
      low += damp * (next() * 2 - 1 - low);
      data[index] = low * Math.exp(-IMPULSE_DECAY * t);
    }
  }
  return buffer;
}

/* 그래프 ----------------------------------------------------------------- */

// 입력 → 로우패스(차폐) → 게인(차폐) → 게인(거리) → HRTF 패너 → 마스터
//                                  └→ 리버브 센드(밀폐도) → 컨볼버 → 마스터
// 거리 감쇠는 수치 패널에 보이는 값 그대로 쓰려고 패너 대신 게인으로 직접 겁니다. (rolloffFactor 0)
export function buildGraph(context) {
  const filter = new BiquadFilterNode(context, { type: 'lowpass', frequency: CUTOFF_OPEN, Q: 0.6 });
  const occlusion = new GainNode(context, { gain: 1 });
  const distance = new GainNode(context, { gain: 1 });
  const panner = new PannerNode(context, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 0 });
  const send = new GainNode(context, { gain: 0 });
  const reverb = new ConvolverNode(context, { buffer: renderImpulse(context) });
  const master = new GainNode(context, { gain: 0 });
  filter.connect(occlusion);
  occlusion.connect(distance);
  distance.connect(panner);
  panner.connect(master);
  occlusion.connect(send);
  send.connect(reverb);
  reverb.connect(master);
  master.connect(context.destination);
  return { input: filter, filter, occlusion, distance, panner, send, reverb, master };
}

function place(node, [x, y, z], set) {
  if (node.positionX) {
    set(node.positionX, x);
    set(node.positionY, y);
    set(node.positionZ, z);
  } else {
    node.setPosition(x, y, z);
  }
}

function orient(listener, [x, y, z], set) {
  if (listener.forwardX) {
    set(listener.forwardX, x);
    set(listener.forwardY, y);
    set(listener.forwardZ, z);
    set(listener.upX, 0);
    set(listener.upY, 1);
    set(listener.upZ, 0);
  } else {
    listener.setOrientation(x, y, z, 0, 1, 0);
  }
}

// 수치 하나를 소리 값으로. frame: { listener, source, straight, apparent, pathLength, blocked, forward, occlusion, openness }
export function soundValues(frame, usePortal) {
  const viaPath = usePortal && Boolean(frame.apparent);
  const distance = viaPath ? frame.pathLength : frame.straight;
  return {
    viaPath,
    position: viaPath ? frame.apparent : frame.source,
    distance,
    attenuation: distanceGain(distance),
    db: occlusionDb(frame.occlusion),
    cutoff: occlusionCutoff(frame.occlusion),
    reverb: reverbAmount(frame.openness),
  };
}

/* 화면 ------------------------------------------------------------------- */

const SWITCH = '<span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>';

export function soundControlsMarkup() {
  if (!supportsWebAudio()) return '';
  return `
      <div class="pf-lab__sound" role="group" aria-label="소리">
        <button type="button" class="pf-button pf-switch" role="switch" aria-checked="false" data-sound-toggle>${SWITCH}소리 듣기</button>
        <div class="pf-segmented" role="group" aria-label="소리 종류">
          <button type="button" class="pf-button pf-segmented__item" data-sound-source="loop" aria-pressed="true">비트 루프</button>
          <button type="button" class="pf-button pf-segmented__item" data-sound-source="noise" aria-pressed="false">핑크 노이즈</button>
        </div>
        <button type="button" class="pf-button pf-switch" role="switch" aria-checked="true" data-sound-portal>${SWITCH}우회 방향에서 듣기</button>
        <label class="pf-lab__volume">음량<input type="range" min="0" max="100" value="70" data-sound-volume></label>
      </div>`;
}

const SOUND_READOUT = [
  ['distance', '거리 감쇠'],
  ['occlusion', '차폐 볼륨'],
  ['cutoff', '로우패스'],
  ['reverb', '리버브 센드'],
  ['direction', '들리는 방향'],
];

export function soundReadoutMarkup() {
  if (!supportsWebAudio()) return '';
  const rows = SOUND_READOUT.map(
    ([key, label]) => `<div class="pf-readout__row"><dt>${label}</dt><dd data-sound-out="${key}"></dd></div>`,
  ).join('');
  return `
    <h3 class="pf-readout__title">소리에 적용 <span class="pf-readout__hint">실제 게임에서는 Wwise RTPC</span></h3>
    <dl class="pf-readout pf-readout--sound">${rows}</dl>`;
}

export function soundHelpMarkup() {
  if (!supportsWebAudio()) return '';
  return '<p>소리 듣기를 켜면 음원 자리에서 소리가 납니다. 차폐 계수는 볼륨과 로우패스로, 밀폐도는 리버브로, 거리는 감쇠로 들리고 방향은 화면을 보는 방향 기준입니다. (화면 오른쪽 = 오른쪽 귀) 직선이 막혔을 때는 우회 경로가 보이는 마지막 점(문, 벽 끝) 쪽에서 들립니다. 이어폰이나 헤드폰으로 들으면 방향이 또렷합니다.</p>';
}

const formatDb = (value) => `${value <= -0.05 ? '−' : ''}${Math.abs(value).toFixed(1)} dB`;
const formatHz = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`);

export function bindSound(container, { live } = {}) {
  const toggle = container.querySelector('[data-sound-toggle]');
  if (!toggle) return { update() {}, setActive() {} };

  const sourceButtons = [...container.querySelectorAll('[data-sound-source]')];
  const portalSwitch = container.querySelector('[data-sound-portal]');
  const volume = container.querySelector('[data-sound-volume]');
  const outputs = Object.fromEntries(
    [...container.querySelectorAll('[data-sound-out]')].map((node) => [node.dataset.soundOut, node]),
  );

  let engine = null;
  let playing = false;
  let active = true;
  let kind = 'loop';
  let usePortal = true;
  let level = Number(volume.value) / 100;
  let frame = null;
  let generation = 0;
  let suspendTimer = 0;

  const masterGain = () => (playing && active ? level * level : 0);

  function ensureEngine() {
    if (engine) return engine;
    const context = new AudioContext();
    engine = { context, graph: buildGraph(context), buffers: {}, current: null };
    engine.ready = renderLoop(context).then((loop) => {
      engine.buffers.loop = loop;
      engine.buffers.noise = renderNoise(context, rms(loop.getChannelData(0)));
    });
    if (frame) apply(frame, true);
    return engine;
  }

  function stopSource(now) {
    const current = engine.current;
    if (!current) return;
    engine.current = null;
    current.gain.gain.setTargetAtTime(0, now, 0.03);
    current.node.stop(now + 0.2);
  }

  async function startSource() {
    const token = ++generation;
    const { context, graph } = engine;
    await engine.ready;
    if (token !== generation || !playing) return;
    const now = context.currentTime;
    stopSource(now);
    const node = new AudioBufferSourceNode(context, { buffer: engine.buffers[kind], loop: true });
    const gain = new GainNode(context, { gain: 0 });
    node.connect(gain).connect(graph.input);
    gain.gain.setTargetAtTime(1, now, 0.03);
    node.start(now);
    engine.current = { node, gain };
  }

  function applyMaster() {
    if (!engine) return;
    const { context, graph } = engine;
    window.clearTimeout(suspendTimer);
    const target = masterGain();
    if (target > 0 && context.state !== 'running') context.resume();
    graph.master.gain.setTargetAtTime(target, context.currentTime, 0.08);
    if (target === 0) suspendTimer = window.setTimeout(() => !masterGain() && context.suspend(), 500);
  }

  function apply(next, immediate = false) {
    frame = next;
    const values = soundValues(next, usePortal);
    outputs.distance.textContent = `${formatDb(gainToDb(values.attenuation))} · ${values.distance.toFixed(1)}m`;
    outputs.occlusion.textContent = formatDb(values.db);
    outputs.cutoff.textContent = formatHz(values.cutoff);
    outputs.reverb.textContent = `${Math.round(values.reverb * 100)} %`;
    outputs.direction.textContent = values.viaPath ? '우회 경로 쪽' : next.blocked ? '직선 (벽 너머)' : '직선';

    if (!engine) return;
    const { context, graph } = engine;
    const now = context.currentTime;
    const set = immediate
      ? (param, value) => {
          param.cancelScheduledValues(now);
          param.value = value;
        }
      : (param, value) => param.setTargetAtTime(value, now, SMOOTH);
    set(graph.filter.frequency, values.cutoff);
    set(graph.occlusion.gain, dbToGain(values.db));
    set(graph.distance.gain, values.attenuation);
    set(graph.send.gain, values.reverb * REVERB_MAX);
    place(graph.panner, values.position, set);
    place(context.listener, next.listener, set);
    orient(context.listener, next.forward, set);
  }

  toggle.addEventListener('click', () => {
    playing = !playing;
    if (playing) {
      try {
        ensureEngine();
      } catch (error) {
        console.warn('소리를 켜지 못했습니다.', error);
        playing = false;
      }
    }
    toggle.setAttribute('aria-checked', String(playing));
    if (!engine) return;
    if (playing) startSource();
    else stopSource(engine.context.currentTime);
    applyMaster();
    if (live) live.textContent = playing ? '소리 켬' : '소리 끔';
  });

  sourceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      kind = button.dataset.soundSource;
      sourceButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      if (playing) startSource();
    });
  });

  portalSwitch.addEventListener('click', () => {
    usePortal = !usePortal;
    portalSwitch.setAttribute('aria-checked', String(usePortal));
    if (frame) apply(frame);
  });

  volume.addEventListener('input', () => {
    level = Number(volume.value) / 100;
    applyMaster();
  });

  return {
    update: (next) => apply(next),
    setActive(next) {
      if (active === next) return;
      active = next;
      applyMaster();
    },
  };
}
