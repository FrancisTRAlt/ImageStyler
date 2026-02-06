// ============================================================================
// IMAGE STYLER - Advanced Image to ASCII/Paint Converter with GIF Support
// Supports static images and animated GIFs with frame-by-frame conversion
// ============================================================================

// ============================================================================
// DOM ELEMENTS & CONSTANTS
// ============================================================================

const fileElem = document.getElementById('fileElem');
const dropArea = document.getElementById('drop-area');
const modeSelect = document.getElementById('modeSelect');
const convertBtn = document.getElementById('convertBtn');
const downloadBtn = document.getElementById('downloadBtn');
const outputCanvas = document.getElementById('outputCanvas');
const ctx = outputCanvas.getContext('2d');

// Preview canvas size (CSS scales it responsively)
const PREVIEW_W = 800;
const PREVIEW_H = 600;

// Export canvas preserves original image dimensions
const exportCanvas = document.createElement('canvas');
const exportCtx = exportCanvas.getContext('2d');

// UI Controls
const fontSizeInput = document.getElementById('fontSize');
const pixelSizeInput = document.getElementById('pixelSize');
const asciiSettings = document.getElementById('asciiSettings');
const paintSettings = document.getElementById('paintSettings');
const resetBtn = document.getElementById('resetBtn');
const fontSizeValue = document.getElementById('fontSizeValue');
const pixelSizeValue = document.getElementById('pixelSizeValue');

// ASCII-specific constants
const ASCII_CHARS = '@%#*+=-:. ';
const ASCII_COLS = 100;
const ASCII_ROWS = 75;

// Initialize canvas
outputCanvas.width = PREVIEW_W;
outputCanvas.height = PREVIEW_H;

// Test canvas rendering
try {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.fillStyle = '#999';
  ctx.font = '18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📁 Upload an image to get started', PREVIEW_W / 2, PREVIEW_H / 2);
  console.log('Canvas initialized and test drawing successful');
} catch (error) {
  console.error('Error initializing canvas:', error);
}

// Application state
let loadedImage = null;
let originalImageData = null;
let loadedFrames = null; // For animated GIFs (original frames)
let convertedFrames = null; // For processed frames (ASCII, Paint, etc.)
let isAnimatedGif = false;
let currentFrameIndex = 0;
let animationFrameId = null;
let asciiConversionCount = 0; // Easter egg counter

// ============================================================================
// EVENT LISTENERS SETUP
// ============================================================================

/**
 * Prevent default browser behavior for drag & drop events
 */
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropArea.addEventListener(eventName, preventDefaults, false);
});

dropArea.addEventListener('dragover', () => {
  console.log('dragover event fired');
  dropArea.classList.add('dragover');
});

dropArea.addEventListener('dragleave', () => {
  console.log('dragleave event fired');
  dropArea.classList.remove('dragover');
});

dropArea.addEventListener('drop', (e) => {
  console.log('drop event fired, files:', e.dataTransfer?.files);
  dropArea.classList.remove('dragover');
  const dt = e.dataTransfer;
  if (!dt) {
    console.warn('No dataTransfer object');
    return;
  }
  const file = dt.files && dt.files[0];
  console.log('File from drop:', file?.name);
  if (file) handleFile(file);
});

fileElem.addEventListener('change', (e) => {
  console.log('File input change event fired, files:', e.target.files);
  const f = e.target.files[0];
  console.log('File from input:', f?.name);
  if (f) handleFile(f);
});

modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value;
  asciiSettings.classList.toggle('disabled', mode !== 'ascii');
  paintSettings.classList.toggle('disabled', mode !== 'paint');
});

convertBtn.addEventListener('click', convert);
downloadBtn.addEventListener('click', downloadImage);
resetBtn.addEventListener('click', resetToOriginal);

// Initial log to verify script is loaded
console.log('=== ImageStyler Script Loaded ===');
console.log('Canvas:', outputCanvas);
console.log('File input:', fileElem);
console.log('Drop area:', dropArea);

// Update range value displays
fontSizeInput.addEventListener('input', (e) => {
  fontSizeValue.textContent = e.target.value;
});

pixelSizeInput.addEventListener('input', (e) => {
  pixelSizeValue.textContent = e.target.value;
});

// ============================================================================
// GIF DETECTION & PARSING
// ============================================================================

/**
 * Check if file is a GIF by checking magic bytes
 */
function isGifFile(fileExtension) {
  return fileExtension.toLowerCase() === 'gif';
}

/**
 * Convert data URL to ArrayBuffer
 */
function dataURLToArrayBuffer(dataURL) {
  const arr = dataURL.split(',');
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return u8arr;
}

/**
 * Parse GIF and extract frames
 */
async function extractGifFramesFromUrl(dataURL) {
  return new Promise((resolve) => {
    try {
      console.log('Starting GIF extraction...');
      
      // Convert data URL to ArrayBuffer
      let buffer;
      if (dataURL.startsWith('data:')) {
        // Extract base64 part
        const parts = dataURL.split(',');
        if (parts.length !== 2) {
          console.warn('Invalid data URL format');
          resolve(null);
          return;
        }
        buffer = dataURLToArrayBuffer(dataURL);
      } else {
        console.warn('Not a data URL');
        resolve(null);
        return;
      }

      // Try to detect if it's an animated GIF by checking headers
      const view = new Uint8Array(buffer);
      
      // Check GIF signature
      if (view[0] !== 0x47 || view[1] !== 0x49 || view[2] !== 0x46) {
        console.warn('Not a valid GIF file');
        resolve(null);
        return;
      }

      console.log('Valid GIF file detected');

      // Parse GIF to find image descriptor blocks
      let pos = 6; // Skip signature and version
      
      // Parse logical screen descriptor
      if (pos + 7 > view.length) {
        console.warn('GIF file too short');
        resolve(null);
        return;
      }
      
      const width = view[pos] | (view[pos + 1] << 8);
      const height = view[pos + 2] | (view[pos + 3] << 8);
      const packed = view[pos + 4];
      const hasGlobalColorTable = (packed & 0x80) ? true : false;
      const globalColorTableSize = 2 << (packed & 0x07);
      
      pos += 7;
      
      // Skip global color table
      if (hasGlobalColorTable) {
        pos += globalColorTableSize * 3;
      }
      
      let frameCount = 0;
      const maxFrames = 1000; // Safety limit
      
      // Scan for image descriptor blocks (0x2C)
      while (pos < view.length && frameCount < maxFrames) {
        const separator = view[pos];
        
        if (separator === 0x21) { // Extension block
          pos++;
          if (pos >= view.length) break;
          const label = view[pos];
          pos++;
          
          // Skip data sub-blocks
          if (pos >= view.length) break;
          let blockSize = view[pos];
          while (blockSize !== 0 && pos < view.length) {
            pos += blockSize + 1;
            if (pos >= view.length) break;
            blockSize = view[pos];
          }
          if (pos < view.length) pos++; // Block terminator
        } else if (separator === 0x2C) { // Image descriptor
          frameCount++;
          pos += 9; // Skip image descriptor
          if (pos >= view.length) break;
          
          const localPackedByte = view[pos - 1];
          const hasLocalColorTable = (localPackedByte & 0x80) ? true : false;
          if (hasLocalColorTable) {
            const localColorTableSize = 2 << (localPackedByte & 0x07);
            pos += localColorTableSize * 3;
          }
          
          if (pos >= view.length) break;
          pos++; // LZW minimum code size
          if (pos >= view.length) break;
          let blockSize = view[pos];
          while (blockSize !== 0 && pos < view.length) {
            pos += blockSize + 1;
            if (pos >= view.length) break;
            blockSize = view[pos];
          }
          if (pos < view.length) pos++; // Block terminator
        } else if (separator === 0x3B) { // End of file
          break;
        } else if (separator === 0x00 || separator === undefined) {
          break;
        } else {
          pos++;
        }
      }
      
      console.log('Found', frameCount, 'potential frames in GIF');
      
      // If we found multiple frames, it's animated
      if (frameCount > 1) {
        console.log('Animated GIF detected with', frameCount, 'frames');
        
        // Create animation frames
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          console.log('GIF image loaded, creating frame canvases');
          // Create frame canvases
          const animFrames = [];
          for (let i = 0; i < frameCount; i++) {
            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = img.width;
            frameCanvas.height = img.height;
            const ctx = frameCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            animFrames.push({
              canvas: frameCanvas,
              delay: 100
            });
          }
          
          console.log('Created', animFrames.length, 'frame canvases');
          resolve(animFrames.length > 1 ? animFrames : null);
        };
        
        img.onerror = () => {
          console.error('Could not load GIF image');
          resolve(null);
        };
        
        img.src = dataURL;
      } else {
        console.log('GIF is not animated (only', frameCount, 'frame)');
        resolve(null);
      }
    } catch (e) {
      console.error('Error in extractGifFramesFromUrl:', e);
      resolve(null);
    }
  });
}

// ============================================================================
// PREVIEW RENDERING
// ============================================================================

/**
 * Render the export canvas into the preview with proper letterboxing
 */
function renderPreviewFromExport() {
  const startTime = performance.now();
  console.log('renderPreviewFromExport called, exportCanvas:', exportCanvas.width, 'x', exportCanvas.height);
  
  try {
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

    if (exportCanvas.width === 0 || exportCanvas.height === 0) {
      console.warn('Export canvas has no dimensions, skipping draw');
      return;
    }

    const imgRatio = exportCanvas.width / exportCanvas.height;
    const canvRatio = PREVIEW_W / PREVIEW_H;

    let dw, dh;
    if (imgRatio > canvRatio) {
      dw = PREVIEW_W;
      dh = Math.round(PREVIEW_W / imgRatio);
    } else {
      dh = PREVIEW_H;
      dw = Math.round(PREVIEW_H * imgRatio);
    }

    const dx = Math.round((PREVIEW_W - dw) / 2);
    const dy = Math.round((PREVIEW_H - dh) / 2);

    console.log('Drawing preview at', dx, dy, 'size', dw, 'x', dh);
    ctx.drawImage(exportCanvas, 0, 0, exportCanvas.width, exportCanvas.height, dx, dy, dw, dh);
    
    const endTime = performance.now();
    console.log('renderPreviewFromExport completed in', (endTime - startTime).toFixed(2), 'ms');
  } catch (error) {
    console.error('Error in renderPreviewFromExport:', error);
  }
}

/**
 * Animate GIF frames in preview
 */
function animateGifPreview() {
  if (!loadedFrames || !isAnimatedGif) {
    console.warn('animateGifPreview: No frames or not animated GIF');
    return;
  }

  // Clear any existing animation
  if (animationFrameId) {
    clearTimeout(animationFrameId);
    animationFrameId = null;
  }

  const startAnimation = () => {
    // Use convertedFrames if available (for processed images), otherwise use loadedFrames
    const frames = convertedFrames || loadedFrames;
    if (!frames || frames.length === 0) {
      console.warn('No frames available for animation');
      return;
    }

    currentFrameIndex = 0;

    const showFrame = () => {
      if (!isAnimatedGif) return; // Stop if no longer animated

      const frames = convertedFrames || loadedFrames;
      if (!frames || frames.length === 0) return;

      const frameData = frames[currentFrameIndex];
      
      // Draw frame to export canvas (keep export canvas dimensions)
      const ctx = exportCanvas.getContext('2d');
      
      // If frame size differs from exportCanvas, scale it
      if (frameData.canvas.width !== exportCanvas.width || frameData.canvas.height !== exportCanvas.height) {
        ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(frameData.canvas, 0, 0, frameData.canvas.width, frameData.canvas.height, 0, 0, exportCanvas.width, exportCanvas.height);
      } else {
        ctx.drawImage(frameData.canvas, 0, 0);
      }

      // Render preview
      renderPreviewFromExport();

      // Schedule next frame
      currentFrameIndex = (currentFrameIndex + 1) % frames.length;
      const delay = frameData.delay || 100;
      animationFrameId = setTimeout(showFrame, delay);
    };

    showFrame();
  };

  // Start animation immediately
  startAnimation();
}

// ============================================================================
// IMAGE LOADING
// ============================================================================

// ============================================================================
// IMAGE LOADING
// ============================================================================

/**
 * Handle file upload - read as DataURL and detect GIF
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
    alert('Please upload an image file (JPG, PNG, GIF, etc.)');
    console.warn('Invalid file type:', file.type);
    return;
  }
  console.log('File type validation passed');

  const reader = new FileReader();
  const fileExtension = file.name.split('.').pop();
  const isGif = isGifFile(fileExtension);

  console.log('File extension:', fileExtension, 'Is GIF:', isGif);

  reader.onerror = () => {
    console.error('FileReader error:', reader.error);
    alert('Error reading file: ' + reader.error);
    downloadBtn.disabled = true;
  };

  reader.onload = async (e) => {
    console.log('=== FileReader onload ===');
    try {
      const dataURL = e.target.result;
      console.log('FileReader completed successfully');
      console.log('DataURL length:', dataURL.length);
      console.log('DataURL prefix:', dataURL.substring(0, 100));

      // Clear converted frames when loading new image
      convertedFrames = null;

      // Try to extract GIF frames if it's a GIF file
      if (isGif) {
        console.log('Processing as GIF file');
        console.log('Attempting to extract GIF frames...');
        const frames = await extractGifFramesFromUrl(dataURL);
        console.log('GIF extraction result:', frames ? frames.length + ' frames' : 'No frames');
        
        if (frames && frames.length > 1) {
          // Animated GIF detected
          console.log('Animated GIF detected with', frames.length, 'frames');
          isAnimatedGif = true;
          loadedFrames = frames;
          currentFrameIndex = 0;

          // Set up initial state from first frame
          const firstFrame = frames[0];
          loadedImage = firstFrame.canvas;

          exportCanvas.width = firstFrame.canvas.width;
          exportCanvas.height = firstFrame.canvas.height;
          exportCtx.drawImage(firstFrame.canvas, 0, 0);

          originalImageData = firstFrame.canvas.toDataURL('image/png');

          // Start animation
          console.log('Starting GIF animation...');
          animateGifPreview();
          downloadBtn.disabled = false;
          alert('Animated GIF loaded successfully!');
        } else {
          // GIF parsing failed, load as static image
          console.log('GIF parsing failed or single frame, loading as static image');
          loadStaticImage(dataURL);
        }
      } else {
        // Not a GIF, load as static image
        console.log('Not a GIF, loading as static image');
        loadStaticImage(dataURL);
      }

      // Save to localStorage
      try {
        localStorage.setItem('savedImage', dataURL);
        localStorage.setItem('isAnimatedGif', isAnimatedGif ? '1' : '0');
        console.log('Image saved to localStorage');
      } catch (e) {
        console.warn('Could not save to localStorage', e);
      }
      console.log('=== FileReader onload END ===');
    } catch (error) {
      console.error('Error in onload handler:', error, error.stack);
      alert('Error processing image: ' + error.message);
      downloadBtn.disabled = true;
    }
  };

  try {
    console.log('Calling reader.readAsDataURL...');
    reader.readAsDataURL(file);
    console.log('readAsDataURL called successfully');
  } catch (error) {
    console.error('Error calling readAsDataURL:', error);
    alert('Error reading file: ' + error.message);
    downloadBtn.disabled = true;
  }
  
  console.log('=== handleFile END ===');
}

/**
 * Load a static image (non-animated)
 */
function loadStaticImage(dataURL) {
  console.log('loadStaticImage called');
  
  // Stop any existing animation
  if (animationFrameId) {
    clearTimeout(animationFrameId);
    animationFrameId = null;
  }

  // Clear converted frames
  convertedFrames = null;
  
  isAnimatedGif = false;
  loadedFrames = null;
  currentFrameIndex = 0;

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

      // Store original for reset
      originalImageData = exportCanvas.toDataURL('image/png');
      console.log('Original image data saved');

      // Render preview
      console.log('Calling renderPreviewFromExport');
      renderPreviewFromExport();
      
      downloadBtn.disabled = false;
      console.log('Image preview rendered successfully');
      alert('Image loaded successfully! Size: ' + img.width + 'x' + img.height);
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

// ============================================================================
// CONVERSION ORCHESTRATION
// ============================================================================

/**
 * Check for rickroll easter egg
 */
function checkRickrollEasterEgg() {
  asciiConversionCount++;
  if (asciiConversionCount === 10) {
    triggerRickroll();
    asciiConversionCount = 0;
  }
}

/**
 * Trigger rickroll
 */
async function triggerRickroll() {
  // Create a more robust rickroll display
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  
  // Draw rickroll text
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎉 RICKROLLED! 🎉', PREVIEW_W / 2, PREVIEW_H / 2 - 80);
  
  // Draw funny message
  ctx.fillStyle = '#00FF00';
  ctx.font = 'bold 32px Arial';
  ctx.fillText("You've been Rick Roll'd!", PREVIEW_W / 2, PREVIEW_H / 2);
  
  // Draw rick astley reference
  ctx.fillStyle = '#FF1493';
  ctx.font = '24px Arial';
  ctx.fillText('Never gonna give you up...', PREVIEW_W / 2, PREVIEW_H / 2 + 80);
  
  // Try to load and show rickroll image
  const rickrollUrls = [
    'https://media.giphy.com/media/jJ8DSXZR14bYA/giphy.gif',
    'https://upload.wikimedia.org/wikipedia/en/d/d8/Rickroll_%288bit%29.gif',
    'https://c.tenor.com/x8v1oNUOmg4AAAAC/rick-astley-rickroll.gif'
  ];
  
  // Try each URL until one works
  for (let url of rickrollUrls) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Draw rickroll image if successfully loaded
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
      console.warn('Could not load rickroll from', url);
    };
    img.src = url;
  }
  
  // Play rickroll sound (optional)
  playRickrollAudio();
}

/**
 * Play rickroll audio if possible
 */
function playRickrollAudio() {
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
 * Main conversion function
 */
function convert() {
  if (!loadedImage) {
    alert('Please upload an image first.');
    return;
  }

  // Stop animation during conversion
  if (animationFrameId) {
    clearTimeout(animationFrameId);
    animationFrameId = null;
  }

  const mode = modeSelect.value;

  if (mode === 'ascii') {
    checkRickrollEasterEgg();
    if (isAnimatedGif && loadedFrames) {
      convertGifToASCII();
    } else {
      convertToASCII(Number(fontSizeInput.value));
    }
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

    if (isAnimatedGif && loadedFrames) {
      convertGifToPaint(paintOptions);
    } else {
      convertToPaint(paintOptions);
    }
  }

  renderPreviewFromExport();
}

/**
 * Reset to original image
 */
function resetToOriginal() {
  asciiConversionCount = 0;
  convertedFrames = null; // Clear converted frames on reset

  if (!originalImageData) {
    alert('No image loaded to reset.');
    return;
  }

  if (animationFrameId) {
    clearTimeout(animationFrameId);
    animationFrameId = null;
  }

  if (isAnimatedGif && loadedFrames) {
    currentFrameIndex = 0;
    animateGifPreview();
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      exportCanvas.width = img.width;
      exportCanvas.height = img.height;
      exportCtx.clearRect(0, 0, img.width, img.height);
      exportCtx.drawImage(img, 0, 0);
      renderPreviewFromExport();
    };

    img.onerror = () => {
      alert('Could not load original image.');
    };

    img.src = originalImageData;
  }
}

/**
 * Download converted image/GIF
 */
async function downloadImage() {
  if (isAnimatedGif && loadedFrames) {
    downloadAnimatedGif();
  } else {
    const url = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

// ============================================================================
// PAINT CONVERSION
// ============================================================================

/**
 * Convert image to painterly style
 */
function convertToPaint(opts) {
  const pixelSize = Math.max(2, Math.round(opts.pixelSize || 8));
  const smallW = Math.max(Math.floor(exportCanvas.width / pixelSize), 1);
  const smallH = Math.max(Math.floor(exportCanvas.height / pixelSize), 1);

  const small = document.createElement('canvas');
  small.width = smallW;
  small.height = smallH;
  const sctx = small.getContext('2d');
  sctx.drawImage(exportCanvas, 0, 0, exportCanvas.width, exportCanvas.height, 0, 0, smallW, smallH);
  const smallData = sctx.getImageData(0, 0, smallW, smallH).data;

  // Apply paint effects to export canvas
  applyPaintEffects(exportCanvas, smallData, smallW, smallH, pixelSize, opts);
  
  // Update preview
  renderPreviewFromExport();
}

/**
 * Convert animated GIF to paint style
 */
function convertGifToPaint(opts) {
  if (!loadedFrames) return;

  // Create converted frames array instead of modifying originals
  convertedFrames = [];

  loadedFrames.forEach(frame => {
    const originalWidth = frame.canvas.width;
    const originalHeight = frame.canvas.height;

    const pixelSize = Math.max(2, Math.round(opts.pixelSize || 8));
    const smallW = Math.max(Math.floor(originalWidth / pixelSize), 1);
    const smallH = Math.max(Math.floor(originalHeight / pixelSize), 1);

    const small = document.createElement('canvas');
    small.width = smallW;
    small.height = smallH;
    const sctx = small.getContext('2d');
    sctx.drawImage(frame.canvas, 0, 0, originalWidth, originalHeight, 0, 0, smallW, smallH);
    const smallData = sctx.getImageData(0, 0, smallW, smallH).data;

    // Create a new canvas for the converted frame (same size as original)
    const newFrame = document.createElement('canvas');
    newFrame.width = originalWidth;
    newFrame.height = originalHeight;
    applyPaintEffects(newFrame, smallData, smallW, smallH, pixelSize, opts);

    // Add to converted frames with original delay
    convertedFrames.push({
      canvas: newFrame,
      delay: frame.delay
    });
  });

  // Start animation with converted frames
  currentFrameIndex = 0;
  animateGifPreview();
}

/**
 * Apply paint effects to canvas
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

/**
 * Convert image to ASCII art
 */
function convertToASCII(fontSize) {
  const cols = ASCII_COLS;
  const rows = ASCII_ROWS;

  // Store original dimensions
  const origWidth = exportCanvas.width;
  const origHeight = exportCanvas.height;

  const temp = document.createElement('canvas');
  temp.width = cols;
  temp.height = rows;
  const tctx = temp.getContext('2d');
  tctx.drawImage(exportCanvas, 0, 0, origWidth, origHeight, 0, 0, cols, rows);
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

  // Draw ASCII directly on exportCanvas at correct size
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
    }
  }
}

/**
 * Convert animated GIF to ASCII art
 */
function convertGifToASCII() {
  if (!loadedFrames) return;

  const fontSize = Number(fontSizeInput.value);
  const cols = ASCII_COLS;
  const rows = ASCII_ROWS;

  // Create converted frames array instead of modifying originals
  convertedFrames = [];

  loadedFrames.forEach(frame => {
    // Store original frame dimensions
    const origWidth = frame.canvas.width;
    const origHeight = frame.canvas.height;
    
    // Calculate exact character dimensions to fit frame size
    const charW = Math.round(origWidth / cols);
    const charH = Math.round(origHeight / rows);

    const temp = document.createElement('canvas');
    temp.width = cols;
    temp.height = rows;
    const tctx = temp.getContext('2d');
    tctx.drawImage(frame.canvas, 0, 0, origWidth, origHeight, 0, 0, cols, rows);
    const imgd = tctx.getImageData(0, 0, cols, rows).data;

    const asciiCanvas = document.createElement('canvas');
    asciiCanvas.width = origWidth;
    asciiCanvas.height = origHeight;
    const asciiCtx = asciiCanvas.getContext('2d');

    asciiCtx.fillStyle = '#fff';
    asciiCtx.fillRect(0, 0, origWidth, origHeight);
    asciiCtx.fillStyle = '#000';
    asciiCtx.font = `${fontSize}px monospace`;
    asciiCtx.textBaseline = 'top';

    // Draw ASCII directly on frame-sized canvas
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = imgd[i];
        const g = imgd[i + 1];
        const b = imgd[i + 2];
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const charIndex = Math.floor((1 - brightness) * (ASCII_CHARS.length - 1));
        const ch = ASCII_CHARS[charIndex];
        asciiCtx.fillText(ch, x * charW, y * charH);
      }
    }

    // Add to converted frames with original delay and dimensions
    convertedFrames.push({
      canvas: asciiCanvas,
      delay: frame.delay
    });
  });

  currentFrameIndex = 0;
  animateGifPreview();
}

// ============================================================================
// GIF DOWNLOAD
// ============================================================================

/**
 * Wait for GIF library to be available
 */
function waitForGif(timeout = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (typeof GIF !== 'undefined' && window.GIF && window.GIF.util) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Download animated GIF
 */
async function downloadAnimatedGif() {
  if (!loadedFrames || loadedFrames.length < 2) {
    // Not an animated GIF, download as PNG
    const url = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  try {
    // Check if gif.js is available
    const gifReady = await waitForGif();
    if (!gifReady) {
      throw new Error('GIF library not available');
    }

    // Use convertedFrames if available (for processed images), otherwise use loadedFrames
    const framesToUse = convertedFrames || loadedFrames;
    
    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: framesToUse[0].canvas.width,
      height: framesToUse[0].canvas.height,
      workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js'
    });

    // Add each frame to GIF
    framesToUse.forEach(frame => {
      gif.addFrame(frame.canvas, { delay: Math.max(10, frame.delay || 100) });
    });

    // Handle rendering completion
    gif.on('finished', function(blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'converted.gif';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    gif.on('error', (error) => {
      console.error('GIF rendering error:', error);
      alert('Could not generate GIF. Downloading as PNG instead.');
      downloadFirstFrameAsPng();
    });

    gif.render();
  } catch (e) {
    console.error('Error creating GIF:', e);
    alert('Could not generate GIF. Downloading as PNG instead.');
    downloadFirstFrameAsPng();
  }
}

/**
 * Download first frame as PNG (fallback)
 */
function downloadFirstFrameAsPng() {
  // Use convertedFrames if available (for processed images), otherwise use loadedFrames or exportCanvas
  let canvas = exportCanvas;
  if (convertedFrames && convertedFrames.length > 0) {
    canvas = convertedFrames[0].canvas;
  } else if (loadedFrames && loadedFrames.length > 0) {
    canvas = loadedFrames[0].canvas;
  }
  
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the application
 */
function initializeApp() {
  modeSelect.dispatchEvent(new Event('change'));

  // Restore saved image from localStorage
  try {
    const saved = localStorage.getItem('savedImage');
    const wasAnimatedGif = localStorage.getItem('isAnimatedGif') === '1';
    
    if (saved) {
      // Check file extension from the saved data
      const isGif = saved.includes('data:image/gif') || wasAnimatedGif;
      
      if (isGif) {
        handleFileFromDataURL(saved, 'gif');
      } else {
        loadStaticImage(saved);
      }
    }
  } catch (e) {
    console.warn('Could not restore from localStorage', e);
  }
}

/**
 * Handle file restoration from DataURL
 */
async function handleFileFromDataURL(dataURL, fileType) {
  // Try to extract GIF frames if it's a GIF file
  if (fileType === 'gif') {
    const frames = await extractGifFramesFromUrl(dataURL);
    
    if (frames && frames.length > 1) {
      // Animated GIF detected
      isAnimatedGif = true;
      loadedFrames = frames;
      currentFrameIndex = 0;

      // Set up initial state from first frame
      const firstFrame = frames[0];
      loadedImage = firstFrame.canvas;

      exportCanvas.width = firstFrame.canvas.width;
      exportCanvas.height = firstFrame.canvas.height;
      exportCtx.drawImage(firstFrame.canvas, 0, 0);

      originalImageData = firstFrame.canvas.toDataURL('image/png');

      // Start animation
      animateGifPreview();
      downloadBtn.disabled = false;
      return;
    }
  }

  // Fall back to loading as static image
  loadStaticImage(dataURL);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
