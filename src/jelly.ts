import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SliceMotion } from './motion';

export type Palette = 'ruby' | 'peach' | 'golden';
type SoftMesh = { mesh: THREE.Mesh; rest: Float32Array };

const TOP = 1.55;
const RADIUS = 3.04;
const ANGLE = 0.49;
const DEPTH = 1.04;
const FLESH_RADIUS = 2.65;
const PITH_RADIUS = 2.8;
const fleshColors: Record<Palette, string> = {
  ruby: '#f36783', peach: '#f9a268', golden: '#f7c343',
};
const gelColors: Record<Palette, string> = {
  ruby: '#ffe0e8', peach: '#ffe1bf', golden: '#fff0b3',
};

function faceDepth(radius: number, angle: number) {
  return DEPTH / 2 + 0.095 + 0.12 * Math.sin(Math.min(radius / RADIUS, 1) * Math.PI) * Math.cos(angle / ANGLE * Math.PI / 2);
}

function roundedVolume(inner: number, outer: number, bevel: number) {
  const shape = new THREE.Shape();
  if (inner === 0) {
    shape.moveTo(-0.025, TOP - 0.025);
  } else {
    shape.moveTo(-Math.sin(ANGLE) * inner, TOP - Math.cos(ANGLE) * inner);
  }
  shape.lineTo(-Math.sin(ANGLE) * outer, TOP - Math.cos(ANGLE) * outer);
  shape.absarc(0, TOP, outer, -Math.PI / 2 - ANGLE, -Math.PI / 2 + ANGLE, false);
  if (inner === 0) {
    shape.lineTo(0.025, TOP - 0.025);
    shape.quadraticCurveTo(0, TOP + 0.005, -0.025, TOP - 0.025);
  } else {
    shape.lineTo(Math.sin(ANGLE) * inner, TOP - Math.cos(ANGLE) * inner);
    shape.absarc(0, TOP, inner, -Math.PI / 2 + ANGLE, -Math.PI / 2 - ANGLE, true);
  }
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH, steps: 8, curveSegments: 32,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5,
  });
  extruded.translate(0, 0, -DEPTH / 2);
  // Finish subdividing long cap edges before bending; unfinished edges leave visible seams.
  const subdivided = new TessellateModifier(0.2, 10).modify(extruded);
  extruded.dispose();
  const positions = subdivided.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const radius = Math.hypot(x, TOP - y);
    const angle = Math.atan2(x, TOP - y);
    const bulge = 0.12 * Math.sin(Math.min(radius / RADIUS, 1) * Math.PI) * Math.max(0, Math.cos(angle / ANGLE * Math.PI / 2));
    positions.setZ(i, z + Math.sign(z) * bulge * Math.min(1, Math.abs(z) / (DEPTH / 2)));
  }
  subdivided.deleteAttribute('normal');
  const result = mergeVertices(subdivided, 0.0001);
  subdivided.dispose();
  result.computeVertexNormals();
  result.clearGroups();
  return result;
}

function rindTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#74985a';
  context.fillRect(0, 0, 512, 256);
  for (let stripe = -1; stripe < 7; stripe++) {
    context.beginPath();
    for (let x = 0; x <= 512; x += 2) {
      const y = stripe * 52 + Math.sin(x * 0.023 + stripe * 1.5) * 9 + Math.sin(x * 0.049 + stripe) * 3;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    for (let x = 512; x >= 0; x -= 2) {
      const y = stripe * 52 + 23 + Math.sin(x * 0.023 + stripe * 1.5 + 0.5) * 8 + Math.sin(x * 0.049 + stripe) * 4;
      context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = stripe % 2 ? '#315a34' : '#3d653b';
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export class Jelly {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  private group = new THREE.Group();
  private meshes: SoftMesh[] = [];
  private seeds: { mesh: THREE.Mesh; rest: THREE.Vector3; angle: number }[] = [];
  private flesh: THREE.MeshPhysicalMaterial;
  private materials: THREE.MeshPhysicalMaterial[] = [];
  private motion = new SliceMotion();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private drag: 'pull' | 'spin' | null = null;
  private start = { x: 0, y: 0, rotation: 0, tilt: 0 };
  private samples: { x: number; y: number; time: number }[] = [];
  private activePointer: number | null = null;
  private previousTime = 0;
  private time = 0;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private shadow: THREE.Mesh;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  public paused = false;
  public slow = false;
  public onGrab: ((grabbing: boolean) => void) | null = null;
  public onRelease: (() => void) | null = null;
  public onToss: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor(0xf8f7f4, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    // Transmission needs a real scene background to refract, not an empty alpha buffer.
    this.scene.background = new THREE.Color('#f5f3ef');
    this.renderer.domElement.setAttribute('aria-label', 'Interactive translucent jelly watermelon. Pull gently to stretch, flick upward to toss, or drag the background to turn in any direction. Stand upright restores its pose.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.container.appendChild(this.renderer.domElement);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
    environment.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb3b19f, 0.7));
    const light = new THREE.DirectionalLight(0xfff5ec, 2.3);
    light.position.set(-3, 6, 5);
    this.scene.add(light);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
    rimLight.position.set(3, 2, -3);
    this.scene.add(rimLight);

    this.flesh = new THREE.MeshPhysicalMaterial({
      color: gelColors.ruby, roughness: 0.055, metalness: 0,
      transmission: 0.92, thickness: 0.95, ior: 1.36,
      clearcoat: 1, clearcoatRoughness: 0.055, envMapIntensity: 0.85,
      side: THREE.FrontSide, attenuationColor: new THREE.Color(fleshColors.ruby), attenuationDistance: 1.1,
    });
    const pith = new THREE.MeshPhysicalMaterial({ color: '#e5efb5', roughness: 0.18, transmission: 0.55, thickness: 0.65, ior: 1.36, clearcoat: 0.8 });
    const texture = rindTexture();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.5, 0.8);
    const skin = new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.2, transmission: 0.32, thickness: 0.5, ior: 1.36, clearcoat: 0.9 });
    this.materials = [this.flesh, pith, skin];
    this.addSoft(roundedVolume(0, FLESH_RADIUS, 0.095), this.flesh);
    this.addSoft(roundedVolume(FLESH_RADIUS, PITH_RADIUS, 0.025), pith);
    this.addSoft(roundedVolume(PITH_RADIUS, RADIUS, 0.065), skin);
    this.createSeeds();
    this.group.rotation.set(this.motion.pose.x, this.motion.pose.y, this.motion.pose.z);
    this.scene.add(this.group);

    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 3, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(46,49,36,0.26)');
    gradient.addColorStop(0.35, 'rgba(46,49,36,0.13)');
    gradient.addColorStop(1, 'rgba(46,49,36,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0.18, -1.69, 0);
    this.scene.add(this.shadow);
    this.camera.position.set(0, 0.3, 9.6);
    this.camera.lookAt(0, -0.05, 0);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPointer();
    this.renderer.setAnimationLoop(this.animate);
  }

  private addSoft(geometry: THREE.BufferGeometry, material: THREE.MeshPhysicalMaterial) {
    const mesh = new THREE.Mesh(geometry, material);
    this.meshes.push({ mesh, rest: new Float32Array(geometry.attributes.position.array) });
    this.group.add(mesh);
  }

  private createSeeds() {
    const geometry = new THREE.SphereGeometry(1, 12, 10);
    const attr = geometry.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      const taper = 1 - Math.max(0, attr.getY(i)) * 0.55;
      attr.setXYZ(i, attr.getX(i) * taper, attr.getY(i), attr.getZ(i));
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshPhysicalMaterial({ color: '#342b25', roughness: 0.26, clearcoat: 0.7 });
    const rows = [
      { radius: 0.9, angles: [-0.12, 0.28] },
      { radius: 1.4, angles: [-0.31, 0.04, 0.34] },
      { radius: 1.94, angles: [-0.39, -0.13, 0.17, 0.4] },
      { radius: 2.45, angles: [-0.41, -0.18, 0.08, 0.31, 0.46] },
    ];
    for (const z of [-1, 1]) {
      rows.forEach((row, ri) => row.angles.forEach((angle, i) => {
        const seed = new THREE.Mesh(geometry, material);
        const seedAngle = angle + (z < 0 ? 0.035 : 0);
        seed.position.set(Math.sin(seedAngle) * row.radius, TOP - Math.cos(seedAngle) * row.radius, z * (faceDepth(row.radius, seedAngle) - 0.13 - (i % 3) * 0.045));
        seed.scale.set(0.038 + (i % 2) * 0.004, 0.094 + (ri % 2) * 0.008, 0.027);
        seed.rotation.z = -angle + Math.sin(i * 4 + ri) * 0.18;
        this.seeds.push({ mesh: seed, rest: seed.position.clone(), angle: seed.rotation.z });
        this.group.add(seed);
      }));
    }
    // Tiny suspended flecks give the fruit a softer, translucent surface.
    const fleckMaterial = new THREE.MeshPhysicalMaterial({ color: '#ffe8dd', roughness: 0.08, clearcoat: 1 });
    const fleckGeometry = new THREE.SphereGeometry(0.012, 5, 4);
    for (let i = 0; i < 36; i++) {
      const angle = Math.sin(i * 78.23) * 0.5;
      const radius = 0.45 + ((i * 0.618) % 1) * 2.28;
      const fleck = new THREE.Mesh(fleckGeometry, fleckMaterial);
      fleck.position.set(Math.sin(angle) * radius, TOP - Math.cos(angle) * radius, Math.sin(i * 9.27) * DEPTH * 0.36);
      fleck.scale.set(0.75, 1.15, 0.75);
      this.seeds.push({ mesh: fleck, rest: fleck.position.clone(), angle: 0 });
      this.group.add(fleck);
    }
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.position.z = width < 640 ? 10.2 : 9.6;
    this.camera.lookAt(0, width < 640 ? -0.05 : -0.48, 0);
    this.camera.updateProjectionMatrix();
  }

  private updatePointer(event: PointerEvent) {
    const bounds = this.container.getBoundingClientRect();
    this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private bindPointer() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.activePointer !== null || this.motion.airborne) return;
      this.paused = false;
      this.updatePointer(event);
      this.drag = this.raycaster.intersectObjects(this.group.children).length ? 'pull' : 'spin';
      this.activePointer = event.pointerId;
      this.start = { x: event.clientX, y: event.clientY, rotation: this.motion.pose.y, tilt: this.motion.pose.x };
      this.samples = [{ x: event.clientX, y: event.clientY, time: event.timeStamp }];
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      this.onGrab?.(this.drag === 'pull');
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.drag) {
        this.updatePointer(event);
        canvas.style.cursor = this.raycaster.intersectObjects(this.group.children).length ? 'grab' : 'move';
        return;
      }
      if (event.pointerId !== this.activePointer) return;
      const dx = event.clientX - this.start.x;
      const dy = event.clientY - this.start.y;
      this.samples.push({ x: event.clientX, y: event.clientY, time: event.timeStamp });
      this.samples = this.samples.filter(sample => event.timeStamp - sample.time <= 140);
      if (this.drag === 'pull') {
        const scale = 5 / this.container.clientHeight;
        this.motion.pull.set(
          THREE.MathUtils.clamp(dx * scale, -1.5, 1.5),
          THREE.MathUtils.clamp(-dy * scale, -1, 1.3),
          event.shiftKey ? THREE.MathUtils.clamp(-dy * scale, -1.5, 1.5) : 0,
        ).applyQuaternion(this.group.quaternion.clone().invert());
      } else {
        this.motion.poseTarget.y = this.start.rotation + dx * 0.008;
        this.motion.poseTarget.x = this.start.tilt + dy * 0.009;
      }
    });
    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.activePointer) return;
      if (this.drag === 'pull') {
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const seconds = first && last ? (last.time - first.time) / 1000 : 0;
        const recent = last && event.timeStamp - last.time < 120;
        const distance = Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y);
        if (event.type === 'pointerup' && recent && seconds > 0.008 && distance > 35 && !event.shiftKey) {
          const vx = (last.x - first.x) / seconds;
          const vy = (last.y - first.y) / seconds;
          if (vy < -500 || Math.abs(vx) > 950) this.toss(vx / 4000, vy > 0 ? -1 : 1);
        }
        this.onRelease?.();
      }
      this.drag = null;
      this.activePointer = null;
      this.samples = [];
      this.motion.pull.set(0, 0, 0);
      canvas.style.cursor = 'grab';
      this.onGrab?.(false);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('dblclick', () => this.toss());
  }

  private deform(x: number, y: number, z: number, output: THREE.Vector3) {
    const height = THREE.MathUtils.clamp((y + 1.5) / 3.05, 0, 1);
    const weight = 0.15 + height * height * 0.85;
    const offset = this.motion.offset;
    const squeeze = THREE.MathUtils.clamp(offset.y * 0.14, -0.22, 0.22);
    const bendX = this.motion.bend.x * height;
    const bendZ = this.motion.bend.y * height;
    // Rotate successive cross-sections so the slice curls rather than just shearing.
    const sideways = x * Math.cos(bendZ) - (y + 1.5) * Math.sin(bendZ);
    const spine = x * Math.sin(bendZ) + (y + 1.5) * Math.cos(bendZ);
    return output.set(
      sideways * (1 - squeeze) + offset.x * weight,
      spine * Math.cos(bendX) - z * Math.sin(bendX) - 1.5 + offset.y * weight,
      spine * Math.sin(bendX) + z * Math.cos(bendX) * (1 - squeeze) + offset.z * weight,
    );
  }

  private animate = (timestamp: number) => {
    let dt = Math.min((timestamp - (this.previousTime || timestamp)) / 1000, 0.08);
    this.previousTime = timestamp;
    if (this.slow) dt *= 0.5;
    if (this.paused) dt = 0;
    this.time += dt;
    this.motion.step(dt);
    const point = new THREE.Vector3();
    if (dt > 0) {
      for (const { mesh, rest } of this.meshes) {
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          this.deform(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], point);
          positions.setXYZ(i, point.x, point.y, point.z);
        }
        positions.needsUpdate = true;
        if (this.frame % 2 === 0) mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
      for (const seed of this.seeds) {
        this.deform(seed.rest.x, seed.rest.y, seed.rest.z, seed.mesh.position);
        const height = THREE.MathUtils.clamp((seed.rest.y + 1.5) / 3.05, 0, 1);
        seed.mesh.rotation.set(this.motion.bend.x * height, 0, seed.angle + this.motion.bend.y * height);
      }
      const pose = this.motion.pose;
      this.group.rotation.set(pose.x, pose.y, pose.z + this.motion.offset.x * 0.035);
      this.group.position.set(this.motion.sideways, this.motion.height + (this.reducedMotion ? 0 : Math.sin(this.time * 1.45) * 0.035), 0);
      this.shadow.scale.setScalar(1 + this.motion.height * 0.3 + this.motion.offset.y * 0.045);
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - this.motion.height * 0.45;
    }
    this.renderer.render(this.scene, this.camera);
    this.frame++;
  };

  setFirmness(value: number) { this.motion.firmness = value; }
  setDamping(value: number) { this.motion.damping = value; }
  setTranslucency(value: number) {
    if ((this.flesh.transmission > 0) !== (value > 0)) this.flesh.needsUpdate = true;
    this.flesh.transmission = value / 100;
    this.flesh.roughness = THREE.MathUtils.lerp(0.25, 0.038, value / 100);
  }
  setPalette(palette: Palette) {
    this.flesh.color.set(gelColors[palette]);
    this.flesh.attenuationColor.set(fleshColors[palette]);
    this.nudge(0.45);
  }
  setWireframe(enabled: boolean) { this.materials.forEach(material => material.wireframe = enabled); }
  nudge(strength = 1) { this.motion.nudge(strength); }
  toss(horizontal = 0, direction = 1) {
    if (this.motion.toss(horizontal, direction)) {
      this.paused = false;
      this.onToss?.();
    }
  }
  standUpright() {
    this.paused = false;
    this.motion.standUpright();
  }
  reset() {
    this.motion.reset();
    this.time = 0;
  }
  getStats() {
    return {
      energy: this.motion.energy,
      volume: 100 - Math.min(3.8, this.motion.offset.length() * 1.8),
      stretch: this.motion.offset.length(),
      rotation: this.motion.pose.y,
      tilt: this.motion.pose.x,
      bend: this.motion.bend.length(),
      height: this.motion.height,
      airborne: this.motion.airborne,
      tosses: this.motion.tossCount,
      landings: this.motion.landings,
      transmission: this.flesh.transmission,
      frame: this.frame,
    };
  }
}
