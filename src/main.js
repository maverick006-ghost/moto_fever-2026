import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <main class="boot-screen">
    <span class="boot-mark">PITLANE<span> / LAB</span></span>
    <div class="boot-line"></div>
    <p>LOADING VEHICLE INSPECTION</p>
  </main>
`;

try {
  const { startViewer } = await import('./viewer.js');
  startViewer(app);
} catch (error) {
  console.error('[Bike model] Viewer initialization failed:', error);
  app.innerHTML = `
    <main class="boot-screen boot-error">
      <span class="boot-mark">PITLANE<span> / LAB</span></span>
      <strong>VIEWER INITIALIZATION FAILED</strong>
      <p>${error instanceof Error ? error.message : String(error)}</p>
    </main>
  `;
}
