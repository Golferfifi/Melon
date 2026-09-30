# Melon Jelly

A playful, interactive 3D watermelon with an editorial, paper-toned interface. Built with TypeScript, Vite, and Three.js. The fruit, seeds, lighting, and rind textures are generated locally; no APIs, accounts, or external assets are required.

## Run

Use Node.js 22.12 or newer. This cloud environment has Node.js 24.

```sh
npm ci
npm run dev -- --port 5173
```

The development server binds to all interfaces. The cloud environment provides the existing `/workspace/Melon` checkout; use it directly rather than creating an additional Git worktree.

## Play

- Drag the fruit to stretch it, then release to watch it bounce.
- Drag the background to rotate. Hold Shift while pulling for depth.
- Change the palette, firmness, or internal damping.
- Give it a nudge with the button, a double click, or Space.
- Try half speed, the wireframe view, or optional sound.
- Reset with the arrow button or R. Pause freezes the simulation.

The spring-based deformation and live measurements are an artistic approximation, not a scientific soft-body solver. Reduced-motion preferences disable the idle floating motion. A WebGL-capable browser is required.

## Verify

```sh
npm run build
npm test
```

The build includes TypeScript checking. Playwright tests cover the live WebGL scene, controls, drag interactions, and desktop/mobile layouts. Tests use system Chromium when available; otherwise install it with `npx playwright install chromium`. A custom browser path can be supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Browser tests use software WebGL to work in the cloud container.

For a production check, run `npm run preview -- --port 4173` after building. The generated `dist/` directory can be hosted by any static web server.

## Publish automatically with GitHub Pages

In the GitHub repository, open **Settings → Pages** and set the **Build and deployment → Source** to **GitHub Actions**. This is a one-time setting. If GitHub requires a plan change for Pages on a private repository, review that requirement before proceeding; the workflow does not change repository visibility.

The **Deploy Melon Jelly to GitHub Pages** workflow builds and publishes every push to `main`. You can also open **Actions → Deploy Melon Jelly to GitHub Pages → Run workflow** to publish manually, including after enabling Pages for the first time.

Once deployment succeeds, the website is available at **https://golferfifi.github.io/Melon/**. Saving files on your PC does not update the live site until you commit and push those changes to `main`. No running PC or development server is needed for the published site.

Vite uses relative asset URLs so the same production build works under the `/Melon/` project path. The workflow publishes only the generated `dist/` directory.

Dependency and build files remain on disk in an environment snapshot. Running server processes do not survive a new cloud task; start the development server again as needed.
