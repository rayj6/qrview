/**
 * Local server: serves the app and provides POST /api/create-model
 * to turn scanned photos into a 3D model.
 *
 * By default: your photo is shown on a flat card (quick preview).
 * For real 3D objects (cup, lamp, earbuds): set TRIPO_API_KEY and
 * PUBLIC_BASE_URL in .env to use Tripo's image-to-3D API.
 *
 * Run: node server.js
 * Then open http://localhost:3000
 */

require('dotenv').config();

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname);
const TRIPO_API_KEY = process.env.TRIPO_API_KEY || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const TRIPO_TASK_URL = 'https://api.tripo3d.ai/v2/openapi/task';

// In-memory store for multipart parsing (simple approach)
const boundaryRegex = /boundary=(?:"([^"]+)"|([^\s;]+))/i;

function parseMultipart(body, boundary) {
  if (!Buffer.isBuffer(body)) body = Buffer.from(body);
  const parts = [];
  // First part starts after "--boundary\r\n"; subsequent parts after "\r\n--boundary\r\n"
  const startDelim = Buffer.from('--' + boundary + '\r\n');
  const nextDelim = Buffer.from('\r\n--' + boundary);
  let pos = 0;
  if (body.slice(0, startDelim.length).equals(startDelim)) {
    pos = startDelim.length;
  }
  while (pos < body.length) {
    const next = body.indexOf(nextDelim, pos);
    const chunk = next === -1 ? body.slice(pos) : body.slice(pos, next);
    pos = next === -1 ? body.length : next + nextDelim.length;
    if (chunk.length === 0) continue;
    const headEnd = chunk.indexOf(Buffer.from('\r\n\r\n'));
    if (headEnd === -1) continue;
    const headers = chunk.slice(0, headEnd).toString('utf8');
    const content = chunk.slice(headEnd + 4);
    const nameMatch = headers.match(/name="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : null;
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : null;
    const trim = content.length >= 2 && content[content.length - 1] === 0x0a && content[content.length - 2] === 0x0d ? 2 : 0;
    const contentTrimmed = trim ? content.slice(0, content.length - trim) : content;
    parts.push({ name, filename, content: contentTrimmed });
  }
  return parts;
}

function createQuadGltf(imageFilename) {
  // imageFilename: "capture-1.jpg" - relative to the glTF file so the loader fetches from same folder
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const posLen = positions.byteLength;
  const uvLen = uvs.byteLength;
  const idxLen = indices.byteLength;
  const totalLen = posLen + uvLen + idxLen;
  const combined = Buffer.alloc(totalLen);
  Buffer.from(positions.buffer).copy(combined, 0);
  Buffer.from(uvs.buffer).copy(combined, posLen);
  Buffer.from(indices.buffer).copy(combined, posLen + uvLen);
  const dataUri = 'data:application/octet-stream;base64,' + combined.toString('base64');

  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 },
        indices: 2,
        material: 0
      }]
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1
      }
    }],
    textures: [{ source: 0 }],
    images: [{ uri: imageFilename }],
    buffers: [{ uri: dataUri, byteLength: totalLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posLen, target: 34962 },
      { buffer: 0, byteOffset: posLen, byteLength: uvLen, target: 34962 },
      { buffer: 0, byteOffset: posLen + uvLen, byteLength: idxLen, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, byteOffset: 0, componentType: 5123, count: 6, type: 'SCALAR' }
    ]
  };
}

function createQuadGltfEmbedded(imageBuffer) {
  const imageUri = 'data:image/jpeg;base64,' + (Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer)).toString('base64');
  const gltf = createQuadGltf('capture-1.jpg');
  gltf.images[0].uri = imageUri;
  return gltf;
}

function httpsRequest(opts, postBody) {
  return new Promise((resolve, reject) => {
    const bodyStr = postBody ? (typeof postBody === 'string' ? postBody : JSON.stringify(postBody)) : '';
    const optsWithLength = { ...opts, headers: { ...(opts.headers || {}) } };
    if (bodyStr) optsWithLength.headers['Content-Length'] = Buffer.byteLength(bodyStr, 'utf8');
    const req = https.request(optsWithLength, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: data ? JSON.parse(data) : null, raw: data });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000);
    if (bodyStr) req.write(bodyStr, 'utf8');
    req.end();
  });
}

function bufferToDataUri(buf) {
  return 'data:image/jpeg;base64,' + (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString('base64');
}

async function tripoCreateAndPoll(taskBody) {
  const createRes = await httpsRequest({
    hostname: 'api.tripo3d.ai',
    path: '/v2/openapi/task',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TRIPO_API_KEY
    }
  }, taskBody);

  const taskId = (createRes.data && (createRes.data.data && createRes.data.data.task_id) || createRes.data.task_id) || null;
  if (createRes.statusCode !== 200 || !taskId) {
    const msg = createRes.data?.message || createRes.data?.msg || createRes.data?.error || 'Tripo create task failed';
    console.error('Tripo create response:', createRes.raw || JSON.stringify(createRes.data));
    throw new Error(msg);
  }

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await httpsRequest({
      hostname: 'api.tripo3d.ai',
      path: '/v2/openapi/task/' + encodeURIComponent(taskId),
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + TRIPO_API_KEY }
    });

    if (statusRes.statusCode !== 200 || !statusRes.data) continue;
    const d = statusRes.data.data || statusRes.data;
    if (d.status === 'success' && d.output) {
      const modelUrl = d.output.model || d.output.pbr_model || d.output.model_mesh;
      if (modelUrl && (typeof modelUrl === 'string' ? modelUrl : modelUrl.url)) {
        return typeof modelUrl === 'string' ? modelUrl : modelUrl.url;
      }
    }
    if (d.status === 'failed') throw new Error(d.message || 'Tripo generation failed');
  }
  throw new Error('Tripo timeout');
}

async function tripoImageToModel(imageInput) {
  // imageInput: URL (string) or image buffer (Buffer). Try top-level, then input wrapper, then "image" key.
  const imagePayload = Buffer.isBuffer(imageInput)
    ? bufferToDataUri(imageInput)
    : imageInput;
  const bodies = [
    { type: 'image_to_model', image_url: imagePayload },
    { type: 'image_to_model', input: { image_url: imagePayload } },
    { type: 'image_to_model', image: imagePayload },
    { type: 'image_to_model', input: { image: imagePayload } }
  ];
  let lastErr;
  for (const body of bodies) {
    try {
      return await tripoCreateAndPoll(body);
    } catch (e) {
      lastErr = e;
      if (!e.message || !e.message.includes('invalid')) throw e;
    }
  }
  throw lastErr;
}

// Multi-view: use URLs so the request body stays small. Tripo openapi uses type "multiview_to_model".
// Code 1004 "parameter invalid" often means image URLs must be under "input", or URLs are unreachable (check ngrok).
async function tripoMultiviewToModel(scanId, publicBaseUrl, numViews) {
  if (!scanId || !publicBaseUrl || numViews < 2) return null;
  const base = publicBaseUrl.replace(/\/$/, '') + '/scans/' + scanId;
  const imageUrls = {
    front_image_url: base + '/capture-1.jpg',
    back_image_url: base + '/capture-2.jpg',
    left_image_url: base + '/capture-3.jpg',
    right_image_url: base + '/capture-4.jpg'
  };
  // Try nested "input" first (openapi schema often requires this)
  const bodyWithInput = {
    type: 'multiview_to_model',
    input: imageUrls
  };
  try {
    return await tripoCreateAndPoll(bodyWithInput);
  } catch (e) {
    if (!e.message || !e.message.includes('invalid')) throw e;
    // Fallback: params at top level
    const bodyTop = { type: 'multiview_to_model', ...imageUrls };
    return tripoCreateAndPoll(bodyTop);
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  let pathname = parsed.pathname || '/';
  try { pathname = decodeURIComponent(pathname); } catch (_) {}

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: create 3D model from scanned images
  if (req.method === 'POST' && pathname === '/api/create-model') {
    let body = [];
    for await (const chunk of req) body.push(chunk);
    body = Buffer.concat(body);

    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(boundaryRegex);
    const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim().replace(/--$/, '') : null;

    if (!boundary) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing multipart boundary' }));
      return;
    }

    const parts = parseMultipart(body, boundary);
    const images = parts.filter(p => p.name === 'images' && p.content && p.content.length > 0);

    if (images.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No images provided' }));
      return;
    }

    const id = 'scan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const scanDir = path.join(ROOT, 'scans', id);
    fs.mkdirSync(scanDir, { recursive: true });

    const firstFilename = 'capture-1.jpg';
    const firstPath = path.join(scanDir, firstFilename);
    fs.writeFileSync(firstPath, images[0].content);

    for (let i = 1; i < images.length; i++) {
      fs.writeFileSync(path.join(scanDir, 'capture-' + (i + 1) + '.jpg'), images[i].content);
    }

    const baseUrl = 'http://' + (req.headers.host || 'localhost:' + PORT);

    // Tripo API: 1 image = image_to_model (data URI). 2+ = multiview via URLs (needs PUBLIC_BASE_URL so Tripo can fetch images).
    if (TRIPO_API_KEY && images.length > 0) {
      try {
        let modelUrlFromApi = null;
        if (images.length === 1) {
          modelUrlFromApi = await tripoImageToModel(images[0].content);
        } else if (PUBLIC_BASE_URL) {
          try {
            modelUrlFromApi = await tripoMultiviewToModel(id, PUBLIC_BASE_URL, Math.min(images.length, 4));
          } catch (mvErr) {
            // 1004 = parameter invalid — fall back to single-image. Try URL first (Tripo may not accept data URI).
            console.warn('Tripo multiview failed:', mvErr.message, '— using first image only (image_to_model).');
            try {
              const firstImageUrl = PUBLIC_BASE_URL.replace(/\/$/, '') + '/scans/' + id + '/capture-1.jpg';
              modelUrlFromApi = await tripoImageToModel(firstImageUrl);
            } catch (_) {
              modelUrlFromApi = await tripoImageToModel(images[0].content);
            }
          }
        } else {
          console.warn('Multiview needs PUBLIC_BASE_URL in .env (so Tripo can fetch images). Using first image only.');
          modelUrlFromApi = await tripoImageToModel(images[0].content);
        }
        if (modelUrlFromApi) {
          const modelRes = await fetch(modelUrlFromApi);
          if (modelRes.ok) {
            const buf = Buffer.from(await modelRes.arrayBuffer());
            const ext = (modelUrlFromApi.toLowerCase().includes('.glb') ? '.glb' : '.gltf');
            fs.writeFileSync(path.join(scanDir, 'reconstructed' + ext), buf);
          }
        }
      } catch (e) {
        console.warn('Tripo API failed:', e.message);
        console.warn('Tip: 1004 (parameter invalid) often means image URLs must return actual images (not HTML). If using ngrok, the interstitial page may be returned; try deploying to a server or use a tunnel that serves files directly.');
      }
    }

    const gltf = createQuadGltf(firstFilename);
    fs.writeFileSync(path.join(scanDir, 'model.gltf'), JSON.stringify(gltf, null, 0));

    const modelUrl = baseUrl + '/scans/' + id + '/model.gltf';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ modelUrl, scanId: id }));
    return;
  }

  // GET /api/model/:id - return reconstructed 3D model if present, else embedded photo-on-quad
  if (req.method === 'GET' && pathname.startsWith('/api/model/')) {
    const id = pathname.replace(/^\/api\/model\//, '').replace(/[^a-zA-Z0-9\-]/g, '');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing scan id' }));
      return;
    }
    const scanDir = path.join(ROOT, 'scans', id);
    const reconstructedGlb = path.join(scanDir, 'reconstructed.glb');
    const reconstructedGltf = path.join(scanDir, 'reconstructed.gltf');
    if (fs.existsSync(reconstructedGlb) && fs.statSync(reconstructedGlb).isFile()) {
      const data = fs.readFileSync(reconstructedGlb);
      res.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
      return;
    }
    if (fs.existsSync(reconstructedGltf) && fs.statSync(reconstructedGltf).isFile()) {
      const data = fs.readFileSync(reconstructedGltf);
      res.writeHead(200, {
        'Content-Type': 'model/gltf+json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
      return;
    }
    const jpgPath = path.join(scanDir, 'capture-1.jpg');
    if (!fs.existsSync(jpgPath) || !fs.statSync(jpgPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Scan not found' }));
      return;
    }
    const imageBuffer = fs.readFileSync(jpgPath);
    const gltf = createQuadGltfEmbedded(imageBuffer);
    res.writeHead(200, {
      'Content-Type': 'model/gltf+json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(gltf));
    return;
  }

  // Serve scan assets explicitly (model.gltf and images)
  if (pathname.startsWith('/scans/')) {
    const relPath = pathname.replace(/^\/scans\//, '').replace(/\.\./g, '');
    const segs = relPath.split('/').filter(Boolean);
    const filePath = path.join(ROOT, 'scans', ...segs);
    const scansDir = path.join(ROOT, 'scans');
    const inScans = path.resolve(filePath).startsWith(path.resolve(scansDir));
    if (!inScans || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const types = { '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
      res.writeHead(200, {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
    return;
  }

  // Serve static files
  const segs = pathname.split('/').filter(Boolean);
  let filePath = path.join(ROOT, ...(segs.length ? segs : ['index.html']));
  if (pathname === '/' || pathname === '') filePath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Server at http://localhost:' + PORT);
  console.log('Create page: http://localhost:' + PORT + '/create.html');
  console.log('API: POST /api/create-model (multipart form "images")');
  if (TRIPO_API_KEY) {
    console.log('Tripo image-to-3D: ENABLED — scans will produce real 3D models (not just photo-on-card).');
    if (!PUBLIC_BASE_URL) console.log('  Set PUBLIC_BASE_URL in .env for 4/6-view multiview (e.g. ngrok URL).');
  } else {
    console.log('Tripo: disabled. Add TRIPO_API_KEY to .env for real 3D from scans.');
  }
});
