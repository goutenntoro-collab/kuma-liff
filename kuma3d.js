// くまちゃんの3D表示。three.js + three-vrm。
// このファイルは外部ブラウザで開かれたときだけ動的に読み込まれる。
// LINE内ブラウザでは読み込まれないので、3Dの容量を一切ダウンロードしない。
//
// このモデルには口のモーフが無い(目のモーフのみ)。口パクはしない。
// 「話している感」は体の上下と首の動きで作る。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// 常時この分だけ目を閉じておく(眠そうな半目)
const SLEEPY_BLINK = 0.28;
const BLINK_MAX = 1.0;
const BLINK_INTERVAL_MS = 4200;
const BLINK_JITTER_MS = 2600;
const BLINK_DURATION_MS = 150;

// 状態ごとの動き。呼吸(上下)と首の角度。振れ幅は小さくする(落ち着いた性格)
const MOTION = {
  idle:   { bobAmp: 0.006, bobSpeed: 1.1, headPitch: 0.00, headYaw: 0.00, sway: 0.004 },
  listen: { bobAmp: 0.004, bobSpeed: 0.9, headPitch: -0.06, headYaw: 0.00, sway: 0.002 },
  think:  { bobAmp: 0.004, bobSpeed: 0.8, headPitch: 0.10, headYaw: 0.07, sway: 0.002 },
  talk:   { bobAmp: 0.014, bobSpeed: 2.6, headPitch: -0.03, headYaw: 0.00, sway: 0.010 }
};

const CAMERA_FOV = 30;
// 上下にどれだけ余白を取るか(0.1 = 1割)。距離はモデルの実寸から毎回計算する
const FRAMING_PADDING = 0.12;
// 胸のボーンが取れなかったときに、頭からどれだけ下までを写すか(頭の高さの何倍か)
const FALLBACK_BUST_RATIO = 1.6;
const LERP_RATE = 4.0;

export async function createKuma3D(options) {
  const canvas = options.canvas;
  const modelUrl = options.modelUrl;
  const onProgress = options.onProgress || function () {};

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 20);

  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
  keyLight.position.set(1, 1.6, 2);
  scene.add(keyLight);

  const loader = new GLTFLoader();
  loader.register(function (parser) { return new VRMLoaderPlugin(parser); });

  const gltf = await loader.loadAsync(modelUrl, function (event) {
    if (event && event.total) {
      onProgress(Math.min(1, event.loaded / event.total));
    }
  });

  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);
  VRMUtils.rotateVRM0(vrm); // VRM0.x は後ろ向きに読み込まれるので回す
  vrm.scene.traverse(function (obj) { obj.frustumCulled = false; });
  scene.add(vrm.scene);

  const headBone = vrm.humanoid ? vrm.humanoid.getNormalizedBoneNode('head') : null;
  const baseY = vrm.scene.position.y;

  // 頭のてっぺんから胸までが画面に収まる位置にカメラを置く。
  // 固定の距離だとモデルの大きさが変わったときに合わなくなるので、実寸から計算する。
  function frameCamera() {
    const headWorld = new THREE.Vector3();
    if (headBone) {
      headBone.getWorldPosition(headWorld);
    } else {
      headWorld.set(0, 1.3, 0);
    }

    const box = new THREE.Box3().setFromObject(vrm.scene);
    const top = box.max.y;

    let bottom;
    const bustBone =
      (vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('chest')) ||
      (vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('upperChest')) ||
      (vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine'));
    if (bustBone) {
      const bustWorld = new THREE.Vector3();
      bustBone.getWorldPosition(bustWorld);
      bottom = bustWorld.y;
    } else {
      bottom = headWorld.y - (top - headWorld.y) * FALLBACK_BUST_RATIO;
    }

    const span = Math.max(0.01, (top - bottom) * (1 + FRAMING_PADDING));
    const centerY = (top + bottom) / 2;
    const halfFov = THREE.MathUtils.degToRad(CAMERA_FOV) / 2;
    const distance = (span / 2) / Math.tan(halfFov);

    camera.position.set(0, centerY, distance);
    camera.lookAt(0, centerY, 0);
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frameCamera();
  }

  let state = 'idle';
  let current = Object.assign({}, MOTION.idle);
  let elapsed = 0;
  let nextBlinkAt = BLINK_INTERVAL_MS;
  let blinkStartedAt = -1;
  let running = true;

  function setState(next) {
    if (MOTION[next]) {
      state = next;
    }
  }

  function blinkValue(nowMs) {
    if (blinkStartedAt < 0) {
      return SLEEPY_BLINK;
    }
    const t = (nowMs - blinkStartedAt) / BLINK_DURATION_MS;
    if (t >= 1) {
      blinkStartedAt = -1;
      nextBlinkAt = nowMs + BLINK_INTERVAL_MS + Math.random() * BLINK_JITTER_MS;
      return SLEEPY_BLINK;
    }
    // 閉じて開く
    const shape = t < 0.5 ? t * 2 : (1 - t) * 2;
    return SLEEPY_BLINK + (BLINK_MAX - SLEEPY_BLINK) * shape;
  }

  const clock = new THREE.Clock();
  function tick() {
    if (!running) {
      return;
    }
    requestAnimationFrame(tick);

    const delta = Math.min(clock.getDelta(), 0.1);
    elapsed += delta * 1000;

    const target = MOTION[state];
    const k = Math.min(1, delta * LERP_RATE);
    current.bobAmp += (target.bobAmp - current.bobAmp) * k;
    current.bobSpeed += (target.bobSpeed - current.bobSpeed) * k;
    current.headPitch += (target.headPitch - current.headPitch) * k;
    current.headYaw += (target.headYaw - current.headYaw) * k;
    current.sway += (target.sway - current.sway) * k;

    const phase = (elapsed / 1000) * current.bobSpeed;
    vrm.scene.position.y = baseY + Math.sin(phase) * current.bobAmp;
    vrm.scene.rotation.z = Math.sin(phase * 0.5) * current.sway;

    if (headBone) {
      headBone.rotation.x = current.headPitch + Math.sin(phase * 0.9) * current.bobAmp;
      headBone.rotation.y = current.headYaw;
    }

    if (blinkStartedAt < 0 && elapsed >= nextBlinkAt) {
      blinkStartedAt = elapsed;
    }
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('blink', blinkValue(elapsed));
    }

    vrm.update(delta);
    renderer.render(scene, camera);
  }

  resize();
  frameCamera();
  window.addEventListener('resize', resize);
  tick();

  return {
    setState: setState,
    getState: function () { return state; },
    // 静止画(kuma_still.png)を作るときに使う。現在の描画をPNGとして取り出す
    snapshot: function () {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
    dispose: function () {
      running = false;
      window.removeEventListener('resize', resize);
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
    }
  };
}
