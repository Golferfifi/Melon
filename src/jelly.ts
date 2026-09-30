import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SliceMotion, CENTER_OF_MASS, FLOOR_Y, DEFAULT_TRANSLUCENCY } from './motion';

export type Palette = 'ruby' | 'peach' | 'golden';
type SoftMesh = { mesh: THREE.Mesh; rest: Float32Array };

const TOP = 1.55;
const RADIUS = 3.04;
const ANGLE = 0.49;
const DEPTH = 1.04;
const FLESH_RADIUS = 2.65;
const PITH_RADIUS = 2.8;
const fleshColors: Record<Palette, string> = {
  ruby: '#f52e50', peach: '#ff803a', golden: '#f6ba13',
};
const gelColors: Record<Palette, string> = {
  ruby: '#ff5d78', peach: '#ff9b54', golden: '#ffd444',
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
  private palette: Palette = 'ruby';
  private motion = new SliceMotion();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private drag: 'pull' | 'spin' | null = null;
  private start = { x: 0, y: 0, rotation: 0, tilt: 0 };
  private grabPlane = new THREE.Plane();
  private grabWorld = new THREE.Vector3();
  private grabDepth = 0;
  private floorClearance = 0;
  private activePointer: number | null = null;
  private previousTime = 0;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private shadow: THREE.Mesh;
  private gripMarker = document.createElement('div');
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
    this.renderer.domElement.setAttribute('aria-label', 'Interactive jelly watermelon. Give the flesh a small drag to jiggle it, pull farther to lift, then release to drop. Drag empty space to tilt it flat. Stand upright restores its pose.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.container.appendChild(this.renderer.domElement);
    this.gripMarker.className = 'grip-marker';
    this.gripMarker.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.gripMarker);
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
      color: fleshColors.ruby, roughness: 0.1, metalness: 0,
      transmission: DEFAULT_TRANSLUCENCY / 100, thickness: 0.8, ior: 1.36,
      clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 0.65,
      side: THREE.FrontSide, attenuationColor: new THREE.Color(gelColors.ruby), attenuationDistance: 2.8,
    });
    const pith = new THREE.MeshPhysicalMaterial({ color: '#e5efb5', roughness: 0.18, transmission: 0.55, thickness: 0.65, ior: 1.36, clearcoat: 0.8 });
    const texture = rindTexture();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.5, 0.8);
    const skin = new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.2, transmission: 0.32, thickness: 0.5, ior: 1.36, clearcoat: 0.9 });
    this.materials = [this.flesh, pith, skin];
    this.setTranslucency(DEFAULT_TRANSLUCENCY);
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
    this.shadow.position.set(0, FLOOR_Y, 0);
    this.scene.add(this.shadow);
    this.camera.position.set(0, 2.4, 9.6);
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
        const inset = z > 0 ? 0.018 + (i % 3) * 0.004 : 0.13 + (i % 3) * 0.045;
        seed.position.set(Math.sin(seedAngle) * row.radius, TOP - Math.cos(seedAngle) * row.radius, z * (faceDepth(row.radius, seedAngle) - inset));
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
    this.motion.horizontalLimit = width < 640 ? 0.4 : 1.6;
    this.motion.body.x = THREE.MathUtils.clamp(this.motion.body.x, -this.motion.horizontalLimit, this.motion.horizontalLimit);
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
      if (event.button !== 0 || this.activePointer !== null) return;
      this.paused = false;
      this.updatePointer(event);
      const hit = this.raycaster.intersectObjects(this.group.children)[0];
      this.drag = hit ? 'pull' : 'spin';
      this.activePointer = event.pointerId;
      this.start = { x: event.clientX, y: event.clientY, rotation: this.motion.pose.y, tilt: this.motion.pose.x };
      if (hit) {
        const normal = this.camera.getWorldDirection(new THREE.Vector3());
        this.grabPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
        this.grabWorld.copy(hit.point);
        this.grabDepth = hit.point.z;
        const local = this.group.worldToLocal(hit.point.clone());
        // Recover the rest point so grabbing an already wobbling surface does not jump.
        const rest = local.clone();
        const deformed = new THREE.Vector3();
        for (let i = 0; i < 5; i++) {
          this.deform(rest.x, rest.y, rest.z, deformed);
          rest.addScaledVector(deformed.sub(local), -0.7);
        }
        this.motion.beginGrab(rest, hit.point);
      } else this.motion.beginTurn();
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      this.onGrab?.(Boolean(hit));
      this.gripMarker.classList.toggle('active', Boolean(hit));
    });
    canvas.addEventListener('pointermove', event => {
      this.updatePointer(event);
      if (!this.drag) {
        canvas.style.cursor = this.raycaster.intersectObjects(this.group.children).length ? 'grab' : 'move';
        return;
      }
      if (event.pointerId !== this.activePointer) return;
      const dx = event.clientX - this.start.x;
      const dy = event.clientY - this.start.y;
      if (this.drag === 'pull') {
        if (this.raycaster.ray.intersectPlane(this.grabPlane, this.grabWorld)) {
          if (event.shiftKey) this.grabWorld.z = this.grabDepth - dy * 0.006;
          this.motion.grabTarget.copy(this.grabWorld);
          this.motion.grabTarget.x = THREE.MathUtils.clamp(this.grabWorld.x, -2, 2);
          this.motion.grabTarget.y = THREE.MathUtils.clamp(this.grabWorld.y, FLOOR_Y + 0.03, 2.1);
          this.motion.grabTarget.z = THREE.MathUtils.clamp(this.grabWorld.z, -1.5, 1.5);
        }
      } else {
        this.motion.turnTo(this.start.tilt + dy * 0.009, this.start.rotation + dx * 0.008);
      }
    });
    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.activePointer) return;
      if (this.drag === 'pull') {
        this.motion.releaseGrab(event.type !== 'pointerup');
        this.onRelease?.();
      } else this.motion.endTurn();
      this.drag = null;
      this.activePointer = null;
      canvas.style.cursor = 'grab';
      this.onGrab?.(false);
      this.gripMarker.classList.remove('active');
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    window.addEventListener('blur', () => this.cancelManipulation());
    canvas.addEventListener('dblclick', () => this.toss());
  }

  private deform(x: number, y: number, z: number, output: THREE.Vector3) {
    const height = THREE.MathUtils.clamp((y + 1.5) / 3.05, 0, 1);
    const weight = 0.15 + height * height * 0.85;
    const offset = this.motion.offset;
    const squeeze = THREE.MathUtils.clamp(offset.y * 0.14, -0.22, 0.22);
    const bendX = this.motion.bend.x * height;
    const bendZ = this.motion.bend.y * height;
    const grip = this.motion.gripOffset;
    const origin = this.motion.gripPoint;
    const distance = (x - origin.x) ** 2 + (y - origin.y) ** 2 + (z - origin.z) ** 2 * 0.45;
    const radius = Math.hypot(x, TOP - y);
    const rind = 1 - THREE.MathUtils.smoothstep(radius, 2.48, 3.1);
    const influence = Math.exp(-distance / 2.2) * (0.18 + rind * 0.82);
    const localSqueeze = THREE.MathUtils.clamp(grip.y * influence * 0.065, -0.06, 0.06);
    // Rotate successive cross-sections so the slice curls rather than just shearing.
    const sideways = x * Math.cos(bendZ) - (y + 1.5) * Math.sin(bendZ);
    const spine = x * Math.sin(bendZ) + (y + 1.5) * Math.cos(bendZ);
    return output.set(
      sideways * (1 - squeeze - localSqueeze) + offset.x * weight + grip.x * influence,
      spine * Math.cos(bendX) - z * Math.sin(bendX) - 1.5 + offset.y * weight + grip.y * influence,
      spine * Math.sin(bendX) + z * Math.cos(bendX) * (1 - squeeze - localSqueeze) + offset.z * weight + grip.z * influence,
    );
  }

  private animate = (timestamp: number) => {
    let dt = Math.min((timestamp - (this.previousTime || timestamp)) / 1000, 0.08);
    this.previousTime = timestamp;
    if (this.slow) dt *= 0.5;
    if (this.paused) dt = 0;
    this.motion.step(dt);
    const point = new THREE.Vector3();
    if (dt > 0) {
      this.group.quaternion.copy(this.motion.orientation);
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(this.motion.orientation).elements;
      let lowest = Infinity;
      for (const { mesh, rest } of this.meshes) {
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          this.deform(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], point);
          positions.setXYZ(i, point.x, point.y, point.z);
          lowest = Math.min(lowest, rotation[1] * point.x + rotation[5] * point.y + rotation[9] * point.z);
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
      this.group.position.copy(this.motion.body).sub(point.copy(CENTER_OF_MASS).applyQuaternion(this.motion.orientation));
      // The soft layer may bulge beyond its rigid contact shell; keep it above the table too.
      this.group.position.y = Math.max(this.group.position.y, FLOOR_Y - lowest + 0.004);
      this.floorClearance = lowest + this.group.position.y - FLOOR_Y;
      this.shadow.position.set(this.motion.body.x, FLOOR_Y, this.motion.body.z);
      this.shadow.scale.set(1 + this.motion.height * 0.25, 1 + this.motion.faceUpness * 0.4 + this.motion.height * 0.25, 1);
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.2, 1 - this.motion.height * 0.5);
      if (this.motion.grabbed) {
        const grip = this.motion.grabPoint;
        this.deform(grip.x, grip.y, grip.z, point);
        point.applyQuaternion(this.group.quaternion).add(this.group.position).project(this.camera);
        const x = (point.x + 1) * this.container.clientWidth / 2;
        const y = (1 - point.y) * this.container.clientHeight / 2;
        this.gripMarker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + this.motion.gripOffset.length() * 0.35})`;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frame++;
  };

  setFirmness(value: number) { this.motion.firmness = value; }
  setDamping(value: number) { this.motion.damping = value; }
  setTranslucency(value: number) {
    if ((this.flesh.transmission > 0) !== (value > 0)) this.flesh.needsUpdate = true;
    this.flesh.transmission = value / 100;
    this.flesh.roughness = THREE.MathUtils.lerp(0.26, 0.085, value / 100);
    this.flesh.color.set(fleshColors[this.palette]).lerp(new THREE.Color(gelColors[this.palette]), value / 100 * 0.55);
  }
  setPalette(palette: Palette) {
    this.palette = palette;
    this.flesh.attenuationColor.set(gelColors[palette]);
    this.setTranslucency(this.flesh.transmission * 100);
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
    this.cancelManipulation();
    this.paused = false;
    this.motion.standUpright();
  }
  private cancelManipulation() {
    const id = this.activePointer;
    this.activePointer = null;
    this.drag = null;
    this.motion.releaseGrab(true);
    this.motion.endTurn();
    if (id !== null && this.renderer.domElement.hasPointerCapture(id)) this.renderer.domElement.releasePointerCapture(id);
    this.renderer.domElement.style.cursor = 'grab';
    this.gripMarker.classList.remove('active');
    this.onGrab?.(false);
  }
  reset() {
    this.cancelManipulation();
    this.motion.reset();
  }
  getStats() {
    return {
      energy: this.motion.energy,
      volume: 100 - Math.min(3.8, this.motion.stretch * 1.8),
      stretch: this.motion.stretch,
      grip: this.motion.gripOffset.length(),
      pickup: this.motion.gripBlend,
      canHop: this.motion.canHop,
      rotation: this.motion.pose.y,
      tilt: this.motion.pose.x,
      bend: this.motion.bend.length(),
      height: this.motion.height,
      x: this.motion.body.x,
      bodyY: this.motion.body.y,
      faceUpness: this.motion.faceUpness,
      clearance: this.floorClearance,
      held: this.motion.grabbed,
      airborne: this.motion.airborne,
      tosses: this.motion.tossCount,
      landings: this.motion.landings,
      transmission: this.flesh.transmission,
      frame: this.frame,
    };
  }
}
