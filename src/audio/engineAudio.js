import { audioConfig } from '../config/audio.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class EngineAudio {
  constructor() {
    this.context = null;
    this.volume = this.readStoredVolume();
    this.muted = localStorage.getItem('pitlane-audio-muted') === 'true';
    this.started = false;
    this.sampleSource = null;
    this.sampleGain = null;
    this.blipOffsetRpm = 0;
    this.lastTelemetryTime = 0;
    this.lastError = null;
    this.unlockAudio = () => this.start();
    window.addEventListener('pointerdown', this.unlockAudio, { once: true });
    window.addEventListener('keydown', this.unlockAudio, { once: true });
  }

  readStoredVolume() {
    const storedValue = localStorage.getItem('pitlane-audio-volume');
    if (storedValue === null) return audioConfig.initialVolume;
    const stored = Number(storedValue);
    return Number.isFinite(stored) ? clamp(stored, 0, 1) : audioConfig.initialVolume;
  }

  start() {
    if (this.started) {
      if (this.context.state === 'suspended') {
        this.context.resume().catch((error) => this.reportError('resume audio', error));
      }
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      this.reportError('initialize audio', new Error('Web Audio API is not supported by this browser.'));
      return;
    }

    this.context = new AudioContextConstructor();
    const context = this.context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = audioConfig.compressorThresholdDb;
    this.compressor.ratio.value = audioConfig.compressorRatio;
    this.compressor.attack.value = audioConfig.compressorAttackSeconds;
    this.compressor.release.value = audioConfig.compressorReleaseSeconds;
    this.masterGain = context.createGain();
    this.muteGain = context.createGain();
    this.engineGain = context.createGain();
    this.intakeFilter = context.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = audioConfig.intakeFilterHz;
    this.exhaustFilter = context.createBiquadFilter();
    this.exhaustFilter.type = 'lowpass';
    this.exhaustFilter.frequency.value = audioConfig.exhaustFilterHz;
    this.intakeGain = context.createGain();
    this.exhaustGain = context.createGain();
    this.firingGain = context.createGain();
    this.sampleGain = context.createGain();
    this.masterGain.gain.value = this.volume * audioConfig.masterGain;
    this.muteGain.gain.value = this.muted ? 0 : 1;
    this.engineGain.gain.value = 0.5;

    this.masterGain.connect(this.muteGain);
    this.muteGain.connect(this.compressor);
    this.compressor.connect(context.destination);
    this.intakeFilter.connect(this.intakeGain);
    this.exhaustFilter.connect(this.exhaustGain);
    this.intakeGain.connect(this.engineGain);
    this.exhaustGain.connect(this.engineGain);
    this.firingGain.connect(this.engineGain);
    this.sampleGain.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.harmonics = audioConfig.oscillatorHarmonics.map((harmonic) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = harmonic.type;
      oscillator.frequency.value = audioConfig.minimumRpm / 60 * harmonic.multiple;
      gain.gain.value = harmonic.gain;
      oscillator.connect(gain);
      gain.connect(this.firingGain);
      oscillator.start();
      return { ...harmonic, oscillator, useFiringFrequency: true };
    });

    const firingFrequency = audioConfig.minimumRpm / 30;
    audioConfig.firingOrder.forEach((cylinder, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = audioConfig.idleFiringFrequencyHz
        * audioConfig.crankOrderMultipliers[index];
      gain.gain.value = audioConfig.firingCylinderGain * (1 + cylinder * audioConfig.cylinderBalanceGain);
      oscillator.connect(gain);
      gain.connect(this.firingGain);
      oscillator.start(context.currentTime, index / audioConfig.firingOrder.length / firingFrequency);
      this.harmonics.push({
        oscillator,
        multiple: audioConfig.crankOrderMultipliers[index],
        useFiringFrequency: true,
      });
    });

    const noiseBuffer = context.createBuffer(
      1,
      Math.round(context.sampleRate * audioConfig.noiseBufferSeconds),
      context.sampleRate,
    );
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseData.length; index += 1) {
      noiseData[index] = Math.random() * 2 - 1;
    }
    this.noiseSource = context.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.intakeFilter);
    this.noiseSource.connect(this.exhaustFilter);
    this.noiseSource.start();
    this.started = true;
    console.info('[Engine audio] Synthesized inline-four engine initialized.');
    context.resume().catch((error) => this.reportError('resume audio', error));

    if (audioConfig.sampleUrl) {
      this.loadLoop(audioConfig.sampleUrl).catch((error) => {
        this.reportError('load engine sample', error);
      });
    }
  }

  async loadLoop(url) {
    this.start();
    if (!this.context) return;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Engine sample request failed with HTTP ${response.status}: ${url}`);
    }
    const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    this.sampleSource?.stop();
    this.sampleSource = this.context.createBufferSource();
    this.sampleSource.buffer = buffer;
    this.sampleSource.loop = true;
    this.sampleSource.connect(this.sampleGain);
    this.sampleSource.start();
    console.info('[Engine audio] Recorded engine loop loaded:', url);
  }

  setTelemetry({ rpm, throttle, gear }) {
    if (!this.started) return;
    const context = this.context;
    const now = context.currentTime;
    if (now - this.lastTelemetryTime < 1 / audioConfig.audioUpdateHz) return;
    const elapsed = this.lastTelemetryTime === 0 ? 0 : now - this.lastTelemetryTime;
    this.lastTelemetryTime = now;
    const engineRpm = clamp(
      rpm + this.blipOffsetRpm,
      audioConfig.minimumRpm,
      audioConfig.maximumRpm,
    );
    const firingFrequency = audioConfig.idleFiringFrequencyHz
      * engineRpm / audioConfig.minimumRpm;
    const throttleAmount = clamp(throttle, 0, 1);
    for (const harmonic of this.harmonics) {
      harmonic.oscillator.frequency.setTargetAtTime(
        (harmonic.useFiringFrequency ? firingFrequency : engineRpm / 60) * harmonic.multiple,
        now,
        audioConfig.frequencySmoothingSeconds,
      );
    }
    this.intakeFilter.frequency.setTargetAtTime(
      audioConfig.intakeFilterHz * (1 + throttleAmount * audioConfig.intakeThrottleFilterRange),
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    this.exhaustFilter.frequency.setTargetAtTime(
      audioConfig.exhaustFilterHz * (1 + throttleAmount * audioConfig.exhaustThrottleFilterRange),
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    this.intakeGain.gain.setTargetAtTime(
      audioConfig.intakeMix * (audioConfig.throttleVolumeFloor + throttleAmount),
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    this.exhaustGain.gain.setTargetAtTime(
      audioConfig.exhaustMix * (audioConfig.closedThrottleVolume
        + throttleAmount * (audioConfig.openThrottleVolume - audioConfig.closedThrottleVolume)),
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    this.firingGain.gain.setTargetAtTime(
      audioConfig.firingPulseMix * (audioConfig.throttleVolumeFloor + throttleAmount * 0.7),
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    this.engineGain.gain.setTargetAtTime(
      gear > 0 ? audioConfig.masterEngineMix : 0,
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    this.sampleSource?.playbackRate.setTargetAtTime(
      engineRpm / audioConfig.sampleReferenceRpm,
      now,
      audioConfig.frequencySmoothingSeconds,
    );
    if (this.blipOffsetRpm > 0) {
      this.blipOffsetRpm *= Math.exp(-elapsed / audioConfig.downshiftBlipDurationSeconds);
      if (this.blipOffsetRpm < audioConfig.blipEndThresholdRpm) this.blipOffsetRpm = 0;
    }
  }

  setVolume(value) {
    this.volume = clamp(Number(value), 0, 1);
    localStorage.setItem('pitlane-audio-volume', String(this.volume));
    if (this.started) {
      this.masterGain.gain.setTargetAtTime(
        this.volume * audioConfig.masterGain,
        this.context.currentTime,
        audioConfig.frequencySmoothingSeconds,
      );
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('pitlane-audio-muted', String(this.muted));
    if (this.started) {
      this.muteGain.gain.setTargetAtTime(
        this.muted ? 0 : 1,
        this.context.currentTime,
        audioConfig.frequencySmoothingSeconds,
      );
    }
    return this.muted;
  }

  triggerShift(direction, rpm) {
    if (!this.started || !direction) return;
    const context = this.context;
    const now = context.currentTime;
    if (direction > 0) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(audioConfig.shiftPopFrequencyHz, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        audioConfig.shiftPopFrequencyHz * audioConfig.shiftPopPitchFall,
        now + audioConfig.shiftPopDurationSeconds,
      );
      gain.gain.setValueAtTime(audioConfig.shiftPopGain, now);
      gain.gain.exponentialRampToValueAtTime(
        audioConfig.shiftPopEndGain,
        now + audioConfig.shiftPopDurationSeconds,
      );
      oscillator.connect(gain);
      gain.connect(this.masterGain);
      oscillator.start(now);
      oscillator.stop(now + audioConfig.shiftPopDurationSeconds);
      return;
    }
    this.blipOffsetRpm = Math.max(
      this.blipOffsetRpm,
    Math.min(
      audioConfig.downshiftBlipMaximumRpm,
      rpm + rpm * (audioConfig.downshiftBlipMultiplier - 1) * audioConfig.downshiftBlipGain,
    ) - rpm,
    );
  }

  reportError(action, error) {
    this.lastError = error;
    console.error(`[Engine audio] Could not ${action}:`, error);
  }
}
