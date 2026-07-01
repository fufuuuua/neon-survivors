/**
 * AudioFx.js — 基于 Web Audio API 的程序化音效合成器。
 * 无需任何音频资源文件，所有音效实时合成，体积为零。
 */
export class AudioFx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.35;
  }

  /** 首次用户交互后初始化（浏览器自动播放策略要求） */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  _resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  /**
   * 合成一个带包络的音调。
   * @param {object} o type, freq, freqEnd, dur, vol, attack
   */
  tone({ type = "sine", freq = 440, freqEnd = null, dur = 0.15, vol = 1, attack = 0.005 }) {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 白噪声爆裂（爆炸/受伤用） */
  noise({ dur = 0.2, vol = 0.6, freq = 1200 }) {
    if (!this.enabled || !this.ctx) return;
    this._resume();
    const t = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  // ---- 语义化音效 ----
  shoot()   { this.tone({ type: "square", freq: 720, freqEnd: 280, dur: 0.08, vol: 0.18 }); }
  hit()     { this.tone({ type: "triangle", freq: 220, freqEnd: 90, dur: 0.06, vol: 0.18 }); }
  kill()    { this.noise({ dur: 0.18, vol: 0.22, freq: 900 }); }
  hurt()    { this.tone({ type: "sawtooth", freq: 160, freqEnd: 60, dur: 0.3, vol: 0.3 }); this.noise({ dur: 0.2, vol: 0.2, freq: 600 }); }
  pickup()  { this.tone({ type: "sine", freq: 880, freqEnd: 1320, dur: 0.08, vol: 0.12 }); }
  levelup() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.tone({ type: "square", freq: f, dur: 0.16, vol: 0.18 }), i * 80));
  }
  nova()    { this.tone({ type: "sawtooth", freq: 400, freqEnd: 1200, dur: 0.25, vol: 0.22 }); }
  bossAttack() { this.tone({ type: "square", freq: 180, freqEnd: 420, dur: 0.3, vol: 0.16 }); }
  bossKill() {
    // 厚重轰鸣 + 上行胜利音阶
    this.noise({ dur: 0.7, vol: 0.4, freq: 600 });
    this.tone({ type: "sawtooth", freq: 90, freqEnd: 40, dur: 0.8, vol: 0.3 });
    [262, 330, 392, 523, 659, 784].forEach((f, i) =>
      setTimeout(() => this.tone({ type: "square", freq: f, dur: 0.22, vol: 0.2 }), i * 75));
  }
  gameover(){ [440, 330, 220, 110].forEach((f, i) =>
      setTimeout(() => this.tone({ type: "sawtooth", freq: f, dur: 0.4, vol: 0.25 }), i * 160)); }
}
