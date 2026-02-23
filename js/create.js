(function () {
  'use strict';

  var video = document.getElementById('camera-video');
  var placeholder = document.getElementById('camera-placeholder');
  var openCameraBtn = document.getElementById('open-camera-btn');
  var afterCamera = document.getElementById('after-camera');
  var captureBtn = document.getElementById('capture-btn');
  var capturesRow = document.getElementById('captures-row');
  var createModelBtn = document.getElementById('create-model-btn');
  var scanSection = document.getElementById('scan-section');
  var processingSection = document.getElementById('processing-section');
  var resultCard = document.getElementById('result-card');
  var qrcodeEl = document.getElementById('qrcode');
  var arLinkEl = document.getElementById('ar-link');
  var scanAgainBtn = document.getElementById('scan-again-btn');
  var modeChoice = document.getElementById('mode-choice');
  var cameraFlow = document.getElementById('camera-flow');
  var stepLabel = document.getElementById('step-label');
  var captureStepName = document.getElementById('capture-step-name');
  var mode4Btn = document.getElementById('mode-4-btn');
  var mode6Btn = document.getElementById('mode-6-btn');

  var stream = null;
  var viewMode = 4;
  var viewLabels = ['Front', 'Back', 'Left side', 'Right side', 'Top', 'Bottom'];
  var totalSteps = 4;
  var currentStep = 0;
  var capturedBlobs = [];

  // Placeholder when no backend: use relative path so the link works on any device.
  var PLACEHOLDER_MODEL_URL = 'models/sample.gltf';
  var CREATE_MODEL_API = (function () {
    var path = window.location.pathname || '/';
    var dir = path.replace(/\/[^/]*$/, '/') || '/';
    return window.location.origin + dir + 'api/create-model';
  })();

  function getViewerUrl(modelUrl) {
    var path = window.location.pathname || '/';
    var lastSlash = path.lastIndexOf('/');
    var dir = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : '/';
    var base = window.location.origin + dir;
    return base + 'viewer.html?model=' + encodeURIComponent(modelUrl);
  }

  function updateStepUI() {
    var name = viewLabels[currentStep];
    stepLabel.textContent = 'Step ' + (currentStep + 1) + ' of ' + totalSteps + ': Capture the ' + name.toUpperCase() + ' view';
    if (captureStepName) captureStepName.textContent = name.toLowerCase();
  }

  function startCaptureFlow(mode) {
    viewMode = mode;
    totalSteps = mode === 6 ? 6 : 4;
    currentStep = 0;
    capturedBlobs = [];
    capturesRow.innerHTML = '';
    createModelBtn.style.display = 'none';
    captureBtn.style.display = 'block';
    modeChoice.style.display = 'none';
    cameraFlow.style.display = 'block';
    updateStepUI();
  }

  function showScanSection() {
    scanSection.classList.remove('hidden');
    scanSection.style.display = 'block';
    processingSection.style.display = 'none';
    resultCard.classList.remove('visible');
    resultCard.style.display = 'none';
    modeChoice.style.display = 'block';
    cameraFlow.style.display = 'none';
    capturedBlobs = [];
    currentStep = 0;
    capturesRow.innerHTML = '';
    createModelBtn.style.display = 'none';
    afterCamera.style.display = 'none';
    placeholder.style.display = 'block';
    video.style.display = 'none';
    openCameraBtn.style.display = 'block';
    openCameraBtn.textContent = 'Open camera';
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
  }

  mode4Btn.addEventListener('click', function () { startCaptureFlow(4); });
  mode6Btn.addEventListener('click', function () { startCaptureFlow(6); });

  openCameraBtn.addEventListener('click', function () {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      placeholder.style.display = 'block';
      video.style.display = 'none';
      openCameraBtn.textContent = 'Open camera';
      afterCamera.style.display = 'none';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        placeholder.style.display = 'none';
        video.style.display = 'block';
        openCameraBtn.textContent = 'Close camera';
        afterCamera.style.display = 'block';
        updateStepUI();
        captureBtn.focus();
      })
      .catch(function (err) {
        alert('Could not open camera: ' + (err.message || 'Permission denied or no camera.'));
      });
  });

  captureBtn.addEventListener('click', function () {
    if (!stream || !video.videoWidth) return;
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(function (blob) {
      if (!blob) return;
      capturedBlobs.push(blob);
      var label = viewLabels[currentStep];
      var url = URL.createObjectURL(blob);
      var slot = document.createElement('div');
      slot.className = 'capture-slot';
      slot.innerHTML = '<img src="' + url + '" alt="' + label + '"><span class="slot-label">' + label + '</span>';
      capturesRow.appendChild(slot);
      currentStep += 1;
      if (currentStep >= totalSteps) {
        createModelBtn.style.display = 'block';
        stepLabel.textContent = 'All views captured. Create your 3D model below.';
        captureBtn.style.display = 'none';
      } else {
        updateStepUI();
      }
    }, 'image/jpeg', 0.9);
  });

  createModelBtn.addEventListener('click', function () {
    if (capturedBlobs.length === 0) {
      alert('Capture at least one photo of the product.');
      return;
    }
    scanSection.style.display = 'none';
    processingSection.style.display = 'block';

    function useModelUrl(modelUrl) {
      processingSection.style.display = 'none';
      resultCard.style.display = 'block';
      resultCard.classList.add('visible');
      var viewerUrl = getViewerUrl(modelUrl);
      qrcodeEl.innerHTML = '';
      new QRCode(qrcodeEl, { text: viewerUrl, width: 256, height: 256 });
      arLinkEl.href = viewerUrl;
      arLinkEl.textContent = viewerUrl;
    }

    function useScanId(scanId) {
      var path = window.location.pathname || '/';
      var lastSlash = path.lastIndexOf('/');
      var dir = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : '/';
      var base = window.location.origin + dir;
      var viewerUrl = base + 'viewer.html?scan=' + encodeURIComponent(scanId);
      processingSection.style.display = 'none';
      resultCard.style.display = 'block';
      resultCard.classList.add('visible');
      qrcodeEl.innerHTML = '';
      new QRCode(qrcodeEl, { text: viewerUrl, width: 256, height: 256 });
      arLinkEl.href = viewerUrl;
      arLinkEl.textContent = viewerUrl;
    }

    function finishWithPlaceholder() {
      setTimeout(function () { useModelUrl(PLACEHOLDER_MODEL_URL); }, 1500);
    }

    if (CREATE_MODEL_API && capturedBlobs.length > 0) {
      var form = new FormData();
      capturedBlobs.forEach(function (blob, i) {
        form.append('images', blob, 'capture-' + (i + 1) + '.jpg');
      });
      fetch(CREATE_MODEL_API, { method: 'POST', body: form })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.scanId) {
            useScanId(data.scanId);
          } else if (data && data.modelUrl) {
            useModelUrl(data.modelUrl);
          } else {
            finishWithPlaceholder();
          }
        })
        .catch(function () { finishWithPlaceholder(); });
    } else {
      finishWithPlaceholder();
    }
  });

  scanAgainBtn.addEventListener('click', showScanSection);
})();
