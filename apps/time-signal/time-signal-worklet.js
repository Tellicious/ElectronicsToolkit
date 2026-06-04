// Multi-station time-signal carrier generator (AudioWorklet).
//
// Generates a clean sine sub-carrier and amplitude-modulates it sample-accurately
// from a per-second "segment program". Each second is an ordered list of
// {d: milliseconds, a: amplitude}; the analog amp/speaker then produces the
// real station frequency as a harmonic (or DAC image) of this sub-carrier.

class TimeSigProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sps = sampleRate;       // device sample rate (global in worklet scope)
    this.queue = [];             // pending minute frames (each = 60 segment-lists)
    this.current = null;
    this.pos = 0;                // sample index within the current minute
    this.phase = 0;              // carrier phase, [0,1)
    this.carrier = 19375;
    this.amp = 1.0;
    this.running = false;
    this.lowSignalled = false;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      switch (d.type) {
        case 'config':
          if (d.carrier != null) this.carrier = d.carrier;
          if (d.amp != null) this.amp = d.amp;
          break;
        case 'start':
          this.queue = [];
          this.current = d.frame || null;
          this.pos = (d.startSecond || 0) * this.sps;
          this.running = true; this.lowSignalled = false;
          break;
        case 'enqueue':
          if (d.frame) this.queue.push(d.frame);
          this.lowSignalled = false;
          break;
        case 'stop':
          this.running = false; this.current = null; this.queue = [];
          break;
      }
    };
  }

  // Amplitude of the given second's program at sample offset `within`.
  ampAt(second, within) {
    const segs = this.current[second];
    let acc = 0;
    for (let k = 0; k < segs.length; k++) {
      const n = (k === segs.length - 1) ? (this.sps - acc) : Math.round(segs[k].d / 1000 * this.sps);
      if (within < acc + n) return segs[k].a;
      acc += n;
    }
    return segs[segs.length - 1].a;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const ch = out[0], n = ch.length;
    if (!this.running) { ch.fill(0); return true; }

    const sps = this.sps, inc = this.carrier / sps, minuteSamples = 60 * sps;
    for (let i = 0; i < n; i++) {
      if (!this.current || this.pos >= minuteSamples) {
        const next = this.queue.shift();
        if (next) { this.current = next; this.pos = 0; }
        else { // underrun: hold a clean carrier until the next frame arrives
          ch[i] = this.amp * Math.sin(2 * Math.PI * this.phase);
          this.phase += inc; if (this.phase >= 1) this.phase -= 1;
          continue;
        }
      }
      const second = (this.pos / sps) | 0;
      const within = this.pos - second * sps;
      ch[i] = this.amp * this.ampAt(second, within) * Math.sin(2 * Math.PI * this.phase);
      this.phase += inc; if (this.phase >= 1) this.phase -= 1;
      this.pos++;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch);

    if (this.queue.length === 0 && !this.lowSignalled) {
      this.lowSignalled = true;
      this.port.postMessage({ type: 'needFrame' });
    }
    return true;
  }
}

registerProcessor('timesig-processor', TimeSigProcessor);
