import './style.css';
import { Jelly, type Palette } from './jelly';
import { DEFAULT_FIRMNESS, DEFAULT_DAMPING, DEFAULT_TRANSLUCENCY } from './motion';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scene = element('scene');
const paletteNames: Record<Palette, string> = {
  ruby: 'Ruby summer', peach: 'Peach daydream', golden: 'Golden hour',
};
let toastTimer: ReturnType<typeof setTimeout>;
let soundEnabled = false;
let audioContext: AudioContext | undefined;
let jelly: Jelly;

function toast(message: string) {
  const notification = element('toast');
  notification.textContent = message;
  notification.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => notification.classList.remove('visible'), 2500);
}

function playNote() {
  if (!soundEnabled) return;
  audioContext ??= new AudioContext();
  void audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const time = audioContext.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(320 + Math.random() * 160, time);
  oscillator.frequency.exponentialRampToValueAtTime(110, time + 0.18);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.13, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.5);
}

function syncRange(input: HTMLInputElement) {
  input.style.setProperty('--fill', `${input.value}%`);
  element(`${input.id}-value`).textContent = input.value;
}

function updatePause() {
  const pause = element<HTMLButtonElement>('pause');
  pause.setAttribute('aria-pressed', String(jelly.paused));
  pause.innerHTML = jelly.paused
    ? '<span class="pause-symbol" aria-hidden="true">▷</span><span class="pause-text">Resume</span>'
    : '<span class="pause-symbol" aria-hidden="true">Ⅱ</span><span class="pause-text">Pause</span>';
  document.querySelector('.playback-status')!.textContent = jelly.paused ? 'A quiet moment' : 'Let it wobble';
  scene.dataset.paused = String(jelly.paused);
}

function nudge() {
  if (jelly.paused) {
    jelly.paused = false;
    updatePause();
  }
  jelly.nudge();
  playNote();
  element('nudge').classList.remove('nudged');
  requestAnimationFrame(() => element('nudge').classList.add('nudged'));
}

try {
  jelly = new Jelly(scene);
  scene.dataset.ready = 'true';
  scene.dataset.palette = 'ruby';
  scene.dataset.paused = 'false';
  jelly.onGrab = grabbing => {
    updatePause();
    scene.classList.toggle('is-grabbing', grabbing);
    const label = element('interaction-label');
    if (label) {
      label.textContent = grabbing ? 'Pick it up. Let it plop.' : 'Made to be played with.';
      label.classList.toggle('active', grabbing);
    }
  };
  jelly.onRelease = playNote;
  jelly.onToss = () => {
    updatePause();
    playNote();
  };

  document.querySelectorAll<HTMLButtonElement>('button[data-palette]').forEach(button => {
    button.addEventListener('click', () => {
      const palette = button.dataset.palette as Palette;
      jelly.setPalette(palette);
      scene.dataset.palette = palette;
      document.querySelectorAll('button[data-palette]').forEach(other => {
        other.classList.toggle('active', other === button);
        other.setAttribute('aria-pressed', String(other === button));
      });
      element('palette-name').textContent = paletteNames[palette];
      playNote();
    });
  });

  for (const id of ['firmness', 'damping', 'translucency']) {
    const input = element<HTMLInputElement>(id);
    syncRange(input);
    input.addEventListener('input', () => {
      syncRange(input);
      if (id === 'translucency') jelly.setTranslucency(Number(input.value));
      else if (id === 'firmness') jelly.setFirmness(Number(input.value));
      else jelly.setDamping(Number(input.value));
    });
    input.addEventListener('change', () => { if (!jelly.paused && id !== 'translucency') jelly.nudge(0.3); });
  }

  element('nudge').addEventListener('click', nudge);
  element('toss').addEventListener('click', () => jelly.toss());
  element('upright').addEventListener('click', () => {
    jelly.standUpright();
    updatePause();
    toast('Back on your rind.');
  });
  element('reset').addEventListener('click', () => {
    jelly.reset();
    jelly.paused = false;
    jelly.slow = false;
    jelly.setWireframe(false);
    jelly.setFirmness(DEFAULT_FIRMNESS);
    jelly.setDamping(DEFAULT_DAMPING);
    jelly.setTranslucency(DEFAULT_TRANSLUCENCY);
    for (const [id, value] of [['firmness', String(DEFAULT_FIRMNESS)], ['damping', String(DEFAULT_DAMPING)], ['translucency', String(DEFAULT_TRANSLUCENCY)]]) {
      const input = element<HTMLInputElement>(id);
      input.value = value;
      syncRange(input);
    }
    element<HTMLInputElement>('slow-motion').checked = false;
    element<HTMLInputElement>('show-mesh').checked = false;
    document.querySelector<HTMLButtonElement>('button[data-palette="ruby"]')!.click();
    jelly.reset();
    updatePause();
    toast('Fresh slice. Fresh start.');
  });
  element('slow-motion').addEventListener('change', event => {
    jelly.slow = (event.target as HTMLInputElement).checked;
    toast(jelly.slow ? 'Taking the scenic route. ½ speed.' : 'Back to a little more bounce.');
  });
  element('show-mesh').addEventListener('change', event => {
    jelly.setWireframe((event.target as HTMLInputElement).checked);
  });
  element('pause').addEventListener('click', () => {
    jelly.paused = !jelly.paused;
    updatePause();
  });
  element('sound')?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    const sound = element('sound');
    sound.setAttribute('aria-pressed', String(soundEnabled));
    sound.setAttribute('aria-label', soundEnabled ? 'Turn sound off' : 'Turn sound on');
    sound.classList.toggle('is-on', soundEnabled);
    toast(soundEnabled ? 'A little sound with your wobble.' : 'Quiet as a summer afternoon.');
    playNote();
  });
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Space' && target.closest('button, a, summary')) return;
    if (event.repeat) return;
    if (event.code === 'Space' || event.code === 'KeyT') {
      event.preventDefault();
      jelly.toss();
    }
    if (event.code === 'KeyU') element('upright').click();
    if (event.code === 'KeyR') element('reset').click();
  });
  setInterval(() => {
    const stats = jelly.getStats();
    element('energy-value').textContent = stats.energy.toFixed(3);
    element('volume-value').textContent = stats.volume.toFixed(1);
    scene.dataset.stretch = stats.stretch.toFixed(3);
    scene.dataset.rotation = stats.rotation.toFixed(3);
    scene.dataset.tilt = stats.tilt.toFixed(3);
    scene.dataset.bend = stats.bend.toFixed(3);
    scene.dataset.height = stats.height.toFixed(3);
    scene.dataset.airborne = String(stats.airborne);
    scene.dataset.tosses = String(stats.tosses);
    scene.dataset.landings = String(stats.landings);
    scene.dataset.transmission = stats.transmission.toFixed(2);
    scene.dataset.x = stats.x.toFixed(3);
    scene.dataset.bodyY = stats.bodyY.toFixed(3);
    scene.dataset.faceUpness = stats.faceUpness.toFixed(3);
    scene.dataset.clearance = stats.clearance.toFixed(3);
    scene.dataset.held = String(stats.held);
  }, 100);
  updatePause();
} catch (error) {
  console.error('The 3D canvas could not start.', error);
  scene.dataset.ready = 'false';
  scene.innerHTML = '<div class="scene-fallback"><span>Something needs a little nudge.</span><p>This experiment needs WebGL. Please enable hardware acceleration in your browser, then refresh.</p></div>';
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.specimen-panel input, .specimen-panel button').forEach(control => { control.disabled = true; });
}
