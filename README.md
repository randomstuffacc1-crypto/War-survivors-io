# Siege Surge

A polished, mobile-first HTML5 canvas game inspired by the lane-choice / crowd-shooter genre. It uses original code and original procedural art; no proprietary game assets are included.

## Play

- Drag left and right on mobile.
- Use **A / D** or **← / →** on desktop.
- Your squad fires automatically.
- Choose gates to grow your squad, damage, fire rate, shield, and multishot.
- Stop enemies before they reach the wall.
- Pick one field upgrade after every wave.
- Boss wave every fifth wave.
- Collect shards and buy permanent Armory upgrades.

Progress is saved locally in the browser using `localStorage`.

## Run locally

Because the game includes a service worker, serve the folder instead of double-clicking the HTML file.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Publish with GitHub Pages

1. Create a new GitHub repository, for example `siege-surge`.
2. Upload every file and folder from this project to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. GitHub will show the public game URL after deployment finishes.

No build command, package manager, API key, or server is required.

## Project layout

```text
index.html              App shell and menus
styles.css              Responsive interface styling
src/game.js             Rendering, controls, combat, waves, upgrades, audio
manifest.webmanifest    Installable PWA metadata
service-worker.js       Offline cache
assets/                  App icons
```

## Customize

The most useful tuning constants are near the top of `src/game.js`:

- `PLAYER_Y`, `WALL_Y`, `ROAD_LEFT`, `ROAD_RIGHT`
- enemy stats in `spawnEnemy()`
- gate probabilities in `makeGateOptions()`
- permanent upgrade definitions in `permanentDefs`

## License

MIT. The game title, design, code, and included procedural art are original to this project.
