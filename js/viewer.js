(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var modelUrl = params.get('model');
  var scanId = params.get('scan');

  var container = document.getElementById('viewer-container');
  var errorContainer = document.getElementById('error-container');
  var errorText = document.getElementById('error-text');
  var successCard = document.getElementById('success-card');

  function showError(msg) {
    if (errorText) errorText.textContent = msg || 'Missing model URL.';
    if (errorContainer) errorContainer.style.display = 'block';
    if (successCard) successCard.style.display = 'none';
    container.innerHTML = '';
  }

  function getApiBase() {
    var path = window.location.pathname || '/';
    var dir = path.replace(/\/[^/]*$/, '/') || '/';
    return window.location.origin + dir;
  }

  function showViewer(url) {
    if (errorContainer) errorContainer.style.display = 'none';
    container.innerHTML = '<p class="muted" style="padding: 2rem;">Loading 3D model…</p>';

    function createAndShow() {
      container.innerHTML = '';
      var modelViewer = document.createElement('model-viewer');
      modelViewer.setAttribute('src', url);
      modelViewer.setAttribute('ar', '');
      modelViewer.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
      modelViewer.setAttribute('camera-controls', '');
      modelViewer.setAttribute('touch-action', 'pan-y');
      modelViewer.setAttribute('environment-image', 'neutral');
      modelViewer.setAttribute('shadow-intensity', '1');
      modelViewer.setAttribute('alt', '3D model viewable in AR');
      modelViewer.setAttribute('loading', 'eager');
      modelViewer.setAttribute('reveal', 'auto');

      modelViewer.addEventListener('error', function () {
        container.innerHTML = '<p class="error-msg">Model could not load. Try again or use a new scan link.</p>';
      });

      var arButton = document.getElementById('ar-button');
      if (arButton) {
        arButton.addEventListener('click', function () {
          if (modelViewer.activateAR) modelViewer.activateAR();
        });
      }

      container.appendChild(modelViewer);
      if (successCard) successCard.style.display = 'block';

      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      var hint = successCard && successCard.querySelector('.desktop-hint');
      if (hint) hint.style.display = isMobile ? 'none' : 'block';
    }

    function attachViewer() {
      if (customElements.get('model-viewer')) {
        createAndShow();
      } else {
        customElements.whenDefined('model-viewer').then(createAndShow);
      }
    }

    attachViewer();
  }

  if (window.location.protocol === 'file:') {
    showError('Open this app from a web server. Run "npm start" in the qrview folder and open http://localhost:3000');
    return;
  }

  // Scan flow: fetch model from API (one request, embedded image), then show via blob URL
  if (scanId && scanId.trim()) {
    scanId = scanId.trim().replace(/[^a-zA-Z0-9\-]/g, '');
    var apiUrl = getApiBase() + 'api/model/' + scanId;
    container.innerHTML = '<p class="muted" style="padding: 2rem;">Loading your scan…</p>';
    if (errorContainer) errorContainer.style.display = 'none';

    fetch(apiUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('Scan not found (HTTP ' + r.status + ')');
        var ct = (r.headers.get('Content-Type') || '').toLowerCase();
        if (ct.indexOf('model/gltf-binary') !== -1 || ct.indexOf('application/octet-stream') !== -1) {
          return r.arrayBuffer().then(function (buf) {
            return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
          });
        }
        return r.json().then(function (gltf) {
          var json = JSON.stringify(gltf);
          return URL.createObjectURL(new Blob([json], { type: 'model/gltf+json' }));
        });
      })
      .then(function (blobUrl) {
        showViewer(blobUrl);
      })
      .catch(function (err) {
        showError(err.message || 'Could not load scan. Run "npm start" and use a fresh scan link.');
      });
    return;
  }

  // Model URL flow
  if (!modelUrl || !modelUrl.trim()) {
    modelUrl = 'models/sample.gltf';
  }
  modelUrl = modelUrl.trim();

  if (!/^https?:\/\//i.test(modelUrl)) {
    var path = window.location.pathname || '/';
    var viewerDir = path.replace(/\/[^/]*$/, '/') || '/';
    modelUrl = (window.location.origin + viewerDir + modelUrl.replace(/^\.?\//, '')).replace(/([^:]\/)\/+/g, '$1');
  }

  if (!/^https?:\/\//i.test(modelUrl)) {
    showError('Invalid model URL.');
    return;
  }

  showViewer(modelUrl);
})();
