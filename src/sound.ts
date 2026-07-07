let ctx: AudioContext | null = null;
let masterVolume = 1;
let noiseBuffer: AudioBuffer | null = null;

/** Sets the master UI-sound volume from the "soundVolume" setting (0-100). */
export function setMasterVolume(percent: number) {
  masterVolume = Math.max(0, Math.min(100, percent)) / 100;
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function getNoiseBuffer(audio: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.2), audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** A tonal blip with a soft attack and a low-pass filter, so it rounds off instead of clicking on start. */
function tone(freqStart: number, freqEnd: number, duration: number, volume: number, type: OscillatorType = "sine", delay = 0) {
  if (masterVolume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const attack = Math.min(0.006, duration * 0.2);

  const osc = audio.createOscillator();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(Math.max(freqStart, freqEnd) * 2.2, start);

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), start + duration);

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume * masterVolume, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** A short band-passed noise burst that layers under a tone for a tactile, percussive "click" edge. */
function click(duration: number, volume: number, filterFreq: number, q: number, delay = 0) {
  if (masterVolume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  const start = audio.currentTime + delay;

  const src = audio.createBufferSource();
  src.buffer = getNoiseBuffer(audio);
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFreq, start);
  filter.Q.setValueAtTime(q, start);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume * masterVolume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  src.start(start);
  src.stop(start + duration + 0.01);
}

export function playMoveSound() {
  click(0.028, 0.05, 2400, 3, 0);
  tone(760, 660, 0.045, 0.028, "sine");
}

export function playSelectSound() {
  click(0.02, 0.055, 3200, 4, 0);
  tone(660, 1080, 0.1, 0.05, "triangle");
}

export function playBackSound() {
  click(0.022, 0.035, 1300, 2.5, 0);
  tone(560, 300, 0.1, 0.05, "triangle");
}

export function playLaunchSound() {
  tone(440, 660, 0.09, 0.05, "sine", 0);
  tone(660, 990, 0.09, 0.055, "sine", 0.06);
  tone(880, 1320, 0.18, 0.065, "sine", 0.12);
  click(0.03, 0.04, 2600, 2, 0.12);
}

export function playBootChime(volume = 1) {
  tone(220, 220, 0.5, 0.045 * volume, "sine", 0);
  tone(277.18, 277.18, 0.5, 0.035 * volume, "sine", 0.03);
  tone(329.63, 329.63, 0.55, 0.04 * volume, "sine", 0.07);
  tone(440, 440, 0.65, 0.05 * volume, "sine", 0.12);
}
