import { controlConfig } from '../config/controls.js';
import { simulationConfig } from '../config/simulation.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class RideControls {
  constructor(onReset = () => {}) {
    this.keys = controlConfig.keys;
    this.gamepad = controlConfig.gamepad;
    this.downKeys = new Set();
    this.edgeKeys = new Set();
    this.onReset = onReset;

    window.addEventListener('keydown', (event) => {
      if (event.code === this.keys.frontBrake) event.preventDefault();
      if (!event.repeat) this.edgeKeys.add(event.code);
      this.downKeys.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.downKeys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.downKeys.clear();
      this.edgeKeys.clear();
    });
  }

  consumeEdge(key) {
    if (!this.edgeKeys.has(key)) return false;
    this.edgeKeys.delete(key);
    return true;
  }

  isDown(key) {
    return Array.isArray(key)
      ? key.some((code) => this.downKeys.has(code))
      : this.downKeys.has(key);
  }

  consumeAnyEdge(key) {
    return (Array.isArray(key) ? key : [key]).some((code) => this.consumeEdge(code));
  }

  sample() {
    const pad = navigator.getGamepads?.()[simulationConfig.gamepadIndex] ?? null;
    const button = (index) => pad?.buttons[index]?.value ?? 0;
    let steer = Number(this.isDown(this.keys.steerRight)) - Number(this.isDown(this.keys.steerLeft));
    let throttle = Number(this.isDown(this.keys.throttle));
    let rearBrake = Number(this.isDown(this.keys.rearBrake));
    let frontBrake = Number(this.isDown(this.keys.frontBrake));
    let shiftUp = this.consumeAnyEdge(this.keys.shiftUp);
    let shiftDown = this.consumeAnyEdge(this.keys.shiftDown);
    let reset = this.consumeEdge(this.keys.reset);
    const muteToggle = this.consumeEdge(this.keys.muteAudio);

    if (pad?.connected) {
      const axis = pad.axes[this.gamepad.steeringAxis] ?? 0;
      const deadZone = this.gamepad.deadZone;
      const analogSteer = Math.abs(axis) <= deadZone
        ? 0
        : Math.sign(axis) * clamp((Math.abs(axis) - deadZone) / (1 - deadZone), 0, 1);
      if (Math.abs(analogSteer) > Math.abs(steer)) steer = analogSteer;
      throttle = Math.max(throttle, button(this.gamepad.throttleButton));
      rearBrake = Math.max(rearBrake, button(this.gamepad.rearBrakeButton));
      frontBrake = Math.max(frontBrake, button(this.gamepad.frontBrakeButton));
      shiftUp ||= button(this.gamepad.shiftUpButton) > 0.6 && !this.previousShiftUp;
      shiftDown ||= button(this.gamepad.shiftDownButton) > 0.6 && !this.previousShiftDown;
      reset ||= button(9) > 0.6 && !this.previousReset;
      this.previousShiftUp = button(this.gamepad.shiftUpButton) > 0.6;
      this.previousShiftDown = button(this.gamepad.shiftDownButton) > 0.6;
      this.previousReset = button(9) > 0.6;
    }

    if (reset) this.onReset();
    return { throttle, frontBrake, rearBrake, steer, shiftUp, shiftDown, muteToggle };
  }
}
