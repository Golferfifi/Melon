import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type Palette = 'ruby' | 'peach' | 'golden';
type SoftMesh = { mesh: THREE.Mesh; rest: Float32Array };

const TOP = 1.55;
const RADIUS = 3.04;
const ANGLE = 0.49;
const DEPTH = 1.04;
const FLESH_RADIUS = 2.65;
const PITH_RADIUS = 2.8;
const fleshColors: Record<Palette, string> = {
  ruby: '#ea354c', peach: '#f98a57', golden: '#f8bd27',
};

function faceDepth(radius: number, angle: number) {
  return DEPTH / 2 + 0.065 + 0.035 * Math.sin(Math.min(radius / RADIUS, 1) * Math.PI) * Math.cos(angle / ANGLE * Math.PI / 2);
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
  const subdivided = new TessellateModifier(0.16, 5).modify(extruded);
  extruded.dispose();
  const positions = subdivided.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const radius = Math.hypot(x, TOP - y);
    const angle = Math.atan2(x, TOP - y);
    const bulge = 0.035 * Math.sin(Math.min(radius / RADIUS, 1) * Math.PI) * Math.max(0, Math.cos(angle / ANGLE * Math.PI / 2));
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
  private seeds: { mesh: THREE.Mesh; rest: THREE.Vector3 }[] = [];
  private flesh: THREE.MeshPhysicalMaterial;
  private materials: THREE.MeshPhysicalMaterial[] = [];
  private position = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private target = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private rotation = 0.62;
  private rotationTarget = 0.62;
  private tiltTarget = 0.1;
  private drag: 'pull' | 'spin' | null = null;
  private start = { x: 0, y: 0, rotation: 0, tilt: 0 };
  private previousTime = 0;
  private time = 0;
  private frame = 0;
  private firmness = 58;
  private damping = 34;
  private resizeObserver: ResizeObserver;
  private shadow: THREE.Mesh;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  public paused = false;
  public slow = false;
  public onGrab: ((grabbing: boolean) => void) | null = null;
  public onRelease: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor(0xf8f7f4, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D jelly watermelon. Drag the slice to stretch it, or drag the background to rotate it. Use the controls to change its color and bounce.');
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
      color: fleshColors.ruby, roughness: 0.24, metalness: 0,
      transmission: 0.13, thickness: 1.1, ior: 1.38,
      clearcoat: 0.85, clearcoatRoughness: 0.17, envMapIntensity: 0.65,
      side: THREE.DoubleSide, attenuationColor: new THREE.Color('#ee6675'), attenuationDistance: 2,
    });
    const pith = new THREE.MeshPhysicalMaterial({ color: '#c9d99c', roughness: 0.4, clearcoat: 0.3, side: THREE.DoubleSide });
    const texture = rindTexture();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.5, 0.8);
    const skin = new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.3, clearcoat: 0.55, side: THREE.DoubleSide });
    this.materials = [this.flesh, pith, skin];
    this.addSoft(roundedVolume(0, FLESH_RADIUS, 0.065), this.flesh);
    this.addSoft(roundedVolume(FLESH_RADIUS, PITH_RADIUS, 0.025), pith);
    this.addSoft(roundedVolume(PITH_RADIUS, RADIUS, 0.065), skin);
    this.createSeeds();
    this.group.rotation.set(0.1, this.rotation, 0.12);
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
        seed.position.set(Math.sin(angle) * row.radius, TOP - Math.cos(angle) * row.radius, z * (faceDepth(row.radius, angle) + 0.007));
        seed.scale.set(0.038 + (i % 2) * 0.004, 0.094 + (ri % 2) * 0.008, 0.014);
        seed.rotation.z = -angle + Math.sin(i * 4 + ri) * 0.18;
        this.seeds.push({ mesh: seed, rest: seed.position.clone() });
        this.group.add(seed);
      }));
    }
    // Tiny suspended flecks give the fruit a softer, translucent surface.
    const fleckMaterial = new THREE.MeshBasicMaterial({ color: '#ffe0cb', transparent: true, opacity: 0.32 });
    const fleckGeometry = new THREE.SphereGeometry(0.012, 5, 4);
    for (let i = 0; i < 72; i++) {
      const angle = Math.sin(i * 78.23) * 0.5;
      const radius = 0.45 + ((i * 0.618) % 1) * 2.28;
      const fleck = new THREE.Mesh(fleckGeometry, fleckMaterial);
      fleck.position.set(Math.sin(angle) * radius, TOP - Math.cos(angle) * radius, faceDepth(radius, angle) + 0.003);
      fleck.scale.set(0.7, 1.5, 0.3);
      this.seeds.push({ mesh: fleck, rest: fleck.position.clone() });
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
      if (event.button !== 0) return;
      this.updatePointer(event);
      this.drag = this.raycaster.intersectObjects(this.group.children).length ? 'pull' : 'spin';
      this.start = { x: event.clientX, y: event.clientY, rotation: this.rotationTarget, tilt: this.tiltTarget };
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
      const dx = event.clientX - this.start.x;
      const dy = event.clientY - this.start.y;
      if (this.drag === 'pull') {
        const scale = 5 / this.container.clientHeight;
        this.target.set(THREE.MathUtils.clamp(dx * scale, -1.5, 1.5), THREE.MathUtils.clamp(-dy * scale, -1, 1.3), event.shiftKey ? THREE.MathUtils.clamp(-dy * scale * 2, -1.5, 1.5) : 0);
      } else {
        this.rotationTarget = this.start.rotation + dx * 0.008;
        this.tiltTarget = THREE.MathUtils.clamp(this.start.tilt + dy * 0.003, -0.55, 0.55);
      }
    });
    const release = () => {
      if (this.drag === 'pull') this.onRelease?.();
      this.drag = null;
      this.target.set(0, 0, 0);
      canvas.style.cursor = 'grab';
      this.onGrab?.(false);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('dblclick', () => this.nudge());
  }

  private deform(x: number, y: number, z: number, output: THREE.Vector3) {
    const height = THREE.MathUtils.clamp((y + 1.5) / 3.05, 0, 1);
    const weight = 0.15 + height * height * 0.85;
    const squeeze = this.position.y * 0.14;
    return output.set(x * (1 - squeeze) + this.position.x * weight,
      y + this.position.y * weight + Math.sin(height * Math.PI) * this.position.x * 0.13,
      z * (1 - squeeze) + this.position.z * weight + this.position.x * height * 0.09);
  }

  private animate = (timestamp: number) => {
    let dt = Math.min((timestamp - (this.previousTime || timestamp)) / 1000, 0.032);
    this.previousTime = timestamp;
    if (this.slow) dt *= 0.5;
    if (this.paused) dt = 0;
    this.time += dt;
    const stiffness = 18 + this.firmness * 0.8;
    const drag = 1.0 + this.damping * 0.16;
    for (let step = 0; step < 3; step++) {
      const sub = dt / 3;
      this.velocity.x += ((this.target.x - this.position.x) * stiffness - this.velocity.x * drag) * sub;
      this.velocity.y += ((this.target.y - this.position.y) * stiffness - this.velocity.y * drag) * sub;
      this.velocity.z += ((this.target.z - this.position.z) * stiffness - this.velocity.z * drag) * sub;
      this.position.addScaledVector(this.velocity, sub);
    }
    const point = new THREE.Vector3();
    if (dt > 0) {
      for (const { mesh, rest } of this.meshes) {
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          this.deform(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], point);
          positions.setXYZ(i, point.x, point.y, point.z);
        }
        positions.needsUpdate = true;
        if (this.frame % 3 === 0) mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
      for (const seed of this.seeds) {
        this.deform(seed.rest.x, seed.rest.y, seed.rest.z, seed.mesh.position);
      }
      this.rotation = THREE.MathUtils.damp(this.rotation, this.rotationTarget, 9, dt);
      this.group.rotation.y = this.rotation;
      this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, this.tiltTarget, 9, dt);
      this.group.rotation.z = 0.12 + this.position.x * 0.035;
      this.group.position.y = this.reducedMotion ? 0 : Math.sin(this.time * 1.45) * 0.035;
      this.shadow.scale.setScalar(1 + this.position.y * 0.045);
    }
    this.renderer.render(this.scene, this.camera);
    this.frame++;
  };

  setFirmness(value: number) { this.firmness = value; }
  setDamping(value: number) { this.damping = value; }
  setPalette(palette: Palette) {
    this.flesh.color.set(fleshColors[palette]);
    this.flesh.attenuationColor.set(fleshColors[palette]);
    this.nudge(0.45);
  }
  setWireframe(enabled: boolean) { this.materials.forEach(material => material.wireframe = enabled); }
  nudge(strength = 1) {
    this.velocity.add(new THREE.Vector3((Math.random() > 0.5 ? 1 : -1) * 7 * strength, 3.5 * strength, 2 * strength));
  }
  reset() {
    this.target.set(0, 0, 0);
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.rotationTarget = 0.62;
    this.tiltTarget = 0.1;
    this.time = 0;
  }
  getStats() {
    return { energy: this.velocity.lengthSq() * 0.028, volume: 100 - Math.min(3.8, this.position.length() * 1.8), stretch: this.position.length(), rotation: this.rotation, frame: this.frame };
  }
}
