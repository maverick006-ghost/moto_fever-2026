import { bikeConfig } from '../config/bike.js';
import { simulationConfig } from '../config/simulation.js';
import { suspensionConfig } from '../config/suspension.js';
import { tyreConfig } from '../config/tyres.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const driveRatio = (gear) => bikeConfig.engine.primaryDriveRatio
  * bikeConfig.engine.gearRatios[gear - 1]
  * bikeConfig.engine.finalDriveRatio;

function torqueAtRpm(rpm) {
  const curve = bikeConfig.engine.torqueCurve;
  if (rpm <= curve[0].rpm) return curve[0].torqueNm;
  for (let index = 1; index < curve.length; index += 1) {
    const upper = curve[index];
    if (rpm <= upper.rpm) {
      const lower = curve[index - 1];
      return lerp(
        lower.torqueNm,
        upper.torqueNm,
        (rpm - lower.rpm) / (upper.rpm - lower.rpm),
      );
    }
  }
  return curve.at(-1).torqueNm;
}

function makeInitialState() {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    yawRate: 0,
    speed: 0,
    lateralVelocity: 0,
    lean: 0,
    leanRate: 0,
    steeringAngle: 0,
    counterSteerBarAngle: 0,
    previousSteer: 0,
    gear: 1,
    rpm: bikeConfig.engine.idleRpm,
    rearWheelOmega: 0,
    frontWheelAngle: 0,
    rearWheelAngle: 0,
    frontCompression: suspensionConfig.front.sagMeters,
    rearCompression: suspensionConfig.rear.sagMeters,
    frontCompressionRate: 0,
    rearCompressionRate: 0,
    frontLoadNewtons: 0,
    rearLoadNewtons: 0,
    frontSlip: 0,
    rearSlip: 0,
    frontGripCoefficient: 0,
    rearGripCoefficient: 0,
    frontGripUtilization: 0,
    rearGripUtilization: 0,
    frontAbsActive: false,
    rearAbsActive: false,
    frontSliding: false,
    rearSliding: false,
    shiftCutRemaining: 0,
    lastShiftDirection: 0,
    chassisVerticalOffset: 0,
    engineTorqueNm: 0,
    longitudinalAcceleration: 0,
  };
}

export class RideModel {
  constructor(surfaceName = tyreConfig.activeSurface) {
    this.surfaceName = surfaceName;
    this.tyres = tyreConfig.surfaces[surfaceName];
    if (!this.tyres?.front || !this.tyres?.rear) {
      throw new Error(`Tire tuning for the "${surfaceName}" surface has not been configured.`);
    }
    this.fixedSeconds = 1 / simulationConfig.fixedHz;
    this.current = makeInitialState();
    this.previous = { ...this.current };
    this.reset();
  }

  reset() {
    this.current = makeInitialState();
    const staticWeight = bikeConfig.massKg * simulationConfig.gravityMPerS2;
    this.current.frontLoadNewtons = staticWeight * bikeConfig.frontStaticLoadFraction;
    this.current.rearLoadNewtons = staticWeight - this.current.frontLoadNewtons;
    this.previous = { ...this.current };
  }

  step(input, dt, groundHeight = () => 0) {
    const state = this.current;
    this.previous = { ...state };
    const throttle = clamp(input.throttle ?? 0, 0, 1);
    const frontBrake = clamp(input.frontBrake ?? 0, 0, 1);
    const rearBrake = clamp(input.rearBrake ?? 0, 0, 1);
    const steer = clamp(input.steer ?? 0, -1, 1);
    state.lastShiftDirection = 0;

    if (input.shiftUp && state.gear < bikeConfig.engine.gearRatios.length) {
      state.gear += 1;
      state.shiftCutRemaining = bikeConfig.engine.shiftClutchCutSeconds;
      state.lastShiftDirection = 1;
    } else if (input.shiftDown && state.gear > 1) {
      state.gear -= 1;
      state.shiftCutRemaining = bikeConfig.engine.shiftClutchCutSeconds;
      state.lastShiftDirection = -1;
    }
    state.shiftCutRemaining = Math.max(0, state.shiftCutRemaining - dt);

    const ratio = driveRatio(state.gear);
    const wheelRpm = Math.abs(state.rearWheelOmega) * 60 / (2 * Math.PI);
    state.rpm = clamp(
      wheelRpm * ratio,
      bikeConfig.engine.idleRpm,
      bikeConfig.engine.maximumRpm,
    );
    const speedLimit = bikeConfig.electronicSpeedLimitKmh / 3.6;
    const limiter = state.speed >= speedLimit
      ? 0
      : clamp((speedLimit - state.speed) / bikeConfig.engine.speedLimiterRampMPerS, 0, 1);
    const clutchEngagement = state.shiftCutRemaining > 0 ? 0 : 1;
    state.engineTorqueNm = state.rpm >= bikeConfig.engine.redlineRpm
      ? 0
      : torqueAtRpm(state.rpm) * throttle * clutchEngagement * limiter;
    const driveForce = state.engineTorqueNm * ratio * bikeConfig.engine.drivetrainEfficiency
      / bikeConfig.wheelRadiusMeters.rear;
    const engineBrakeFade = clamp(
      state.rpm / bikeConfig.engine.engineBrakeRpmFadeStart,
      0,
      1,
    );
    const engineBrakeForce = throttle < bikeConfig.engine.closedThrottleThreshold
      ? bikeConfig.engine.engineBrakeTorqueNm * ratio * bikeConfig.engine.drivetrainEfficiency
        * engineBrakeFade / bikeConfig.wheelRadiusMeters.rear
      : 0;

    const forwardX = Math.sin(state.yaw);
    const forwardZ = -Math.cos(state.yaw);
    const frontX = state.x + forwardX * bikeConfig.wheelbaseMeters * bikeConfig.frontStaticLoadFraction;
    const frontZ = state.z + forwardZ * bikeConfig.wheelbaseMeters * bikeConfig.frontStaticLoadFraction;
    const rearX = state.x - forwardX * bikeConfig.wheelbaseMeters * (1 - bikeConfig.frontStaticLoadFraction);
    const rearZ = state.z - forwardZ * bikeConfig.wheelbaseMeters * (1 - bikeConfig.frontStaticLoadFraction);
    const frontRoadHeight = groundHeight(frontX, frontZ);
    const rearRoadHeight = groundHeight(rearX, rearZ);

    if (Math.abs(steer - state.previousSteer) > bikeConfig.steeringInputDeltaThreshold) {
      state.counterSteerBarAngle = -(steer - state.previousSteer)
        * bikeConfig.maximumSteeringAngleRadians
        * simulationConfig.counterSteerBarGain;
    } else {
      state.counterSteerBarAngle *= Math.exp(-dt / simulationConfig.counterSteerDecaySeconds);
    }
    state.previousSteer = steer;
    state.steeringAngle = steer * bikeConfig.maximumSteeringAngleRadians
      + state.counterSteerBarAngle;

    const staticWeight = bikeConfig.massKg * simulationConfig.gravityMPerS2;
    const frontStaticLoad = staticWeight * bikeConfig.frontStaticLoadFraction;
    const longitudinalLoadTransfer = bikeConfig.massKg
      * state.longitudinalAcceleration
      * bikeConfig.centerOfMassHeightMeters
      / bikeConfig.wheelbaseMeters
      * simulationConfig.tireLoadTransferResponse;
    const minimumAxleLoad = staticWeight * simulationConfig.minimumAxleLoadFraction;
    const frontLoad = clamp(
      frontStaticLoad - longitudinalLoadTransfer,
      minimumAxleLoad,
      staticWeight - minimumAxleLoad,
    );
    const rearLoad = staticWeight - frontLoad;
    const leanFraction = Math.abs(state.lean) / simulationConfig.maximumLeanRadians;
    const frontGripScale = clamp(
      (frontLoad / frontStaticLoad) ** this.tyres.front.loadSensitivityExponent,
      this.tyres.front.minimumLoadScale,
      this.tyres.front.maximumLoadScale,
    ) * (1 - this.tyres.front.leanGripLoss * leanFraction ** 2);
    const rearGripScale = clamp(
      (rearLoad / (staticWeight - frontStaticLoad)) ** this.tyres.rear.loadSensitivityExponent,
      this.tyres.rear.minimumLoadScale,
      this.tyres.rear.maximumLoadScale,
    ) * (1 - this.tyres.rear.leanGripLoss * leanFraction ** 2);
    const frontCapacity = Math.max(0, frontLoad * this.tyres.front.frictionCoefficient * frontGripScale);
    const rearCapacity = Math.max(0, rearLoad * this.tyres.rear.frictionCoefficient * rearGripScale);

    const speedForTurn = Math.max(state.speed, simulationConfig.lowSpeedSteeringMPerS);
    const intendedSteeringAngle = steer * bikeConfig.maximumSteeringAngleRadians;
    const desiredYawRate = state.speed < simulationConfig.lowSpeedSteeringMPerS
      ? steer * state.speed / bikeConfig.wheelbaseMeters * simulationConfig.lowSpeedSteeringGain
      : state.speed * Math.tan(intendedSteeringAngle) / bikeConfig.wheelbaseMeters;
    const desiredLean = Math.atan((state.speed * desiredYawRate) / simulationConfig.gravityMPerS2);
    const effectiveFriction = (frontCapacity + rearCapacity) / Math.max(staticWeight, 1);
    const gripLeanLimit = Math.atan(effectiveFriction * simulationConfig.lateralGripReserve);
    const targetLean = clamp(
      desiredLean,
      -Math.min(simulationConfig.maximumLeanRadians, gripLeanLimit),
      Math.min(simulationConfig.maximumLeanRadians, gripLeanLimit),
    );
    const rollSpringTorque = simulationConfig.rollSpringNmPerRad * (targetLean - state.lean);
    const rollDampingTorque = -simulationConfig.rollDampingNmsPerRad * state.leanRate;
    const counterSteerTorque = -state.counterSteerBarAngle
      * simulationConfig.counterSteerRollGainNmPerRad;
    const rollAcceleration = (rollSpringTorque + rollDampingTorque + counterSteerTorque)
      / simulationConfig.rollInertiaKgM2;
    state.leanRate += rollAcceleration * dt;
    state.lean = clamp(
      state.lean + state.leanRate * dt,
      -simulationConfig.maximumLeanRadians,
      simulationConfig.maximumLeanRadians,
    );

    let desiredYawFromLean = state.speed > simulationConfig.lowSpeedSteeringMPerS
      ? simulationConfig.gravityMPerS2 * Math.tan(state.lean) / speedForTurn
      : desiredYawRate;
    const lateralDemand = bikeConfig.massKg * state.speed * desiredYawFromLean;
    const frontGripShare = frontCapacity / Math.max(frontCapacity + rearCapacity, 1);
    const frontLateralShare = clamp(
      lerp(
        simulationConfig.frontLateralLoadShare,
        frontGripShare,
        simulationConfig.lateralGripLoadDistribution,
      ),
      simulationConfig.minimumFrontLateralShare,
      simulationConfig.maximumFrontLateralShare,
    );
    const frontLateralDemand = lateralDemand * frontLateralShare;
    const rearLateralDemand = lateralDemand - frontLateralDemand;
    const frontLongitudinalCapacity = Math.sqrt(Math.max(0, frontCapacity ** 2 - frontLateralDemand ** 2));
    const rearLongitudinalCapacity = Math.sqrt(Math.max(0, rearCapacity ** 2 - rearLateralDemand ** 2));

    const frontBrakeRequest = frontBrake * bikeConfig.brakes.frontMaximumForceNewtons;
    const rearBrakeRequest = rearBrake * bikeConfig.brakes.rearMaximumForceNewtons;
    const maxBrakeForce = bikeConfig.massKg * simulationConfig.gravityMPerS2
      * bikeConfig.brakes.maximumDecelerationG;
    const requestedDriveForce = state.speed < speedLimit ? driveForce : 0;
    const rearBrakeAvailable = Math.min(rearBrakeRequest, rearLongitudinalCapacity);
    const frontBrakeAvailable = Math.min(frontBrakeRequest, frontLongitudinalCapacity);
    const totalBrakeForce = Math.min(frontBrakeAvailable + rearBrakeAvailable, maxBrakeForce);
    const frontBrakeForce = Math.min(
      frontBrakeAvailable,
      totalBrakeForce * bikeConfig.brakes.frontBrakeShare,
    );
    const rearBrakeForce = Math.min(rearBrakeAvailable, totalBrakeForce - frontBrakeForce);
    const effectiveEngineBrake = Math.min(
      engineBrakeForce,
      Math.max(0, rearLongitudinalCapacity - rearBrakeForce),
    );
    const rearLongitudinalDemand = requestedDriveForce - rearBrakeForce - effectiveEngineBrake;
    state.rearSliding = Math.abs(rearLateralDemand) > rearLongitudinalCapacity
      || (throttle > 0
        && rearLongitudinalDemand > rearLongitudinalCapacity * this.tyres.rear.slideThreshold);
    const driveDemand = Math.max(0, rearLongitudinalDemand);
    const driveGripLimit = rearLongitudinalCapacity
      * (state.rearSliding ? this.tyres.rear.slidingGripScale : 1);
    const accelerationDemand = Math.min(driveDemand, driveGripLimit);
    const rearLongitudinalForce = accelerationDemand - rearBrakeForce - effectiveEngineBrake;
    state.frontAbsActive = frontBrake > 0
      && frontBrakeRequest > frontLongitudinalCapacity * bikeConfig.brakes.absActivationFraction;
    state.rearAbsActive = rearBrake > 0
      && rearBrakeRequest > rearLongitudinalCapacity * bikeConfig.brakes.absActivationFraction;

    const actualFrontLateralCapacity = Math.sqrt(
      Math.max(0, frontCapacity ** 2 - frontBrakeForce ** 2),
    );
    const actualRearLateralCapacity = Math.sqrt(
      Math.max(0, rearCapacity ** 2 - rearLongitudinalForce ** 2),
    );
    const frontSlideThreshold = frontBrake > 0
      ? simulationConfig.frontUnderBrakeSlideBias
      : 1;
    const rearSlideThreshold = throttle > 0
      ? simulationConfig.rearUnderThrottleSlideBias
      : 1;
    const actualFrontLateralForce = clamp(
      frontLateralDemand,
      -actualFrontLateralCapacity * frontSlideThreshold,
      actualFrontLateralCapacity * frontSlideThreshold,
    );
    const actualRearLateralForce = clamp(
      rearLateralDemand,
      -actualRearLateralCapacity * rearSlideThreshold,
      actualRearLateralCapacity * rearSlideThreshold,
    );
    state.frontSliding = Math.abs(frontLateralDemand) > actualFrontLateralCapacity * frontSlideThreshold;
    state.rearSliding ||= Math.abs(rearLateralDemand) > actualRearLateralCapacity * rearSlideThreshold;
    const actualLateralForce = actualFrontLateralForce + actualRearLateralForce;
    const actualYawRate = state.speed > simulationConfig.lowSpeedSteeringMPerS
      ? actualLateralForce / (bikeConfig.massKg * state.speed)
      : desiredYawRate;
    const lateralForceDeficit = lateralDemand - actualLateralForce;
    state.lateralVelocity = clamp(
      state.lateralVelocity
        - (lateralForceDeficit / bikeConfig.massKg
          + state.lateralVelocity * simulationConfig.lateralSlideDampingPerSecond) * dt,
      -simulationConfig.maximumLateralSlideMPerS,
      simulationConfig.maximumLateralSlideMPerS,
    );

    const dragForce = 0.5
      * bikeConfig.aerodynamics.airDensityKgPerM3
      * bikeConfig.aerodynamics.dragAreaM2
      * state.speed ** 2;
    const rollingForce = state.speed > 0
      ? staticWeight * bikeConfig.aerodynamics.rollingResistanceCoefficient
      : 0;
    const longitudinalForce = accelerationDemand - frontBrakeForce - rearBrakeForce
      - effectiveEngineBrake - dragForce - rollingForce;
    state.longitudinalAcceleration = clamp(
      longitudinalForce / bikeConfig.massKg,
      -bikeConfig.brakes.maximumDecelerationG * simulationConfig.gravityMPerS2,
      simulationConfig.maximumAccelerationMPerS2,
    );
    state.speed = clamp(
      state.speed + state.longitudinalAcceleration * dt,
      0,
      speedLimit,
    );
    state.yawRate = actualYawRate;
    state.x += (Math.sin(state.yaw) * state.speed + Math.cos(state.yaw) * state.lateralVelocity) * dt;
    state.z += (-Math.cos(state.yaw) * state.speed + Math.sin(state.yaw) * state.lateralVelocity) * dt;
    state.yaw = wrapAngle(state.yaw + actualYawRate * dt);

    const expectedWheelOmega = state.speed / bikeConfig.wheelRadiusMeters.rear;
    const wheelSlipRatio = state.rearSliding && rearLongitudinalDemand > 0
      ? clamp(
        (rearLongitudinalDemand / Math.max(rearLongitudinalCapacity, 1)
          - this.tyres.rear.slideThreshold)
          / (1 - this.tyres.rear.slideThreshold),
        0,
        this.tyres.rear.maximumDrivenWheelSlipRatio,
      )
      : 0;
    const brakingSlip = bikeConfig.brakes.absSlipThreshold;
    state.rearWheelOmega = rearBrake > 0
      ? expectedWheelOmega * (1 - (state.rearAbsActive ? brakingSlip * bikeConfig.brakes.absPressureRelease : 0))
      : expectedWheelOmega * (1 + wheelSlipRatio);
    const slipDenominator = Math.max(state.speed, simulationConfig.lowSpeedSlipReferenceMPerS);
    state.rearSlip = rearBrake > 0
      ? clamp(Math.abs(expectedWheelOmega - state.rearWheelOmega) * bikeConfig.wheelRadiusMeters.rear / slipDenominator, 0, brakingSlip)
      : Math.max(wheelSlipRatio, state.rearSliding ? Math.abs(rearLateralDemand - actualRearLateralForce) / Math.max(rearCapacity, 1) : 0);
    state.frontSlip = frontBrake > 0
      ? (state.frontAbsActive ? brakingSlip * bikeConfig.brakes.absPressureRelease : 0)
      : Math.abs(frontLateralDemand - actualFrontLateralForce) / Math.max(frontCapacity, 1);
    state.frontGripUtilization = Math.hypot(frontLateralDemand, frontBrakeForce) / Math.max(frontCapacity, 1);
    state.rearGripUtilization = Math.hypot(rearLateralDemand, rearLongitudinalForce) / Math.max(rearCapacity, 1);
    state.frontGripCoefficient = this.tyres.front.frictionCoefficient * frontGripScale;
    state.rearGripCoefficient = this.tyres.rear.frictionCoefficient * rearGripScale;
    state.frontLoadNewtons = frontLoad;
    state.rearLoadNewtons = rearLoad;
    state.frontWheelAngle += (state.speed / bikeConfig.wheelRadiusMeters.front) * dt;
    state.rearWheelAngle += state.rearWheelOmega * dt;

    const frontBump = frontRoadHeight - Math.min(frontRoadHeight, rearRoadHeight);
    const rearBump = rearRoadHeight - Math.min(frontRoadHeight, rearRoadHeight);
    this.stepSuspension('front', frontLoad, frontBump, dt, state);
    this.stepSuspension('rear', rearLoad, rearBump, dt, state);
    const frontSagDelta = state.frontCompression - suspensionConfig.front.sagMeters;
    const rearSagDelta = state.rearCompression - suspensionConfig.rear.sagMeters;
    state.chassisVerticalOffset = -(frontSagDelta + rearSagDelta) * 0.5;
  }

  stepSuspension(axle, load, bumpHeight, dt, state) {
    const tuning = suspensionConfig[axle];
    const staticLoad = bikeConfig.massKg * simulationConfig.gravityMPerS2
      * (axle === 'front'
        ? bikeConfig.frontStaticLoadFraction
        : 1 - bikeConfig.frontStaticLoadFraction);
    const targetCompression = clamp(
      tuning.sagMeters + (load - staticLoad) / tuning.springRateNPerM
        + bumpHeight * simulationConfig.suspensionBumpResponse,
      0,
      tuning.travelMeters,
    );
    const compressionKey = `${axle}Compression`;
    const velocityKey = `${axle}CompressionRate`;
    const springForce = tuning.springRateNPerM * (targetCompression - state[compressionKey]);
    const damperForce = -tuning.dampingNsPerM * state[velocityKey];
    const acceleration = (springForce + damperForce) / tuning.unsprungMassKg;
    const nextVelocity = state[velocityKey] + acceleration * dt;
    state[compressionKey] = clamp(
      state[compressionKey] + nextVelocity * dt,
      0,
      tuning.travelMeters,
    );
    state[velocityKey] = state[compressionKey] === 0 || state[compressionKey] === tuning.travelMeters
      ? 0
      : nextVelocity;
  }
}

export function interpolateRideState(previous, current, alpha) {
  const state = { ...current };
  for (const key of [
    'x', 'z', 'speed', 'lateralVelocity', 'lean', 'leanRate', 'rpm',
    'frontCompression', 'rearCompression', 'chassisVerticalOffset',
  ]) {
    state[key] = lerp(previous[key], current[key], alpha);
  }
  state.yaw = previous.yaw + wrapAngle(current.yaw - previous.yaw) * alpha;
  state.frontWheelAngle = lerp(previous.frontWheelAngle, current.frontWheelAngle, alpha);
  state.rearWheelAngle = lerp(previous.rearWheelAngle, current.rearWheelAngle, alpha);
  return state;
}
