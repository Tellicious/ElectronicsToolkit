/* SensorKit — reusable FFT / spectrum module.
 *
 * Radix-2 Cooley–Tukey (size must be a power of two). Returns a single-sided
 * amplitude spectrum (a pure tone of amplitude A reads ~A at its bin, window
 * coherent-gain corrected), bin frequencies, and the strongest peaks with
 * parabolic interpolation and optional temporal smoothing.
 *
 *   const fft = new SensorKit.FFT({ size, sampleRate, window, coupling, peakCount, smoothing });
 *   const { mag, freqs, df, peaks } = fft.process(float32samples);
 *
 * Exposed as SensorKit.FFT (browser) and module.exports (node tests).
 */
(function (root) {
  'use strict';

  // Window generators w(n) for n in [0, N-1].
  const WINDOWS = {
    rectangular: () => 1,
    triangle: (n, N) => 1 - Math.abs((n - (N - 1) / 2) / ((N - 1) / 2)),       // Bartlett
    hanning: (n, N) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)),
    hamming: (n, N) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1)),
    blackman: (n, N) => 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (N - 1)),
    blackmanHarris: (n, N) => {
      const w = (2 * Math.PI * n) / (N - 1);
      return 0.35875 - 0.48829 * Math.cos(w) + 0.14128 * Math.cos(2 * w) - 0.01168 * Math.cos(3 * w);
    },
  };

  class FFT {
    constructor(opts = {}) {
      this.sampleRate = opts.sampleRate || 48000;
      this.size = opts.size || 2048;
      this.windowName = opts.window || 'hanning';
      this.coupling = opts.coupling || 'ac';        // 'ac' | 'dc'
      this.peakCount = opts.peakCount || 1;          // 1..5
      this.smoothing = opts.smoothing || 0;          // EMA factor 0..<1 on peak freqs
      this._smooth = null;
      this._prepare();
    }

    configure(opts = {}) {
      let reprep = false;
      if (opts.size && opts.size !== this.size) { this.size = opts.size; reprep = true; }
      if (opts.window && opts.window !== this.windowName) { this.windowName = opts.window; reprep = true; }
      if (opts.sampleRate && opts.sampleRate !== this.sampleRate) { this.sampleRate = opts.sampleRate; reprep = true; }
      if (opts.coupling) this.coupling = opts.coupling;
      if (opts.peakCount) this.peakCount = opts.peakCount;
      if (opts.smoothing != null) this.smoothing = opts.smoothing;
      if (reprep) { this._smooth = null; this._prepare(); }
    }

    _prepare() {
      const N = this.size;
      if ((N & (N - 1)) !== 0) throw new Error('FFT size must be a power of two');
      const wfn = WINDOWS[this.windowName] || WINDOWS.hanning;
      this.win = new Float32Array(N);
      let sum = 0;
      for (let n = 0; n < N; n++) { const w = wfn(n, N); this.win[n] = w; sum += w; }
      this.coherentGain = sum / N || 1;
      const bits = Math.round(Math.log2(N));
      this.rev = new Uint32Array(N);
      for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
      this.cos = new Float32Array(N / 2); this.sin = new Float32Array(N / 2);
      for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos((-2 * Math.PI * i) / N); this.sin[i] = Math.sin((-2 * Math.PI * i) / N); }
      this.re = new Float32Array(N); this.im = new Float32Array(N);
      this.mag = new Float32Array(N / 2);
      this.freqs = new Float32Array(N / 2);
      this.df = this.sampleRate / N;
      for (let k = 0; k < N / 2; k++) this.freqs[k] = k * this.df;
    }

    process(samples) {
      const N = this.size, re = this.re, im = this.im;
      const off = Math.max(0, samples.length - N);
      let mean = 0;
      if (this.coupling === 'ac') {
        for (let i = 0; i < N; i++) mean += (off + i < samples.length ? samples[off + i] : 0);
        mean /= N;
      }
      for (let i = 0; i < N; i++) {
        const s = (off + i < samples.length ? samples[off + i] : 0) - (this.coupling === 'ac' ? mean : 0);
        re[this.rev[i]] = s * this.win[i];
        im[this.rev[i]] = 0;
      }
      for (let len = 2; len <= N; len <<= 1) {
        const half = len >> 1, tstep = N / len;
        for (let i = 0; i < N; i += len) {
          for (let j = 0, t = 0; j < half; j++, t += tstep) {
            const c = this.cos[t], sn = this.sin[t];
            const a = i + j, b = a + half;
            const tre = re[b] * c - im[b] * sn;
            const tim = re[b] * sn + im[b] * c;
            re[b] = re[a] - tre; im[b] = im[a] - tim;
            re[a] += tre; im[a] += tim;
          }
        }
      }
      const mag = this.mag, corr = 2 / (N * this.coherentGain);
      for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) * corr;
      mag[0] *= 0.5; // DC bin is single-sided already
      return { mag, freqs: this.freqs, df: this.df, sampleRate: this.sampleRate, size: N, peaks: this._peaks(mag) };
    }

    _peaks(mag) {
      const cands = [];
      for (let k = 1; k < mag.length - 1; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) cands.push(k);
      cands.sort((a, b) => mag[b] - mag[a]);
      const top = cands.slice(0, this.peakCount).map(k => {
        const a = mag[k - 1], b = mag[k], c = mag[k + 1], denom = a - 2 * b + c;
        const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
        return { freq: (k + delta) * this.df, mag: b };
      });
      if (this.smoothing > 0 && top.length) {
        if (!this._smooth || this._smooth.length !== top.length) this._smooth = top.map(p => p.freq);
        const a = this.smoothing;
        top.forEach((p, i) => { this._smooth[i] = this._smooth[i] * a + p.freq * (1 - a); p.freq = this._smooth[i]; });
      } else { this._smooth = null; }
      return top;
    }
  }

  FFT.WINDOWS = Object.keys(WINDOWS);
  if (typeof module !== 'undefined' && module.exports) module.exports = { FFT };
  root.SensorKit = root.SensorKit || {};
  root.SensorKit.FFT = FFT;
})(typeof window !== 'undefined' ? window : globalThis);
