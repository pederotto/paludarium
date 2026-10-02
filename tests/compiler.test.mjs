// engine/compiler.js patches a few internals of three.js's renderer (three is pinned in package.json). This fails when an
// upgrade renames or moves one of them, so the background shader compile cannot silently stop working.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(new URL('../node_modules/three/src/renderers/' + f, import.meta.url), 'utf8');

test('three.js internals used by engine/compiler.js exist', () => {
  const R = src('common/Renderer.js');
  assert.match(R, /\n\t_renderObjectDirect\( object, material, scene, camera, lightsNode, group, clippingContext, passId \) \{/);
  assert.match(R, /this\._handleObjectFunction = this\._renderObjectDirect;/, 'render() must read _renderObjectDirect from the instance');
  assert.match(R, /if \( this\._pipelines\.isReady\( renderObject \) \) \{/, 'three must skip objects whose pipeline is not ready');
  const P = src('common/Pipelines.js');
  for (const m of ['_releasePipeline( pipeline ) {', '_releaseProgram( program ) {', 'isReady( renderObject ) {']) assert.ok(P.includes(m), m);
  assert.match(P, /this\.backend\.createRenderPipeline\( renderObject, promises \);/);
  const N = src('common/nodes/NodeManager.js');
  assert.match(N, /\n\tgetForRender\( renderObject, useAsync = false \) \{/);
  assert.match(N, /renderObjectData\.nodeBuilderState/);
  const GL = src('webgl-fallback/WebGLBackend.js');
  assert.match(GL, /createRenderPipeline\( renderObject, promises \) \{/);
  assert.match(GL, /if \( promises !== null && this\.parallel \) \{/);
  const GPU = src('webgpu/utils/WebGPUPipelineUtils.js');
  assert.match(GPU, /createRenderPipelineAsync/);
  assert.ok(src('common/QuadMesh.js').includes('this.isQuadMesh = true;'));
});
