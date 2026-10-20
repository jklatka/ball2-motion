# Ball 2 Motion Lab — web edition

Open the hosted page on an iPad, Windows PC, Mac, or other modern browser. The Ball 2 phone app connects directly to the hosted receiver over secure WebSockets. No Mac or local server is needed after deployment.

## Put it online with Render

This folder is a complete Node web service, not a static website. Its public page and WebSocket receiver run together. Use **one instance**: pairing state lives in that process.

1. Create a GitHub repository and upload the contents of this folder. Put `package.json`, `package-lock.json`, `server.mjs`, `public/`, and `render.yaml` at the repository root. Do not upload `node_modules/` or `work/`.
2. Sign in at https://dashboard.render.com/. Choose **New → Web Service**, then connect that repository.
3. Set **Language: Node**, **Build command: `npm ci`**, **Start command: `npm start`**, and **Health check path: `/health`**. Choose one instance. The included `render.yaml` also describes these settings for a Render Blueprint.
4. Review the selected plan and its current terms in Render before deploying. The blueprint requests the free plan; no paid service has been created by this project. Free services can spin down or restart. For a new session, open the webpage first, wait for it to load, and generate a new pairing address if the previous one expired.
5. Deploy. Render supplies an HTTPS address, typically ending in `.onrender.com`. Open that address on the iPad. Do not append `:8080`: Render handles the public HTTPS/WebSocket port.

The Render and Railway integrations are disabled by the current workspace administrator. The source has been prepared and tested locally; it has **not** been deployed, and there is no live cloud URL yet.

Official deployment instructions: https://render.com/docs/deploy-node-express-app

## Use it

1. Keep **Ball 2 → Sensor Lab** open on a phone connected to the ball over Bluetooth. The phone and iPad both need internet; they do not need to share a Wi-Fi network when using the hosted service.
2. Open the hosted page on the iPad. Copy the **Ball 2 stream address** from its connection section. It starts with `wss://` and includes this session's private pairing path.
3. Put the complete address into **Sensor Lab → Stream**, enable **Raw IMU stream**, then tap **Connect**. If copy/paste is across devices, use your usual device sharing method or type the full address carefully.
4. When the page says **Ball connected · live data**, press **Start**. Press **Stop** at the end of your motion. Start replaces the previous trial after a confirmation. Stop preserves the graphs.
5. Tap a graph to see a sampled value and its estimated local slope. Drag horizontally to shade an interval across all three graphs. The sidebar reports average slope, a time-weighted mean, signed peak, minimum, and maximum. Arrow keys on a focused chart inspect neighboring samples.
6. Select **X**, **Y**, or **Z**. Your requested mapping is retained: graph X = device X, graph Y = device Z, graph Z = device Y. Signs are unchanged.
7. Use **Export CSV** before closing or refreshing. On iPad, save the CSV through Safari's download/share interface. You may also use Safari's **Add to Home Screen** to create a shortcut to the site.

Keep the graph page in the foreground during collection. Leaving it stops the trial to avoid misleading data gaps. Use a phone for the Ball 2 app and a separate iPad/browser for the graphs. Running both on one iPad has not been verified; leaving Sensor Lab may disconnect its stream.

## What is measured

Velocity comes from Ball 2's velocity estimate. Position is a trapezoidal integral of velocity, starting at zero for each trial. Acceleration is a backward difference of velocity. These are estimates, not independently measured position or impact force.

Point slopes use a local three-sample derivative where available, with a two-sample one-sided difference at boundaries. Region average slope is endpoint change divided by elapsed time. Region means integrate the piecewise-linear plotted values over time, with interpolated boundaries. Peak means the value with the greatest absolute magnitude, retaining its sign; positive maximum and negative minimum are also shown. Short impact spikes can be affected by sensor limitations and noise.

Data gaps longer than 0.5 seconds, sensor clock restarts, connection losses, or changing balls end the trial instead of inventing a continuous trajectory. Trials stop at 200,000 samples to bound browser memory. Canvas display downsampling retains minima and maxima; calculations use the original recorded samples.

## Privacy and persistence

The dashboard is a public shell, but each session uses cryptographically random pairing and viewing keys. Keep the pairing URL private. The sensor-upload key cannot be used as the viewer key. The server does not write sensor data to disk or a database: it relays live samples to authorized viewers. Graph data is held in the viewing browser's memory until cleared, refreshed, or closed.

Pairing keys are stored in that tab's session storage. A server restart/deployment invalidates its in-memory sessions; create a new pairing address and reconnect the phone. Disconnected sessions expire after 30 minutes with no viewers. For multiple server instances or persistent/shared trials, add shared storage and coordination first.

## Local development (optional)

Requires Node 22 or later.

```sh
npm ci
npm test
npm start
```

Open `http://localhost:3000`. The phone needs your computer's reachable LAN address during local testing; `localhost` on the phone means the phone itself. Hosted deployment removes that requirement.

Validation includes known-motion calculations, axis mapping, recording boundaries, region statistics, private-session isolation, rejected credentials, duplicate-producer handling, streaming, and disconnect status. Browser interaction was also checked with simulated data. Real Ball 2-to-Render streaming and real iPad hardware need a final check after deployment.
