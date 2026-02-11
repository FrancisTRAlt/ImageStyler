// ============================================================================
// IMAGE STYLER - Image to ASCII Art / Paint Style Converter
// ============================================================================
// A lightweight image processing tool supporting two conversion modes:
// 1. ASCII Art: Converts image to text-based ASCII characters
// 2. Paint Style: Applies artistic effects (pixelation, brush, watercolor, etc.)
//
// Architecture:
// - Dual Canvas System:
//   * originalCanvas: Pristine, unmodified copy of loaded image (conversion source)
//   * exportCanvas: Working copy showing current conversion result
//   * outputCanvas: 800x600 preview canvas (letterboxed display)
// - History Stack: Tracks up to 12 conversion states for undo functionality
// - State Management: Single global loadedImage + canvas-based image storage
// - No dependencies: Pure HTML5/Canvas/JavaScript
//
// CRITICAL: Always read from originalCanvas for conversions to prevent
// repeated conversions from degrading the image.
// ============================================================================

// ============================================================================
// DOM ELEMENTS & CONSTANTS
// ============================================================================

// Input/Output Elements
const fileElem = document.getElementById('fileElem');
const dropArea = document.getElementById('drop-area');
const modeSelect = document.getElementById('modeSelect');
const convertBtn = document.getElementById('convertBtn');
const downloadBtn = document.getElementById('downloadBtn');

// Preview Canvas (800x600 display area with letterboxing)
const outputCanvas = document.getElementById('outputCanvas');
const ctx = outputCanvas.getContext('2d');

// Make the canvas DPI-aware and responsive. We'll resize the canvas
// internal pixel buffer to match its CSS size * devicePixelRatio and
// set the drawing transform so coordinates map to CSS pixels.
function resizeOutputCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = outputCanvas.getBoundingClientRect();
  const cssW = Math.max(200, Math.round(rect.width));
  const cssH = Math.max(150, Math.round(rect.height));

  // Set internal pixel size
  outputCanvas.width = Math.max(1, Math.round(cssW * dpr));
  outputCanvas.height = Math.max(1, Math.round(cssH * dpr));

  // Ensure CSS size is explicit to avoid layout jitter
  outputCanvas.style.width = cssW + 'px';
  outputCanvas.style.height = cssH + 'px';

  // Map drawing coordinates to CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Resize on load and on window resize to keep UI sharp and consistent
window.addEventListener('resize', () => {
  try { resizeOutputCanvas(); renderPreviewFromExport(); } catch (e) { /* ignore */ }
});

// Initial placeholder in preview
try {
  resizeOutputCanvas();
  const PREVIEW_W = outputCanvas.clientWidth || 800;
  const PREVIEW_H = outputCanvas.clientHeight || 600;
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.fillStyle = '#999';
  ctx.font = '18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📁 Upload an image to get started', PREVIEW_W / 2, PREVIEW_H / 2);
} catch (e) {
  console.warn('Could not draw placeholder preview', e);
}

// Working canvas: stores conversion output being previewed
const exportCanvas = document.createElement('canvas');
const exportCtx = exportCanvas.getContext('2d');

// CRITICAL: Pristine source canvas - NEVER MODIFIED after initial load
// Always read from this for conversions to prevent degradation on repeated calls
const originalCanvas = document.createElement('canvas');
const originalCtx = originalCanvas.getContext('2d');

// UI Controls - Settings and Sliders
const fontSizeInput = document.getElementById('fontSize');
const pixelSizeInput = document.getElementById('pixelSize');
const resetBtn = document.getElementById('resetBtn');
const fontSizeValue = document.getElementById('fontSizeValue');
const pixelSizeValue = document.getElementById('pixelSizeValue');
const asciiColsInput = document.getElementById('asciiCols');
const asciiText = document.getElementById('asciiText');
const copyAsciiBtn = document.getElementById('copyAsciiBtn');
const clearAsciiBtn = document.getElementById('clearAsciiBtn');
const undoBtn = document.getElementById('undoBtn');

// ASCII character set: ordered from darkest to lightest
// Used to map image brightness to characters
const ASCII_CHARS = '@%#*+=-:. ';

// Application State
let loadedImage = null; // Current loaded image element
let originalImageData = null; // Base64 PNG of original for reset
let asciiConversionCount = 0; // Counter for secret easter egg (triggers at 10)
const historyStack = []; // Undo stack: stores PNG data URLs
const MAX_HISTORY = 12; // Maximum undo states

// ============================================================================
// EVENT LISTENERS & HANDLERS
// ============================================================================

// Prevent default drag/drop behavior on the drop area
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Drag and drop events
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropArea.addEventListener(eventName, preventDefaults, false);
});

// Visual feedback for drag-over state
dropArea.addEventListener('dragover', () => dropArea.classList.add('highlight'));
dropArea.addEventListener('dragleave', () => dropArea.classList.remove('highlight'));

// Handle dropped files
dropArea.addEventListener('drop', (e) => {
  dropArea.classList.remove('highlight');
  const dt = e.dataTransfer;
  if (!dt) return;
  const file = dt.files && dt.files[0];
  if (file) handleFile(file);
});

// Handle file input selection
fileElem.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) handleFile(f);
});

// Tab switching for settings
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab');
    
    // Deactivate all tabs
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    // Activate selected tab
    btn.classList.add('active');
    document.getElementById(tab + '-tab').classList.add('active');
    
    // Update mode selector to match tab
    modeSelect.value = tab;
    modeSelect.dispatchEvent(new Event('change'));
  });
});

// Mode selector: sync with tab switching
modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value;
  
  // Update tab buttons
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === mode);
  });
  
  // Update tab contents
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === mode + '-tab');
  });
});

// Main action buttons
convertBtn.addEventListener('click', convert);
// Show modal dialog to choose filename before downloading
downloadBtn.addEventListener('click', showDownloadDialog);
resetBtn.addEventListener('click', resetToOriginal);

// Slider value displays
if (fontSizeInput) fontSizeInput.addEventListener('input', (e) => { if (fontSizeValue) fontSizeValue.textContent = e.target.value; });
if (pixelSizeInput) pixelSizeInput.addEventListener('input', (e) => { if (pixelSizeValue) pixelSizeValue.textContent = e.target.value; });

// ASCII Control: Copy to clipboard
if (copyAsciiBtn) copyAsciiBtn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(asciiText.value || ''); alert('ASCII copied to clipboard'); }
  catch (e) { console.error('Copy failed', e); alert('Copy failed: ' + e.message); }
});

// ASCII Control: Clear textarea
if (clearAsciiBtn) clearAsciiBtn.addEventListener('click', () => { if (asciiText) asciiText.value = ''; });

// Undo button: restore previous conversion state
if (undoBtn) undoBtn.addEventListener('click', () => {
  if (historyStack.length === 0) return;
  const prev = historyStack.pop();
  const img = new Image();
  img.onload = () => {
    exportCanvas.width = img.width; exportCanvas.height = img.height;
    exportCtx.clearRect(0,0,img.width,img.height);
    exportCtx.drawImage(img,0,0);
    renderPreviewFromExport();
    if (historyStack.length === 0) undoBtn.disabled = true;
  };
  img.src = prev;
});

// ---------------------------
// Download modal behavior
// ---------------------------
const downloadModal = document.getElementById('downloadModal');
const downloadNameInput = document.getElementById('downloadName');
const downloadNowBtn = document.getElementById('downloadNowBtn');
const downloadCancelBtn = document.getElementById('downloadCancelBtn');

function showDownloadDialog() {
  if (!downloadModal) {
    // fallback: immediate download
    downloadImage();
    return;
  }
  downloadNameInput.value = downloadNameInput.value || 'converted.png';
  downloadModal.classList.remove('hidden');
  downloadModal.setAttribute('aria-hidden', 'false');
  // focus and select filename for quick edit
  setTimeout(() => {
    downloadNameInput.focus();
    downloadNameInput.select();
  }, 50);
}

function closeDownloadDialog() {
  if (!downloadModal) return;
  downloadModal.classList.add('hidden');
  downloadModal.setAttribute('aria-hidden', 'true');
  downloadBtn.focus();
}

function downloadImageWithName(fileName) {
  try {
    const url = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'converted.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.error('Download failed', e);
    // fallback to original download behavior
    downloadImage();
  }
  closeDownloadDialog();
}

if (downloadNowBtn) {
  downloadNowBtn.addEventListener('click', () => {
    let name = (downloadNameInput && downloadNameInput.value) || 'converted.png';
    name = name.trim() || 'converted.png';
    if (!/\.[a-zA-Z0-9]{1,5}$/.test(name)) name += '.png';
    downloadImageWithName(name);
  });
}

if (downloadCancelBtn) downloadCancelBtn.addEventListener('click', closeDownloadDialog);

if (downloadModal) {
  // Close when clicking the overlay
  downloadModal.addEventListener('click', (e) => { if (e.target === downloadModal) closeDownloadDialog(); });
}

// Keyboard support: Enter to download, Esc to cancel
document.addEventListener('keydown', (e) => {
  if (!downloadModal || downloadModal.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeDownloadDialog();
  if (e.key === 'Enter' && document.activeElement === downloadNameInput) {
    downloadNowBtn && downloadNowBtn.click();
  }
});

// ============================================================================
// PREVIEW RENDERING
// ============================================================================
/**
 * Render the export canvas into the preview canvas with proper letterboxing.
 * Scales the image to fit within the preview dimensions while maintaining aspect ratio.
 * Centers the image and fills remaining space with white background.
 * @returns {void}
 */
function renderPreviewFromExport() {
  const startTime = performance.now();
  console.log('renderPreviewFromExport called, exportCanvas:', exportCanvas.width, 'x', exportCanvas.height);

  try {
    // Ensure output canvas internal size matches its CSS size and dpr
    resizeOutputCanvas();
    const PREVIEW_W = outputCanvas.clientWidth || 800;
    const PREVIEW_H = outputCanvas.clientHeight || 600;

    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

    if (exportCanvas.width === 0 || exportCanvas.height === 0) {
      console.warn('Export canvas has no dimensions, skipping draw');
      return;
    }

    // Use 'contain' scaling so the entire image is visible and not cropped.
    // Apply a small padding factor so the image doesn't touch container edges.
    const srcW = exportCanvas.width || exportCanvas.clientWidth || 1;
    const srcH = exportCanvas.height || exportCanvas.clientHeight || 1;
    const paddingFactor = 0.95; // leave slight margin inside preview
    let scale = Math.min(PREVIEW_W / srcW, PREVIEW_H / srcH);
    // Prevent excessive upscaling on very small images; cap scale to 1 (no upscale)
    scale = Math.min(scale, 1) * paddingFactor;
    const dw = Math.round(srcW * scale);
    const dh = Math.round(srcH * scale);
    const dx = Math.round((PREVIEW_W - dw) / 2);
    const dy = Math.round((PREVIEW_H - dh) / 2);

    console.log('Drawing preview (contain) at', dx, dy, 'size', dw, 'x', dh, 'scale', scale.toFixed(2));
    ctx.drawImage(exportCanvas, 0, 0, srcW, srcH, dx, dy, dw, dh);

    const endTime = performance.now();
    console.log('renderPreviewFromExport completed in', (endTime - startTime).toFixed(2), 'ms');
  } catch (error) {
    console.error('Error in renderPreviewFromExport:', error);
  }
}
// animateGifPreview removed (no animated GIF support)

// ============================================================================
// IMAGE LOADING
// ============================================================================

/**
 * Handle file upload - validates and reads image file as DataURL.
 * Clears conversion history and loads the image for processing.
 * Stores image in localStorage for persistence (static image only).
 * @param {File} file - The uploaded image file
 * @returns {void}
 */
function handleFile(file) {
  console.log('=== handleFile START ===');
  console.log('File details:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
  
  // Validate file
  if (!file.type.startsWith('image/')) {
    console.warn('File validation failed: not an image type');
    alert('Please upload an image file (JPG, PNG, etc.)');
    console.warn('Invalid file type:', file.type);
    return;
  }
  console.log('File type validation passed');

  const reader = new FileReader();

  reader.onerror = () => {
    console.error('FileReader error:', reader.error);
    alert('Error reading file: ' + reader.error);
    downloadBtn.disabled = true;
  };

  reader.onload = (e) => {
    try {
      const dataURL = e.target.result;

      // Clear history when loading a new image
      historyStack.length = 0;
      undoBtn.disabled = true;

      loadStaticImage(dataURL);

      // Save to localStorage (static image only)
      try {
        localStorage.setItem('savedImage', dataURL);
        console.log('Image saved to localStorage');
      } catch (e) {
        console.warn('Could not save to localStorage', e);
      }
    } catch (error) {
      console.error('Error in onload handler:', error, error.stack);
      alert('Error processing image: ' + error.message);
      downloadBtn.disabled = true;
    }
  };

  try {
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('Error calling readAsDataURL:', error);
    alert('Error reading file: ' + error.message);
    downloadBtn.disabled = true;
  }

  console.log('=== handleFile END ===');
}

/**
 * Load a static image from DataURL.
 * Creates both exportCanvas (for conversion output) and originalCanvas (pristine source).
 * Stores original image data for reset functionality.
 * Renders preview and enables download button.
 * @param {string} dataURL - Base64-encoded image data URL
 * @returns {void}
 */
function loadStaticImage(dataURL) {
  console.log('loadStaticImage called');
  
  // Clear undo history when loading new image handled elsewhere

  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    try {
      console.log('Image onload fired, dimensions:', img.width, 'x', img.height);
      
      if (img.width === 0 || img.height === 0) {
        console.error('Invalid image dimensions:', img.width, 'x', img.height);
        alert('Error: Image has invalid dimensions');
        downloadBtn.disabled = true;
        return;
      }
      
      loadedImage = img;

      // Initialize export canvas with proper dimensions
      console.log('Setting exportCanvas dimensions to', img.width, 'x', img.height);
      exportCanvas.width = img.width;
      exportCanvas.height = img.height;
      
      console.log('Clearing exportCanvas context');
      exportCtx.clearRect(0, 0, img.width, img.height);
      
      console.log('Drawing image to exportCanvas');
      exportCtx.drawImage(img, 0, 0);

      // Also save to originalCanvas for conversion source (pristine copy)
      originalCanvas.width = img.width;
      originalCanvas.height = img.height;
      originalCtx.clearRect(0, 0, img.width, img.height);
      originalCtx.drawImage(img, 0, 0);

      // Store original for reset
      originalImageData = exportCanvas.toDataURL('image/png');
      console.log('Original image data saved');

      // Render preview
      console.log('Calling renderPreviewFromExport');
      renderPreviewFromExport();
      
      downloadBtn.disabled = false;
      console.log('Image preview rendered successfully');
    } catch (error) {
      console.error('Error in img.onload:', error, error.stack);
      alert('Error processing image: ' + error.message);
      downloadBtn.disabled = true;
    }
  };

  img.onerror = (error) => {
    console.error('Image failed to load', error);
    alert('Unable to load image. Check browser console (F12) for details.');
    downloadBtn.disabled = true;
  };

  console.log('Setting image src to data URL (length:', dataURL.length, ')');
  console.log('Data URL preview:', dataURL.substring(0, 50) + '...');
  
  img.src = dataURL;
  console.log('Image src set');
}



// ============================================================================
// CONVERSION ORCHESTRATION
// ============================================================================

/**
 * Check for secret easter egg - triggers on 10th ASCII conversion.
 * Increments conversion counter and performs easter egg action.
 * @returns {void}
 */
function checkEasterEgg() {
  asciiConversionCount++;
  if (asciiConversionCount === 10) {
    triggerEasterEgg();
    asciiConversionCount = 0;
  }
}

/**
 * Trigger surprise easter egg display.
 * Shows celebratory text and attempts to load a neutral surprise image from web.
 * Plays optional celebratory audio accompaniment.
 * @async
 * @returns {void}
 */
async function triggerEasterEgg() {
  // Create a surprise display sized to current preview
  resizeOutputCanvas();
  const PREVIEW_W = outputCanvas.clientWidth || 800;
  const PREVIEW_H = outputCanvas.clientHeight || 600;

  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

  // Draw surprise text
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎉 SURPRISE! 🎉', PREVIEW_W / 2, PREVIEW_H / 2 - 80);

  // Draw celebratory message
  ctx.fillStyle = '#00FF00';
  ctx.font = 'bold 32px Arial';
  ctx.fillText("You've unlocked a surprise!", PREVIEW_W / 2, PREVIEW_H / 2);

  // Draw friendly message
  ctx.fillStyle = '#FF1493';
  ctx.font = '24px Arial';
  ctx.fillText('Enjoy the moment!', PREVIEW_W / 2, PREVIEW_H / 2 + 80);
  
  // Try to load and show a neutral surprise image
  const surpriseImageUrls = [
    'https://via.placeholder.com/400x300.png?text=Surprise',
    'https://picsum.photos/400/300'
  ];
  
  // Try each URL until one works
  for (let url of surpriseImageUrls) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Draw image if successfully loaded
      const ratio = img.width / img.height;
      let w = PREVIEW_W * 0.6;
      let h = w / ratio;
      if (h > PREVIEW_H * 0.4) {
        h = PREVIEW_H * 0.4;
        w = h * ratio;
      }
      const x = (PREVIEW_W - w) / 2;
      const y = PREVIEW_H / 2 + 120;
      if (y + h <= PREVIEW_H) {
        ctx.drawImage(img, x, y, w, h);
      }
    };
    img.onerror = () => {
      console.warn('Could not load surprise image from', url);
    };
    img.src = url;
  }
  
  // Play celebratory sound (optional)
  playEasterAudio();
}

/**
 * Play celebratory audio from external source.
 * Handles audio load failures gracefully.
 * @returns {void}
 */
function playEasterAudio() {
  try {
    const audio = new Audio('https://cdn.pixabay.com/download/audio/2021/08/27/audio_a2c5d8b34e.mp3');
    audio.volume = 0.3;
    audio.play().catch(() => {
      console.log('Could not play audio');
    });
  } catch (e) {
    console.log('Audio not available');
  }
}

/**
 * Main conversion orchestration function.
 * Validates loaded image, saves current state to undo history,
 * routes to ASCII or Paint conversion based on selected mode.
 * Renders preview after conversion.
 * @returns {void}
 */
function convert() {
  if (!loadedImage) {
    alert('Please upload an image first.');
    return;
  }
  const mode = modeSelect.value;

  // Push current state to history for undo
  try {
    const snapshot = exportCanvas.toDataURL('image/png');
    historyStack.push(snapshot);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    undoBtn.disabled = false;
  } catch (e) {
    console.warn('Could not push history', e);
  }

  if (mode === 'ascii') {
    checkEasterEgg();
    convertToASCII(Number(fontSizeInput.value), Number(asciiColsInput.value));
  } else {
    const paintOptions = {
      pixel: document.getElementById('stylePixel').checked,
      brush: document.getElementById('styleBrush').checked,
      gallery: document.getElementById('styleGallery').checked,
      impression: document.getElementById('styleImpression').checked,
      watercolor: document.getElementById('styleWatercolor').checked,
      pixelSize: Number(pixelSizeInput.value),
      brushStrength: Number(document.getElementById('brushStrength').value) / 100,
      textureStrength: Number(document.getElementById('textureStrength').value) / 100
    };
    convertToPaint(paintOptions);
  }

  renderPreviewFromExport();
}

/**
 * Reset export canvas to original pristine image.
 * Clears undo history and resets easter egg counter.
 * @returns {void}
 */
function resetToOriginal() {
  asciiConversionCount = 0;
  if (!originalImageData) {
    alert('No image loaded to reset.');
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    exportCanvas.width = img.width;
    exportCanvas.height = img.height;
    exportCtx.clearRect(0, 0, img.width, img.height);
    exportCtx.drawImage(img, 0, 0);
    renderPreviewFromExport();
    // Clear history after reset
    historyStack.length = 0;
    undoBtn.disabled = true;
  };

  img.onerror = () => {
    alert('Could not load original image.');
  };

  img.src = originalImageData;
}

/**
 * Download the converted image as PNG file.
 * Creates temporary download link and triggers native download dialog.
 * File name: 'converted.png'
 * @async
 * @returns {void}
 */
async function downloadImage() {
  const url = exportCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ============================================================================
// PAINT CONVERSION
// ============================================================================

/**
 * Convert image to painterly style with selectable effects.
 * Always reads from originalCanvas (pristine source) to prevent
 * degradation on repeated conversions.
 * Applies pixelation, brush strokes, impressionist, watercolor, and texture effects.
 * @param {Object} opts - Paint conversion options
 * @param {boolean} opts.pixel - Apply pixelation effect
 * @param {boolean} opts.brush - Apply brush stroke effect
 * @param {boolean} opts.gallery - Apply gallery/texture effect
 * @param {boolean} opts.impression - Apply impressionist effect
 * @param {boolean} opts.watercolor - Apply watercolor effect
 * @param {number} opts.pixelSize - Size of pixels (2-128)
 * @param {number} opts.brushStrength - Brush opacity (0-1)
 * @param {number} opts.textureStrength - Texture opacity (0-1)
 * @returns {void}
 */
function convertToPaint(opts) {
  // Always read from original (pristine) canvas
  const srcCanvas = originalCanvas.width > 0 ? originalCanvas : exportCanvas;
  
  const pixelSize = Math.max(2, Math.round(opts.pixelSize || 8));
  const smallW = Math.max(Math.floor(srcCanvas.width / pixelSize), 1);
  const smallH = Math.max(Math.floor(srcCanvas.height / pixelSize), 1);

  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext('2d');
  sctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, smallW, smallH);
  const smallData = sctx.getImageData(0, 0, smallW, smallH).data;

  // Apply paint effects to export canvas
  applyPaintEffects(exportCanvas, smallData, smallW, smallH, pixelSize, opts);
  
  // Update preview
  renderPreviewFromExport();
}

/**
 * Apply paint effects to canvas.
 * Renders pixelated blocks or applies brush/artistic effects.
 * Uses original color data to paint effects onto export canvas.
 * Handles edge stretching to avoid white borders.
 * @param {HTMLCanvasElement} canvas - Target canvas to paint effects onto
 * @param {Uint8ClampedArray} smallData - Pixel data from downsampled image
 * @param {number} smallW - Width of downsampled image
 * @param {number} smallH - Height of downsampled image
 * @param {number} pixelSize - Size of each pixel block
 * @param {Object} opts - Paint effect options
 * @returns {void}
 */
function applyPaintEffects(canvas, smallData, smallW, smallH, pixelSize, opts) {
  const ctx = canvas.getContext('2d');
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.imageSmoothingEnabled = false;

  if (opts.pixel) {
    for (let y = 0; y < smallH; y++) {
      for (let x = 0; x < smallW; x++) {
        const i = (y * smallW + x) * 4;
        const r = smallData[i];
        const g = smallData[i + 1];
        const b = smallData[i + 2];
        const a = smallData[i + 3] / 255;
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        
        // Calculate rectangle size to fill remaining space on edges
        let rectW = pixelSize;
        let rectH = pixelSize;
        let rectX = x * pixelSize;
        let rectY = y * pixelSize;
        
        // Stretch the last column to fill remaining width
        if (x === smallW - 1) {
          rectW = canvasWidth - rectX;
        }
        
        // Stretch the last row to fill remaining height
        if (y === smallH - 1) {
          rectH = canvasHeight - rectY;
        }
        
        ctx.fillRect(rectX, rectY, rectW, rectH);
      }
    }
  }

  if (opts.brush || opts.impression || opts.watercolor || opts.gallery) {
    const brushAlpha = opts.brushStrength || 0.7;

    for (let y = 0; y < smallH; y++) {
      for (let x = 0; x < smallW; x++) {
        const i = (y * smallW + x) * 4;
        const r = smallData[i];
        const g = smallData[i + 1];
        const b = smallData[i + 2];
        const a = smallData[i + 3] / 255;
        
        // Calculate center position accounting for edge stretching
        let rectX = x * pixelSize;
        let rectY = y * pixelSize;
        let rectW = pixelSize;
        let rectH = pixelSize;
        
        if (x === smallW - 1) {
          rectW = canvasWidth - rectX;
        }
        if (y === smallH - 1) {
          rectH = canvasHeight - rectY;
        }
        
        const cx = rectX + rectW / 2;
        const cy = rectY + rectH / 2;

        if (opts.brush) {
          const strokes = Math.max(1, Math.round(pixelSize / 2));
          ctx.globalCompositeOperation = 'source-over';
          for (let s = 0; s < strokes; s++) {
            const jitterX = (Math.random() - 0.5) * pixelSize * 0.6;
            const jitterY = (Math.random() - 0.5) * pixelSize * 0.6;
            const radius = pixelSize * (0.45 + Math.random() * 0.4);
            ctx.beginPath();
            ctx.fillStyle = `rgba(${r},${g},${b},${a * brushAlpha})`;
            ctx.arc(cx + jitterX, cy + jitterY, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (opts.impression) {
          if (Math.random() < 0.25) {
            ctx.beginPath();
            ctx.fillStyle = `rgba(${Math.min(255, r + 20)},${Math.min(255, g + 10)},${b},${a * 0.9})`;
            ctx.arc(
              cx + (Math.random() - 0.5) * pixelSize,
              cy + (Math.random() - 0.5) * pixelSize,
              pixelSize * 0.8,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }

        if (opts.watercolor) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          ctx.fillStyle = `rgba(${r},${g},${b},${0.12 * (a + 0.2)})`;
          ctx.arc(cx, cy, pixelSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  if (opts.gallery || opts.textureStrength) {
    const tex = document.createElement('canvas');
    tex.width = canvas.width;
    tex.height = canvas.height;
    const t = tex.getContext('2d');
    const imgd = t.createImageData(tex.width, tex.height);

    for (let i = 0; i < imgd.data.length; i += 4) {
      const v = 230 + Math.floor(Math.random() * 25);
      imgd.data[i] = imgd.data[i + 1] = imgd.data[i + 2] = v;
      imgd.data[i + 3] = Math.floor(10 + (opts.textureStrength || 0) * 40);
    }

    t.putImageData(imgd, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.95, 0.3 + (opts.textureStrength || 0) * 0.7);
    ctx.drawImage(tex, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ============================================================================
// ASCII CONVERSION
// ============================================================================

// ============================================================================
// ASCII CONVERSION
// ============================================================================

/**
 * Convert image to ASCII art with user-controlled size.
 * Always reads from originalCanvas (pristine source) to prevent
 * degradation on repeated conversions.
 * Generates both visual ASCII text on canvas and plain-text output in textarea.
 * Uses brightness calculation to map pixels to ASCII characters.
 * @param {number} fontSize - Font size in pixels
 * @param {number} cols - Number of ASCII columns (character width)
 * @returns {void}
 */
function convertToASCII(fontSize, cols) {
  cols = Number(cols) || 120;

  // Always read from original (pristine) canvas
  const srcCanvas = originalCanvas.width > 0 ? originalCanvas : exportCanvas;
  
  // Store original dimensions
  const origWidth = srcCanvas.width;
  const origHeight = srcCanvas.height;

  // Compute rows based on aspect ratio and a char aspect correction
  const charAspect = 0.5; // approximate character height/width ratio
  const rows = Math.max(4, Math.round((cols * origHeight / origWidth) * charAspect));

  const temp = document.createElement('canvas');
  temp.width = cols;
  temp.height = rows;
  const tctx = temp.getContext('2d');
  tctx.drawImage(srcCanvas, 0, 0, origWidth, origHeight, 0, 0, cols, rows);
  const imgd = tctx.getImageData(0, 0, cols, rows).data;

  // Calculate exact dimensions to avoid white borders on edges
  const charW = Math.round(origWidth / cols);
  const charH = Math.round(origHeight / rows);

  // Clear and prepare canvas
  exportCtx.clearRect(0, 0, origWidth, origHeight);
  exportCtx.fillStyle = '#fff';
  exportCtx.fillRect(0, 0, origWidth, origHeight);
  exportCtx.fillStyle = '#000';
  exportCtx.font = `${fontSize}px monospace`;
  exportCtx.textBaseline = 'top';

  // Build plain-text ASCII output and draw to canvas
  let asciiOut = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = imgd[i];
      const g = imgd[i + 1];
      const b = imgd[i + 2];
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const charIndex = Math.floor((1 - brightness) * (ASCII_CHARS.length - 1));
      const ch = ASCII_CHARS[charIndex];
      exportCtx.fillText(ch, x * charW, y * charH);
      asciiOut += ch;
    }
    asciiOut += '\n';
  }

  // Populate textarea for copy/paste
  if (asciiText) asciiText.value = asciiOut;
}
// Animated ASCII conversion removed; static only.

// ============================================================================
// GIF DOWNLOAD
// ============================================================================

// GIF download functions removed (static-only app)

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the application on page load.
 * Sets up mode selector, restores saved image from localStorage if available.
 * @returns {void}
 */
function initializeApp() {
  modeSelect.dispatchEvent(new Event('change'));

  // Restore saved image from localStorage
  try {
    const saved = localStorage.getItem('savedImage');
    if (saved) {
      loadStaticImage(saved);
    }
  } catch (e) {
    console.warn('Could not restore from localStorage', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
