# AR QR Viewer

Scan QR codes with your smartphone’s **default camera app** to open 3D models in **Augmented Reality (WebAR)**. No extra app: point the camera at the code, tap the link, and view the model in your space.

Works on **iOS**, **Android**, and **Apple Vision Pro**.

---

## Quick start

1. **Serve the project over HTTP** (required for WebAR and camera links):

   ```bash
   npx serve .
   ```
   Or use any static host (e.g. `python -m http.server 8080`, or deploy to Netlify/Vercel/GitHub Pages).

2. Open **http://localhost:3000** (or your URL) in a browser.

3. **Create an AR code**
   - Go to **Create AR Code**.
   - Paste the URL of a **.glb** or **.gltf** model (must be publicly reachable and CORS‑friendly).
   - Click **Generate QR code**.
   - Scan the QR with your phone’s camera, tap the link, and use “View in your space” for AR.

4. **Try the demo**
   - On the home page, click **Open demo model in AR** (or open that link on your phone) to see a sample 3D model in the viewer/AR.

---

## How it works

| Step | What happens |
|------|-------------------------------|
| 1 | User opens the **default camera app** (no extra app). |
| 2 | Camera sees a **QR code** that encodes a URL to `viewer.html?model=<url-of-glb>`. |
| 3 | User **taps the link** shown by the camera. |
| 4 | Browser opens the **viewer** page, which loads the 3D model and offers **WebAR** (e.g. Quick Look on iOS, Scene Viewer on Android). |

- **Create AR Code** (`create.html`): you enter a 3D model URL and get a QR code (and shareable link) that points to the viewer with that model.
- **Viewer** (`viewer.html`): reads `?model=<url>`, loads the model with [model-viewer](https://modelviewer.dev/), and supports AR via `ar`, `ar-modes="webxr scene-viewer quick-look"`.

---

## Project structure

```
ar-qr-viewer/
├── index.html      # Landing + how it works + demo link
├── create.html     # Generate QR code for a model URL
├── viewer.html     # WebAR viewer (?model=...)
├── css/
│   └── style.css
├── js/
│   ├── viewer.js   # Viewer logic
│   └── create.js   # QR generation
├── package.json
└── README.md
```

---

## Hosting 3D models

- Models must be **publicly accessible** over HTTPS and **CORS-enabled** if on another domain.
- Use **.glb** or **.gltf** (with relative or absolute paths for external resources).
- You can host files on:
  - Your own server
  - [echo3D](https://www.echo3d.com/), [AR Code](https://www.ar-code.com/), or similar platforms
  - GitHub (raw), or a CDN that allows cross-origin requests

---

## Real 3D object from your scan (Tripo API)

By default, scanning a product gives you a **quick preview**: your photo on a flat card. To get a **real 3D mesh** (cup, lamp, earbuds, etc.), use the **Tripo image-to-3D API**:

1. **Get a Tripo API key** at [tripo3d.ai/api](https://tripo3d.ai/api) (key format: `tsk_...`).

2. **Create a `.env` file** in the `qrview` folder (copy from `.env.example`):
   ```env
   TRIPO_API_KEY=tsk_your_actual_key_here
   PUBLIC_BASE_URL=https://your-public-url
   ```
   - **TRIPO_API_KEY**: your Tripo API key.
   - **PUBLIC_BASE_URL**: public URL where this server is reachable. Tripo must be able to **fetch the actual image** from `PUBLIC_BASE_URL/scans/<id>/capture-1.jpg`.  
     **Important:** Free [ngrok](https://ngrok.com/) shows a "Visit Site" interstitial, so Tripo gets HTML instead of the image and returns "parameter invalid". Use one of these instead:
     - **Deploy** the app (e.g. [Railway](https://railway.app), [Render](https://render.com), or a VPS) and set `PUBLIC_BASE_URL` to your app URL.
     - **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3000` — no interstitial, so Tripo can fetch images.
     - **Paid ngrok** or a tunnel that serves files directly without a browser warning.

3. **Run the server**:
   ```bash
   cd qrview
   npm install
   npm start
   ```

4. **Scan a product** (Create → capture photo → Create 3D model & AR code). The server will send the image to Tripo, wait for the 3D model, and save it. The viewer will show the **reconstructed 3D object** instead of the flat card.

**If you see "One or more of your parameter is invalid" (code 1004):** Tripo fetches your image from the URL you provide. If the URL returns **HTML** instead of the image (e.g. ngrok’s **"Visit Site"** interstitial), Tripo returns 1004. Use a tunnel/host that serves the image directly (Cloudflare Tunnel, or deploy to Railway/Render) — see **PUBLIC_BASE_URL** above. You still get the **photo-on-quad** preview when Tripo fails.

---

## Use cases

- **AR previews:** Let customers view products (furniture, sports gear) in their space via a QR on packaging or print.
- **Share 3D scans:** Export scans as .glb, host them, create a QR code, and share the link.
- **Product information:** Link from a physical QR to an interactive 3D model and AR.
- **3D printed QR codes:** Use tools like **QRCode2STL** or **MakerWorld** to create physical QR codes that open this viewer (or your deployed version) with your 3D/AR content.

---

## Deployment

**Viewer only (static):** Deploy the folder as a static site to **Vercel**, **Netlify**, or **GitHub Pages**. The viewer and demo/sample link work; the **Create AR Code** page (paste URL) also works. The **scan → 3D model** flow does **not** work on static hosting because it needs the Node server.

**Scan + Tripo (full app):** The **Scan product → 3D model & AR code** feature needs the Node server (`node server.js`) to receive uploads, save images, and call the Tripo API. Deploy to a platform that runs Node and allows file storage, for example:

- **[Railway](https://railway.app)** — connect repo, set `TRIPO_API_KEY` and `PUBLIC_BASE_URL` (your Railway URL) in Variables, run `npm start`.
- **[Render](https://render.com)** — create a Web Service, build command `npm install`, start command `npm start`, add env vars.

Use **HTTPS** in production so camera-app QR links open correctly and WebAR works on all supported devices.

---

## Browser / device support

- **iOS:** Safari, Quick Look for AR.
- **Android:** Chrome (or default browser), Scene Viewer for AR.
- **Apple Vision Pro:** Safari with WebXR / Quick Look where supported.

The viewer uses `model-viewer` with `ar-modes="webxr scene-viewer quick-look"` so it can use the best available AR path on each device.
