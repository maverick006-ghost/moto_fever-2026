import { bikeConfig } from '../config/bike.js';
import { measurementConfig } from '../config/measurement.js';
import { simulationConfig } from '../config/simulation.js';
import { RideModel } from './rideModel.js';

const dt = 1 / simulationConfig.fixedHz;
const makeInput = (overrides = {}) => ({
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  steer: 0,
  shiftUp: false,
  shiftDown: false,
  ...overrides,
});
function runAccelerationAndTopSpeed() {
  const model = new RideModel();
  let timeTo100Seconds = null;
  let maximumSpeedMPerS = 0;
  let shiftArmed = true;
  const maximumSteps = Math.ceil(measurementConfig.maximumSpeedRunSeconds / dt);
  const zeroTo100Limit = Math.ceil(measurementConfig.accelerationMaximumSeconds / dt);
  for (let tick = 0; tick < maximumSteps; tick += 1) {
    const state = model.current;
    const shiftUp = shiftArmed
      && state.rpm >= bikeConfig.engine.upshiftRpm
      && state.gear < bikeConfig.engine.gearRatios.length;
    if (shiftUp) shiftArmed = false;
    if (state.rpm < bikeConfig.engine.upshiftRpm - simulationConfig.shiftRearmRpmBelowUpshift) {
      shiftArmed = true;
    }
    model.step(makeInput({ throttle: 1, shiftUp }), dt);
    maximumSpeedMPerS = Math.max(maximumSpeedMPerS, model.current.speed);
    if (timeTo100Seconds === null
      && model.current.speed >= measurementConfig.accelerationTargetSpeedKmh / 3.6) {
      timeTo100Seconds = (tick + 1) * dt;
    }
  }
  return {
    zeroTo100Seconds: timeTo100Seconds,
    topSpeedKmh: maximumSpeedMPerS * 3.6,
  };
}

function runFullBrakeTest() {
  const model = new RideModel();
  const startSpeed = measurementConfig.brakingStartSpeedKmh / 3.6;
  model.current.speed = startSpeed;
  model.current.rearWheelOmega = startSpeed / bikeConfig.wheelRadiusMeters.rear;
  let distanceMeters = 0;
  let elapsedSeconds = 0;
  let peakDecelerationG = 0;
  while (model.current.speed > measurementConfig.brakingStopSpeedMPerS
    && elapsedSeconds < measurementConfig.accelerationMaximumSeconds) {
    const speedBefore = model.current.speed;
    model.step(makeInput({ frontBrake: 1, rearBrake: 1 }), dt);
    distanceMeters += (speedBefore + model.current.speed) * 0.5 * dt;
    peakDecelerationG = Math.max(
      peakDecelerationG,
      -model.current.longitudinalAcceleration / simulationConfig.gravityMPerS2,
    );
    elapsedSeconds += dt;
  }
  return {
    distanceMeters,
    timeSeconds: elapsedSeconds,
    peakDecelerationG,
  };
}

function runSteadyTurn(speedKmh) {
  const model = new RideModel();
  const speed = speedKmh / 3.6;
  const sampleCount = Math.ceil(measurementConfig.steadyTurnAverageSeconds / dt);
  const totalSteps = Math.ceil(measurementConfig.steadyTurnTestSeconds / dt);
  const leanSamples = [];
  const yawSamples = [];
  for (let tick = 0; tick < totalSteps; tick += 1) {
    model.current.speed = speed;
    model.current.rearWheelOmega = speed / bikeConfig.wheelRadiusMeters.rear;
    model.step(makeInput({ steer: measurementConfig.steeringInputForMaximumLean }), dt);
    if (tick >= totalSteps - sampleCount) {
      leanSamples.push(Math.abs(model.current.lean));
      yawSamples.push(Math.abs(model.current.yawRate));
    }
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const leanRadians = mean(leanSamples);
  const yawRate = mean(yawSamples);
  return {
    leanDegrees: leanRadians * 180 / Math.PI,
    turnRadiusMeters: yawRate > 0 ? speed / yawRate : Number.POSITIVE_INFINITY,
    settledLeanRadians: leanRadians,
  };
}

function runLeanTimeTest(targetLeanRadians) {
  const model = new RideModel();
  const speed = measurementConfig.leanTimeTestSpeedKmh / 3.6;
  model.current.speed = speed;
  model.current.rearWheelOmega = speed / bikeConfig.wheelRadiusMeters.rear;
  const target = targetLeanRadians * measurementConfig.leanTimeTargetFraction;
  const maximumTicks = Math.ceil(measurementConfig.accelerationMaximumSeconds / dt);
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    model.current.speed = speed;
    model.current.rearWheelOmega = speed / bikeConfig.wheelRadiusMeters.rear;
    model.step(makeInput({ steer: measurementConfig.steeringInputForMaximumLean }), dt);
    if (Math.abs(model.current.lean) >= target) return (tick + 1) * dt;
  }
  return null;
}

export function measureRideModel() {
  const performance = runAccelerationAndTopSpeed();
  const braking = runFullBrakeTest();
  const turns = new Map(measurementConfig.steadyTurnSpeedsKmh.map(
    (speed) => [speed, runSteadyTurn(speed)],
  ));
  return {
    ...performance,
    ...braking,
    maximumLeanAt60Degrees: turns.get(60).leanDegrees,
    maximumLeanAt100Degrees: turns.get(100).leanDegrees,
    maximumLeanAt150Degrees: turns.get(150).leanDegrees,
    turnRadiusAt60Meters: turns.get(60).turnRadiusMeters,
    turnRadiusAt100Meters: turns.get(100).turnRadiusMeters,
    timeTo90PercentLeanSeconds: runLeanTimeTest(turns.get(60).settledLeanRadians),
  };
}
