import { bikeConfig } from './config/bike.js';
import { audioConfig } from './config/audio.js';
import { controlConfig } from './config/controls.js';
import { simulationConfig } from './config/simulation.js';
import { suspensionConfig } from './config/suspension.js';
import { trackConfig } from './config/track.js';
import { tyreConfig } from './config/tyres.js';
import { RideControls } from './physics/controls.js';
import { interpolateRideState, RideModel } from './physics/rideModel.js';
import { measureRideModel } from './physics/measurements.js';
import { EngineAudio } from './audio/engineAudio.js';

const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
  import('three'),
  import('three/addons/loaders/GLTFLoader.js'),
  import('three/addons/libs/meshopt_decoder.module.js'),
]);

const MODEL_URL = '/assets/models/bmw_s1000_rr.glb';
const LOD_MODEL_URL = '/assets/models/bmw_s1000_rr_lod.glb';

export function startViewer(app) {
  app.innerHTML = `
    <main class="viewer">
      <div class="scene" id="scene"></div>
      <header class="topbar">
        <a class="wordmark" href="/" aria-label="Pitlane home">PITLANE<span> / LAB</span></a>
        <div class="topbar-meta"><span class="live-dot"></span> RIDE MODEL <span class="separator">/</span> STEP 04</div>
        <div class="topbar-right"><button class="credits-button" id="settings-open" type="button">SETTINGS</button><button class="credits-button" id="credits-open" type="button">MODEL CREDITS</button><span>—</span> NON-COMMERCIAL</div>
      </header>

      <section class="intro">
        <p class="eyebrow">ROAD DYNAMICS / TEST SESSION</p>
        <h1>RIDE MODEL</h1>
        <p class="subhead">Flat handling pad <span class="surface-tag">· ROAD TYRES</span></p>
      </section>

      <aside class="ride-hud">
        <div class="hud-header"><span>LIVE TELEMETRY</span><span class="state-chip" id="load-state">LOADING</span></div>
        <div class="load-progress"><span id="load-progress"></span></div>
        <p class="load-message" id="load-message">Reading binary glTF asset…</p>
        <div class="speed-row">
          <div><strong id="hud-speed">0</strong><span>KM/H</span></div>
          <div class="gear-display"><small>GEAR</small><strong id="hud-gear">1</strong></div>
        </div>
        <div class="rpm-row"><span>ENGINE RPM</span><strong id="hud-rpm">1,250</strong></div>
        <div class="rpm-track"><span id="rpm-bar"></span></div>
        <div class="lean-row"><span>LEAN</span><strong id="hud-lean">0.0°</strong></div>
        <div class="input-labels"><span>THROTTLE <b id="throttle-readout">0%</b></span><span>BRAKE <b id="brake-readout">0%</b></span></div>
        <div class="input-bars"><span id="throttle-bar"></span><span id="brake-bar"></span></div>
      </aside>

      <aside class="ride-debug" id="ride-debug" aria-label="Ride physics debug panel" hidden>
        <p class="debug-title">RIDE PHYSICS <span>F4</span></p>
        <div class="debug-grid">
          <span>FRONT SLIP</span><strong id="debug-front-slip">0%</strong>
          <span>REAR SLIP</span><strong id="debug-rear-slip">0%</strong>
          <span>LATERAL DRIFT</span><strong id="debug-lateral-drift">0.00 m/s</strong>
          <span>FRONT SUSPENSION</span><strong id="debug-front-suspension">0%</strong>
          <span>REAR SUSPENSION</span><strong id="debug-rear-suspension">0%</strong>
          <span>FRONT TYRE GRIP (μ)</span><strong id="debug-front-grip">0.00</strong>
          <span>REAR TYRE GRIP (μ)</span><strong id="debug-rear-grip">0.00</strong>
          <span>PHYSICS / STEP</span><strong id="debug-physics-time">0.00 ms</strong>
          <span>PHYSICS PEAK</span><strong id="debug-physics-peak">0.00 ms</strong>
          <span>SLIDE STATE</span><strong id="debug-slide">GRIPPED</strong>
          <span>ABS</span><strong id="debug-abs">OFF</strong>
        </div>
        <p class="debug-title measured-title">MEASURED PERFORMANCE <span>F4</span></p>
        <div class="debug-grid measurement-grid">
          <span>0–100 KM/H</span><strong id="measure-acceleration">—</strong>
          <span>TOP SPEED</span><strong id="measure-top-speed">—</strong>
          <span>100–0 KM/H</span><strong id="measure-braking">—</strong>
          <span>MAX LEAN · 60 KM/H</span><strong id="measure-lean-60">—</strong>
          <span>MAX LEAN · 100 KM/H</span><strong id="measure-lean-100">—</strong>
          <span>MAX LEAN · 150 KM/H</span><strong id="measure-lean-150">—</strong>
          <span>TURN RADIUS · 60 KM/H</span><strong id="measure-radius-60">—</strong>
          <span>TURN RADIUS · 100 KM/H</span><strong id="measure-radius-100">—</strong>
          <span>TIME TO FULL LEAN</span><strong id="measure-lean-time">—</strong>
        </div>
      </aside>

      <div class="ride-tools">
        <button class="action-button" id="reset-ride" type="button">RESET · R</button>
        <button class="action-button" id="camera-toggle" type="button">CAMERA · CHASE</button>
        <span class="track-label">TEST PAD · ROAD · 60 HZ</span>
      </div>

      <div class="error-box model-error" id="error-box" role="alert" hidden>
        <strong>MODEL LOAD FAILED</strong>
        <span id="error-message"></span>
        <button id="retry-button" type="button">RETRY LOAD</button>
      </div>

      <div class="control-hint">
        <span><b>W</b> THROTTLE</span><span><b>S</b> REAR BRAKE</span><span><b>SPACE</b> FRONT</span>
        <span><b>A / D</b> STEER</span><span><b>SHIFT / CTRL</b> GEAR</span><span><b>M</b> MUTE</span>
      </div>

      <aside class="stats-overlay" id="stats-overlay" aria-label="Performance statistics" hidden>
        <p class="stats-title">RENDER STATS <span>F3</span></p>
        <p><span>FPS</span><strong id="stats-fps">—</strong></p>
        <p><span>DRAW CALLS</span><strong id="stats-calls">—</strong></p>
        <p><span>TRIANGLES</span><strong id="stats-triangles">—</strong></p>
        <p><span>BIKE MESH</span><strong id="stats-bike-triangles">—</strong></p>
      </aside>

      <div class="credits-backdrop" id="credits-backdrop" hidden>
        <section class="credits-card" role="dialog" aria-modal="true" aria-labelledby="credits-title">
          <button class="credits-close" id="credits-close" type="button" aria-label="Close credits">×</button>
          <p class="eyebrow">ASSET ATTRIBUTION</p>
          <h2 id="credits-title">Model credits</h2>
          <p class="credit-name">BMW S1000 RR</p>
          <p>3D model by VTX (<a href="https://sketchfab.com/VTX_car" target="_blank" rel="noreferrer">Sketchfab profile</a>).</p>
          <p>Licensed under <strong>Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)</strong>.</p>
          <p><a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">Read the license</a></p>
          <p>Source: <a href="https://sketchfab.com/3d-models/bmw-s1000-rr-1873aed292d6465694119bd81860a0c2" target="_blank" rel="noreferrer">Sketchfab — BMW S1000 RR</a></p>
          <p class="credit-disclaimer">This non-commercial project is not affiliated with or endorsed by BMW. BMW marks and product identity appear only as present in the credited source model.</p>
        </section>
      </div>
      <div class="credits-backdrop" id="settings-backdrop" hidden>
        <section class="credits-card settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <button class="credits-close" id="settings-close" type="button" aria-label="Close settings">×</button>
          <p class="eyebrow">RIDE AUDIO</p>
          <h2 id="settings-title">Settings</h2>
          <label class="volume-setting" for="audio-volume">
            <span>ENGINE VOLUME</span><strong id="audio-volume-value">32%</strong>
            <input id="audio-volume" type="range" min="0" max="1" step="0.01" value="${audioConfig.initialVolume}">
          </label>
          <p class="audio-setting-note"><span id="audio-status">WAITING FOR INPUT</span> · Press <strong>M</strong> to mute or unmute.</p>
          <button class="action-button" id="audio-mute-toggle" type="button">MUTE AUDIO · M</button>
        </section>
      </div>

      <footer class="footer">
        <span id="camera-hint">CHASE CAMERA · SCROLL TO ADJUST DISTANCE</span>
        <span class="footer-center" id="lod-summary">FULL DETAIL SWITCH DISTANCE · ${bikeConfig.lodSwitchDistanceMeters.toFixed(2)} M</span>
        <span id="mesh-summary">AWAITING GEOMETRY</span>
      </footer>
    </main>
  `;

  const sceneElement = document.querySelector('#scene');
  const stateElement = document.querySelector('#load-state');
  const progressElement = document.querySelector('#load-progress');
  const messageElement = document.querySelector('#load-message');
  const errorBox = document.querySelector('#error-box');
  const errorMessage = document.querySelector('#error-message');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, simulationConfig.renderPixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  sceneElement.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#111518');
  scene.fog = new THREE.Fog('#111518', 80, 320);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 700);
  camera.position.set(0, 2.5, simulationConfig.cameraFollowDistanceMeters);

  scene.add(new THREE.HemisphereLight('#d8e6e8', '#22262a', 2.05));
  const keyLight = new THREE.DirectionalLight('#fff0d6', 3.2);
  keyLight.position.set(-5, 8, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight('#75d9e8', 2.1);
  rimLight.position.set(5, 4, -7);
  scene.add(rimLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshStandardMaterial({ color: '#151b1e', roughness: 0.92, metalness: 0.08 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(trackConfig.widthMeters, trackConfig.lengthMeters),
    new THREE.MeshStandardMaterial({ color: '#252b2e', roughness: 0.95, metalness: 0.015 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.01, -trackConfig.lengthMeters / 3);
  road.receiveShadow = true;
  scene.add(road);

  const trackMarkings = new THREE.Group();
  const laneMarkMaterial = new THREE.MeshBasicMaterial({ color: '#c4c9bd' });
  for (let z = -trackConfig.lengthMeters / 2; z < trackConfig.lengthMeters / 2; z += trackConfig.laneMarkingSpacingMeters) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(trackConfig.laneMarkWidthMeters, 0.008, trackConfig.laneMarkLengthMeters),
      laneMarkMaterial,
    );
    marker.position.set(0, 0.002, z - trackConfig.lengthMeters / 3);
    trackMarkings.add(marker);
  }
  const startLine = new THREE.Group();
  const startStripeMaterial = new THREE.MeshBasicMaterial({ color: '#e5e8dc' });
  const stripeCount = Math.ceil(trackConfig.widthMeters / trackConfig.startLineStripeWidthMeters);
  for (let index = 0; index < stripeCount; index += 1) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(
        trackConfig.startLineStripeWidthMeters * 0.5,
        0.014,
        trackConfig.startLineStripeDepthMeters,
      ),
      startStripeMaterial,
    );
    stripe.position.set(
      -trackConfig.widthMeters / 2 + (index + 0.5) * trackConfig.startLineStripeWidthMeters,
      0.006,
      -trackConfig.startLineDistanceMeters,
    );
    startLine.add(stripe);
  }
  scene.add(startLine, trackMarkings);

  const coneMaterial = new THREE.MeshStandardMaterial({ color: '#e67842', roughness: 0.74 });
  const coneBaseMaterial = new THREE.MeshStandardMaterial({ color: '#e3e1d7', roughness: 0.82 });
  for (const location of trackConfig.cones) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(trackConfig.coneRadiusMeters, trackConfig.coneHeightMeters, trackConfig.coneRadialSegments),
      coneMaterial,
    );
    cone.position.set(location.x, trackConfig.coneHeightMeters / 2, location.z);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(trackConfig.coneRadiusMeters * 1.24, trackConfig.coneRadiusMeters * 1.24, 0.08, trackConfig.coneRadialSegments),
      coneBaseMaterial,
    );
    base.position.set(location.x, 0.04, location.z);
    scene.add(cone, base);
  }

  const bikeRig = new THREE.Group();
  scene.add(bikeRig);
  const rideModel = new RideModel(trackConfig.surface);
  const engineAudio = new EngineAudio();
  const fixedSeconds = rideModel.fixedSeconds;
  let accumulator = 0;
  let lastFrameTime = performance.now();
  let lastTelemetryTime = 0;
  let lastAudioUpdateTime = 0;
  let latestInput = { throttle: 0, frontBrake: 0, rearBrake: 0, steer: 0, muteToggle: false };
  let queuedShiftUp = false;
  let queuedShiftDown = false;
  let averagePhysicsMs = 0;
  let physicsPeakMs = 0;
  let sampledPhysicsPeakMs = 0;
  let physicsSampleElapsed = 0;
  let physicsSampleCount = 0;
  let physicsSampleTotal = 0;
  let cameraMode = 'chase';
  let cameraDistance = simulationConfig.cameraFollowDistanceMeters;
  let cameraYawOffset = 0;
  let highDetailModel = null;
  let lowDetailModel = null;
  let modelScale = 1;
  let highDetailTriangles = 0;
  let lowDetailTriangles = 0;
  let activeLodName = '';
  let fullWheelNodes = [];
  let lodWheelNodes = [];
  const baseWheelRotations = new Map();
  const frontLocal = new THREE.Vector3();
  const rearLocal = new THREE.Vector3();
  const cameraDesired = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const cameraBehind = new THREE.Vector3();
  let renderFrames = 0;
  let lastStatsUpdate = performance.now();
  let modelRadius = 0;

  function showLoadError(error) {
    console.error('[Bike model] Load failed:', error);
    stateElement.textContent = 'ERROR';
    stateElement.classList.add('state-error');
    messageElement.textContent = 'The model could not be loaded.';
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
    progressElement.style.width = '100%';
    progressElement.classList.add('progress-error');
  }

  function formatVector(vector) {
    return `(${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)})`;
  }

  function findNamedParts(root) {
    const matches = { frontWheel: [], rearWheel: [] };
    root.traverse((node) => {
      const name = node.name.toLowerCase();
      if (name.startsWith('wheel_lf')) matches.frontWheel.push(node);
      if (name.startsWith('wheel_lr')) matches.rearWheel.push(node);
    });
    return matches;
  }

  function findWheelNodes(root) {
    const parts = findNamedParts(root);
    const pick = (nodes) => nodes.find((node) => node.isBone)
      ?? nodes.find((node) => node.children.length > 0)
      ?? nodes[0];
    return [pick(parts.frontWheel), pick(parts.rearWheel)].filter(Boolean);
  }

  function getWheelAxisCandidate(parts) {
    const bounds = (nodes) => {
      const result = new THREE.Box3();
      for (const node of nodes) {
        const nodeBounds = new THREE.Box3().setFromObject(node);
        if (!nodeBounds.isEmpty()) result.union(nodeBounds);
      }
      return result;
    };
    const frontBounds = bounds(parts.frontWheel);
    const rearBounds = bounds(parts.rearWheel);
    if (frontBounds.isEmpty() || rearBounds.isEmpty()) return null;
    const frontCenter = frontBounds.getCenter(new THREE.Vector3());
    const rearCenter = rearBounds.getCenter(new THREE.Vector3());
    const wheelDimensions = frontBounds.getSize(new THREE.Vector3());
    const axes = ['X', 'Y', 'Z'];
    const dimensions = [wheelDimensions.x, wheelDimensions.y, wheelDimensions.z];
    const axleAxis = axes[dimensions.indexOf(Math.min(...dimensions))];
    const separation = rearCenter.clone().sub(frontCenter);
    const axisDistances = [Math.abs(separation.x), Math.abs(separation.y), Math.abs(separation.z)];
    const longitudinalAxis = axes[axisDistances.indexOf(Math.max(...axisDistances))];
    return { frontCenter, rearCenter, separation, wheelbase: separation.length(), axleAxis, longitudinalAxis };
  }

  function modelTriangles(root) {
    let triangles = 0;
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      const count = node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0;
      triangles += count / 3;
    });
    return Math.round(triangles);
  }

  function transformModel(model, center, groundY) {
    model.scale.setScalar(modelScale);
    model.position.set(
      -center.x * modelScale,
      -groundY * modelScale - bikeConfig.centerOfMassHeightMeters,
      -center.z * modelScale,
    );
    model.updateMatrixWorld(true);
  }

  function saveWheelBaseRotations(nodes) {
    for (const node of nodes) baseWheelRotations.set(node, node.quaternion.clone());
  }

  function animateWheelNodes(nodes, frontAngle, rearAngle) {
    nodes.forEach((node, index) => {
      const base = baseWheelRotations.get(node);
      if (!base) return;
      const spin = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        index === 0 ? frontAngle : rearAngle,
      );
      node.quaternion.copy(base).multiply(spin);
    });
  }

  function updateLod() {
    if (!highDetailModel || !lowDetailModel) return;
    const useFullDetail = camera.position.distanceTo(bikeRig.position) <= bikeConfig.lodSwitchDistanceMeters;
    const nextLod = useFullDetail ? 'HD' : 'LOD';
    if (activeLodName === nextLod) return;
    activeLodName = nextLod;
    highDetailModel.visible = useFullDetail;
    lowDetailModel.visible = !useFullDetail;
    highDetailModel.visible = useFullDetail;
    lowDetailModel.visible = !useFullDetail;
    const activeModel = useFullDetail ? highDetailModel : lowDetailModel;
    let meshCount = 0;
    activeModel.traverse((node) => {
      if (node.isMesh && node.visible) meshCount += 1;
    });
    const activeTriangles = useFullDetail ? highDetailTriangles : lowDetailTriangles;
    document.querySelector('#mesh-summary').textContent =
      `${meshCount} MESHES  /  ${activeTriangles.toLocaleString()} TRIANGLES${useFullDetail ? ' · HD' : ' · LOD'}`;
  }

  function groundHeightAt(x, z) {
    let height = 0;
    for (const bump of trackConfig.roadBumps) {
      const normalizedDistance = Math.abs(z - bump.z) / bump.halfLength;
      if (normalizedDistance < 1 && Math.abs(x - bump.x) < bump.halfWidth) {
        height += bump.height * (1 - normalizedDistance);
      }
    }
    return height;
  }

  function resetBike() {
    rideModel.reset();
    accumulator = 0;
    const initial = rideModel.current;
    bikeRig.position.set(initial.x, bikeConfig.centerOfMassHeightMeters, initial.z);
    bikeRig.rotation.set(0, initial.yaw, 0);
    activeLodName = '';
    updateLod();
    console.info('[Ride physics] Reset to the start line, upright.');
  }

  function applyRideVisuals(state, realDelta) {
    bikeRig.position.set(
      state.x,
      bikeConfig.centerOfMassHeightMeters + state.chassisVerticalOffset,
      state.z,
    );
    bikeRig.rotation.set(0, state.yaw, -state.lean, 'YXZ');
    animateWheelNodes(fullWheelNodes, state.frontWheelAngle, state.rearWheelAngle);
    animateWheelNodes(lodWheelNodes, state.frontWheelAngle, state.rearWheelAngle);

    if (cameraMode === 'chase') {
      cameraForward.set(Math.sin(state.yaw), 0, -Math.cos(state.yaw));
      cameraBehind.set(-cameraForward.x, 0, -cameraForward.z);
      const offsetAngle = cameraYawOffset;
      cameraBehind.applyAxisAngle(new THREE.Vector3(0, 1, 0), offsetAngle);
      cameraTarget.set(state.x, bikeConfig.centerOfMassHeightMeters + simulationConfig.cameraFollowHeightMeters, state.z)
        .addScaledVector(cameraForward, simulationConfig.cameraLookAheadMeters);
      cameraDesired.copy(bikeRig.position)
        .addScaledVector(cameraBehind, cameraDistance)
        .add(new THREE.Vector3(0, simulationConfig.cameraFollowHeightMeters, 0));
      const followAmount = 1 - Math.exp(-simulationConfig.cameraFollowSmoothing * realDelta);
      camera.position.lerp(cameraDesired, followAmount);
      camera.lookAt(cameraTarget);
    } else {
      camera.position.set(
        state.x + cameraForward.x * simulationConfig.cameraCockpitForwardMeters,
        simulationConfig.cameraCockpitHeightMeters,
        state.z + cameraForward.z * simulationConfig.cameraCockpitForwardMeters,
      );
      cameraTarget.set(
        state.x + cameraForward.x * simulationConfig.cameraCockpitLookAheadMeters,
        simulationConfig.cameraCockpitHeightMeters,
        state.z + cameraForward.z * simulationConfig.cameraCockpitLookAheadMeters,
      );
      camera.lookAt(cameraTarget);
    }
    updateLod();
  }

  function updateHud(state, input) {
    const speedKmh = Math.round(state.speed * 3.6);
    document.querySelector('#hud-speed').textContent = speedKmh.toString();
    document.querySelector('#hud-gear').textContent = state.gear.toString();
    document.querySelector('#hud-rpm').textContent = Math.round(state.rpm).toLocaleString();
    document.querySelector('#rpm-bar').style.width =
      `${Math.min(state.rpm / bikeConfig.engine.redlineRpm, 1) * 100}%`;
    document.querySelector('#hud-lean').textContent = `${(state.lean * 180 / Math.PI).toFixed(1)}°`;
    document.querySelector('#throttle-readout').textContent = `${Math.round(input.throttle * 100)}%`;
    document.querySelector('#brake-readout').textContent =
      `${Math.round(Math.max(input.frontBrake, input.rearBrake) * 100)}%`;
    document.querySelector('#throttle-bar').style.width = `${input.throttle * 100}%`;
    document.querySelector('#brake-bar').style.width = `${Math.max(input.frontBrake, input.rearBrake) * 100}%`;

    if (!document.querySelector('#ride-debug').hidden) {
      const frontTravel = suspensionConfig.front.travelMeters;
      const rearTravel = suspensionConfig.rear.travelMeters;
      document.querySelector('#debug-front-slip').textContent = `${(state.frontSlip * 100).toFixed(0)}%`;
      document.querySelector('#debug-rear-slip').textContent = `${(state.rearSlip * 100).toFixed(0)}%`;
      document.querySelector('#debug-lateral-drift').textContent = `${state.lateralVelocity.toFixed(2)} m/s`;
      document.querySelector('#debug-front-suspension').textContent =
        `${(state.frontCompression / frontTravel * 100).toFixed(0)}%`;
      document.querySelector('#debug-rear-suspension').textContent =
        `${(state.rearCompression / rearTravel * 100).toFixed(0)}%`;
      document.querySelector('#debug-front-grip').textContent = state.frontGripCoefficient.toFixed(2);
      document.querySelector('#debug-rear-grip').textContent = state.rearGripCoefficient.toFixed(2);
      document.querySelector('#debug-physics-time').textContent = `${averagePhysicsMs.toFixed(3)} ms`;
      document.querySelector('#debug-physics-peak').textContent = `${sampledPhysicsPeakMs.toFixed(3)} ms`;
      const slide = document.querySelector('#debug-slide');
      slide.textContent = state.frontSliding && state.rearSliding
        ? 'BOTH SLIDING'
        : state.frontSliding
          ? 'FRONT SLIDE'
          : state.rearSliding ? 'REAR SLIDE' : 'GRIPPED';
      slide.classList.toggle('sliding', state.frontSliding || state.rearSliding);
      document.querySelector('#debug-abs').textContent = state.frontAbsActive
        ? state.rearAbsActive ? 'FRONT + REAR' : 'FRONT'
        : state.rearAbsActive ? 'REAR' : 'OFF';
    }
  }

  function updateMeasurementPanel() {
    const measurements = measureRideModel();
    const format = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
    document.querySelector('#measure-acceleration').textContent =
      measurements.zeroTo100Seconds === null ? '—' : `${format(measurements.zeroTo100Seconds, 2)} s`;
    document.querySelector('#measure-top-speed').textContent = `${format(measurements.topSpeedKmh, 0)} km/h`;
    document.querySelector('#measure-braking').textContent =
      `${format(measurements.distanceMeters)} m / ${format(measurements.timeSeconds, 2)} s`;
    document.querySelector('#measure-lean-60').textContent = `${format(measurements.maximumLeanAt60Degrees)}°`;
    document.querySelector('#measure-lean-100').textContent = `${format(measurements.maximumLeanAt100Degrees)}°`;
    document.querySelector('#measure-lean-150').textContent = `${format(measurements.maximumLeanAt150Degrees)}°`;
    document.querySelector('#measure-radius-60').textContent = `${format(measurements.turnRadiusAt60Meters)} m`;
    document.querySelector('#measure-radius-100').textContent = `${format(measurements.turnRadiusAt100Meters)} m`;
    document.querySelector('#measure-lean-time').textContent =
      measurements.timeTo90PercentLeanSeconds === null
        ? 'Not reached'
        : `${format(measurements.timeTo90PercentLeanSeconds, 2)} s (90%)`;
    console.info('[Ride physics] Measured performance:', measurements);
  }

  function updateMuteControl() {
    const action = engineAudio.muted ? 'UNMUTE AUDIO · M' : 'MUTE AUDIO · M';
    document.querySelector('#audio-mute-toggle').textContent = action;
    document.querySelector('#audio-mute-toggle').setAttribute('aria-pressed', String(engineAudio.muted));
  }

  function updateRendererStats(now) {
    renderFrames += 1;
    if (now - lastStatsUpdate < simulationConfig.physicsDebugSampleMilliseconds) return;
    const elapsed = now - lastStatsUpdate;
    document.querySelector('#stats-fps').textContent = Math.round(renderFrames * 1000 / elapsed).toString();
    document.querySelector('#stats-calls').textContent = renderer.info.render.calls.toLocaleString();
    document.querySelector('#stats-triangles').textContent = renderer.info.render.triangles.toLocaleString();
    document.querySelector('#stats-bike-triangles').textContent =
      activeLodName === 'HD'
        ? `${highDetailTriangles.toLocaleString()} HD`
        : `${lowDetailTriangles.toLocaleString()} LOD`;
    renderFrames = 0;
    lastStatsUpdate = now;
  }

  function toggleCamera() {
    cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
    const cameraName = cameraMode === 'chase' ? 'CHASE' : 'COCKPIT';
    document.querySelector('#camera-toggle').textContent = `CAMERA · ${cameraName}`;
    document.querySelector('#camera-hint').textContent = cameraMode === 'chase'
      ? 'CHASE CAMERA · SCROLL TO ADJUST DISTANCE'
      : 'COCKPIT VIEW · CAMERA FOLLOWS THE BIKE';
  }

  const inputController = new RideControls(resetBike);
  document.querySelector('#reset-ride').addEventListener('click', resetBike);
  document.querySelector('#camera-toggle').addEventListener('click', toggleCamera);
  document.querySelector('#retry-button').addEventListener('click', loadModel);
  document.querySelector('#credits-open').addEventListener('click', () => {
    document.querySelector('#credits-backdrop').hidden = false;
  });
  document.querySelector('#settings-open').addEventListener('click', () => {
    document.querySelector('#settings-backdrop').hidden = false;
  });
  document.querySelector('#settings-close').addEventListener('click', () => {
    document.querySelector('#settings-backdrop').hidden = true;
  });
  document.querySelector('#settings-backdrop').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.hidden = true;
  });
  const volumeControl = document.querySelector('#audio-volume');
  volumeControl.value = String(engineAudio.volume);
  document.querySelector('#audio-volume-value').textContent = `${Math.round(engineAudio.volume * 100)}%`;
  volumeControl.addEventListener('input', () => {
    engineAudio.setVolume(volumeControl.value);
    document.querySelector('#audio-volume-value').textContent =
      `${Math.round(engineAudio.volume * 100)}%`;
  });
  document.querySelector('#audio-mute-toggle').addEventListener('click', () => {
    engineAudio.toggleMute();
    updateMuteControl();
  });
  updateMuteControl();
  document.querySelector('#credits-close').addEventListener('click', () => {
    document.querySelector('#credits-backdrop').hidden = true;
  });
  document.querySelector('#credits-backdrop').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.hidden = true;
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelector('#credits-backdrop').hidden = true;
      document.querySelector('#settings-backdrop').hidden = true;
    }
    if (event.code === 'F3') {
      event.preventDefault();
      const overlay = document.querySelector('#stats-overlay');
      overlay.hidden = !overlay.hidden;
    }
    if (event.code === 'F4') {
      event.preventDefault();
      const overlay = document.querySelector('#ride-debug');
      overlay.hidden = !overlay.hidden;
    }
  });
  document.querySelector('.viewer').addEventListener('wheel', (event) => {
    if (cameraMode !== 'chase') return;
    cameraDistance = THREE.MathUtils.clamp(
      cameraDistance + Math.sign(event.deltaY) * 0.55,
      simulationConfig.cameraMinimumDistanceMeters,
      simulationConfig.cameraMaximumDistanceMeters,
    );
    event.preventDefault();
  }, { passive: false });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, simulationConfig.renderPixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function loadModel() {
    errorBox.hidden = true;
    stateElement.textContent = 'LOADING';
    stateElement.classList.remove('state-error');
    messageElement.textContent = 'Reading binary glTF asset…';
    progressElement.style.width = '0%';
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) {
          showLoadError(new Error('The glTF loaded but contains no measurable geometry.'));
          return;
        }

        const sourceOrigin = new THREE.Vector3().applyMatrix4(model.matrixWorld);
        const sourceCenter = bounds.getCenter(new THREE.Vector3());
        const parts = findNamedParts(model);
        const axle = getWheelAxisCandidate(parts);
        if (!axle) {
          showLoadError(new Error('Could not measure the front/rear wheel centers.'));
          return;
        }
        modelScale = bikeConfig.wheelbaseMeters / axle.wheelbase;
        transformModel(model, sourceCenter, bounds.min.y);
        highDetailModel = model;
        bikeRig.add(model);
        fullWheelNodes = findWheelNodes(model);
        saveWheelBaseRotations(fullWheelNodes);
        highDetailTriangles = modelTriangles(model);
        modelRadius = new THREE.Sphere().setFromPoints([bounds.min, bounds.max]).radius * modelScale;

        const renderedBounds = new THREE.Box3().setFromObject(model);
        const dimensions = renderedBounds.getSize(new THREE.Vector3());
        stateElement.textContent = 'READY';
        stateElement.classList.add('state-ready');
        progressElement.style.width = '100%';
        messageElement.textContent = `${gltf.asset?.version ? `glTF ${gltf.asset.version}` : 'glTF'} ready · use W / A / S / D`;
        document.querySelector('#lod-summary').textContent =
          `FULL DETAIL WITHIN ${bikeConfig.lodSwitchDistanceMeters.toFixed(2)} M · LOD UNDER 150K`;
        console.info('[Bike model] Loaded:', MODEL_URL);
        console.info('[Bike model] Wheelbase scale factor:', {
          sourceWheelbase: Number(axle.wheelbase.toFixed(6)),
          targetWheelbaseMeters: bikeConfig.wheelbaseMeters,
          scaleFactor: Number(modelScale.toFixed(6)),
        });
        console.info('[Bike model] Axle axis and travel axis:', {
          axleAxis: axle.axleAxis,
          travelAxis: axle.longitudinalAxis,
        });
        console.info('[Bike model] Scaled dimensions (meters by wheelbase calibration):', {
          x: Number(dimensions.x.toFixed(4)),
          y: Number(dimensions.y.toFixed(4)),
          z: Number(dimensions.z.toFixed(4)),
        });
        console.info('[Bike model] Full-detail triangle count and switch distance:', {
          triangles: highDetailTriangles,
          switchDistanceMeters: bikeConfig.lodSwitchDistanceMeters,
        });
        console.info('[Ride physics] Surface tuning:', tyreConfig.activeSurface);
        updateLod();
        addLowDetailModel(sourceCenter, bounds.min.y);
      },
      (event) => {
        if (event.total <= 0) return;
        const percent = Math.round(event.loaded / event.total * 100);
        progressElement.style.width = `${percent}%`;
        messageElement.textContent = `Loading model asset… ${percent}%`;
      },
      showLoadError,
    );
  }

  function addLowDetailModel(center, groundY) {
    loader.load(
      LOD_MODEL_URL,
      (gltf) => {
        lowDetailModel = gltf.scene;
        transformModel(lowDetailModel, center, groundY);
        lowDetailTriangles = modelTriangles(lowDetailModel);
        if (lowDetailTriangles >= 150_000) {
          showLoadError(new Error(`Low-detail model has ${lowDetailTriangles.toLocaleString()} triangles; expected under 150,000.`));
          return;
        }
        bikeRig.add(lowDetailModel);
        lodWheelNodes = findWheelNodes(lowDetailModel);
        saveWheelBaseRotations(lodWheelNodes);
        document.querySelector('#lod-summary').textContent =
          `FULL DETAIL WITHIN ${bikeConfig.lodSwitchDistanceMeters.toFixed(2)} M · LOD ${lowDetailTriangles.toLocaleString()} TRIANGLES`;
        console.info('[Bike model] Low-detail LOD loaded:', LOD_MODEL_URL);
        console.info('[Bike model] Low-detail triangle count:', lowDetailTriangles);
        console.info('[Bike model] Wheel nodes available for animation:', {
          fullDetail: fullWheelNodes.map((node) => node.name),
          lowDetail: lodWheelNodes.map((node) => node.name),
        });
        console.info('[Bike model] LOD uses EXT_meshopt_compression.');
        updateLod();
      },
      undefined,
      showLoadError,
    );
  }

  function updateDebugTiming(deltaMilliseconds) {
    physicsSampleTotal += deltaMilliseconds;
    physicsSampleCount += 1;
    physicsSampleElapsed += fixedSeconds * 1000;
    physicsPeakMs = Math.max(physicsPeakMs, deltaMilliseconds);
    if (physicsSampleElapsed < simulationConfig.physicsDebugSampleMilliseconds) return;
    averagePhysicsMs = physicsSampleCount > 0 ? physicsSampleTotal / physicsSampleCount : 0;
    sampledPhysicsPeakMs = physicsPeakMs;
    physicsSampleElapsed = 0;
    physicsSampleCount = 0;
    physicsSampleTotal = 0;
    physicsPeakMs = 0;
  }

  function render(now) {
    requestAnimationFrame(render);
    const frameDelta = Math.min((now - lastFrameTime) / 1000, simulationConfig.maximumFrameDeltaSeconds);
    lastFrameTime = now;
    accumulator += frameDelta;
    latestInput = inputController.sample();
    if (latestInput.muteToggle) {
      engineAudio.toggleMute();
      updateMuteControl();
    }
    queuedShiftUp ||= latestInput.shiftUp;
    queuedShiftDown ||= latestInput.shiftDown;

    while (accumulator >= fixedSeconds) {
      const physicsStart = performance.now();
      rideModel.step(
        { ...latestInput, shiftUp: queuedShiftUp, shiftDown: queuedShiftDown },
        fixedSeconds,
        groundHeightAt,
      );
      if (rideModel.current.lastShiftDirection) {
        engineAudio.triggerShift(rideModel.current.lastShiftDirection, rideModel.current.rpm);
      }
      queuedShiftUp = false;
      queuedShiftDown = false;
      updateDebugTiming(performance.now() - physicsStart);
      accumulator -= fixedSeconds;
    }

    const state = interpolateRideState(rideModel.previous, rideModel.current, accumulator / fixedSeconds);
    applyRideVisuals(state, frameDelta);
    if (now - lastAudioUpdateTime >= 1000 / audioConfig.audioUpdateHz) {
      engineAudio.setTelemetry({ rpm: state.rpm, throttle: latestInput.throttle, gear: state.gear });
      if (engineAudio.started) {
        document.querySelector('#audio-status').textContent =
          engineAudio.sampleSource ? 'RECORDED LOOP ACTIVE' : 'SYNTH ACTIVE';
      }
      lastAudioUpdateTime = now;
    }
    if (now - lastTelemetryTime >= simulationConfig.physicsDebugSampleMilliseconds) {
      updateHud(state, latestInput);
      lastTelemetryTime = now;
    }
    renderer.render(scene, camera);
    updateRendererStats(now);
  }

  const initialState = rideModel.current;
  bikeRig.position.set(initialState.x, bikeConfig.centerOfMassHeightMeters, initialState.z);
  loadModel();
  updateMeasurementPanel();
  requestAnimationFrame(render);
  console.info('[Ride physics] Fixed-step loop:', `${simulationConfig.fixedHz} Hz`);
  console.info('[Ride physics] LOD switch distance:', `${bikeConfig.lodSwitchDistanceMeters.toFixed(2)} m`);
}
