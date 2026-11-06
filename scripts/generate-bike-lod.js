import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const sourcePath = 'public/assets/models/bmw_s1000_rr.glb';
const outputPath = 'public/assets/models/bmw_s1000_rr_lod.glb';
const targetRatio = 0.4;

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.simplifier': MeshoptSimplifier,
  });
const document = await io.read(sourcePath);
const scene = document.getRoot().getDefaultScene();

if (!scene) throw new Error(`No default scene found in ${sourcePath}.`);

const countTriangles = () => {
  let triangles = 0;
  const visitNode = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      for (const primitive of mesh.listPrimitives()) {
        const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
        const mode = primitive.getMode();
        if (mode === 4) triangles += count / 3;
        else if (mode === 5 || mode === 6) triangles += Math.max(count - 2, 0);
      }
    }
    node.listChildren().forEach(visitNode);
  };
  scene.listChildren().forEach(visitNode);
  return Math.round(triangles);
};

const sourceTriangles = countTriangles();
await document.transform(simplify({
  simplifier: MeshoptSimplifier,
  ratio: targetRatio,
  error: 0.03,
  lockBorder: false,
}), meshopt({ encoder: MeshoptEncoder, level: 'high' }));

const lodTriangles = countTriangles();
if (lodTriangles >= 150_000) {
  throw new Error(`LOD has ${lodTriangles.toLocaleString()} triangles; expected fewer than 150,000.`);
}

await io.write(outputPath, document);
console.info(`Generated ${outputPath}`);
console.info(`Triangles: ${sourceTriangles.toLocaleString()} → ${lodTriangles.toLocaleString()}`);
