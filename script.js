// Simple, dependency-free converter: Image -> ASCII or pixelated paint
const fileElem = document.getElementById('fileElem');
const dropArea = document.getElementById('drop-area');
const modeSelect = document.getElementById('modeSelect');
const convertBtn = document.getElementById('convertBtn');
const downloadBtn = document.getElementById('downloadBtn');
const outputCanvas = document.getElementById('outputCanvas');
const ctx = outputCanvas.getContext('2d');
// Fixed preview internal resolution (canvas will scale responsively via CSS)
const PREVIEW_W = 800, PREVIEW_H = 600;
// internal export canvas preserves original image dimensions for conversion & download
const exportCanvas = document.createElement('canvas');
const exportCtx = exportCanvas.getContext('2d');
let origWidth = PREVIEW_W, origHeight = PREVIEW_H;
const fontSizeInput = document.getElementById('fontSize');
const pixelSizeInput = document.getElementById('pixelSize');
const asciiSettings = document.getElementById('asciiSettings');
const paintSettings = document.getElementById('paintSettings');

outputCanvas.width = PREVIEW_W; outputCanvas.height = PREVIEW_H;

let loadedImage = null;

function preventDefaults(e){e.preventDefault();e.stopPropagation();}
['dragenter','dragover','dragleave','drop'].forEach(eventName=>{
  dropArea.addEventListener(eventName, preventDefaults, false)
});

dropArea.addEventListener('dragover', ()=>dropArea.classList.add('dragover'));
dropArea.addEventListener('dragleave', ()=>dropArea.classList.remove('dragover'));
dropArea.addEventListener('drop', (e)=>{
  dropArea.classList.remove('dragover');
  const dt = e.dataTransfer; if(!dt) return;
  const file = dt.files && dt.files[0];
  if(file) handleFile(file);
});

fileElem.addEventListener('change', (e)=>{ const f = e.target.files[0]; if(f) handleFile(f); });

modeSelect.addEventListener('change', ()=>{
  const mode = modeSelect.value;
  // keep controls in place but dim / disable the irrelevant block so layout doesn't shift
  asciiSettings.classList.toggle('disabled', mode!=='ascii');
  paintSettings.classList.toggle('disabled', mode!=='paint');
});

function renderPreviewFromExport(){
  // draw exportCanvas into the fixed preview canvas (letterboxed)
  ctx.clearRect(0,0,PREVIEW_W, PREVIEW_H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,PREVIEW_W, PREVIEW_H);
  const imgRatio = exportCanvas.width / exportCanvas.height;
  const canvRatio = PREVIEW_W / PREVIEW_H;
  let dw, dh;
  if(imgRatio > canvRatio){ dw = PREVIEW_W; dh = Math.round(PREVIEW_W / imgRatio); }
  else { dh = PREVIEW_H; dw = Math.round(PREVIEW_H * imgRatio); }
  const dx = Math.round((PREVIEW_W - dw)/2);
  const dy = Math.round((PREVIEW_H - dh)/2);
  ctx.drawImage(exportCanvas, 0, 0, exportCanvas.width, exportCanvas.height, dx, dy, dw, dh);
}

function loadFromDataURL(dataURL){
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = ()=>{
    loadedImage = img;
    // preserve original size in export canvas
    origWidth = img.width; origHeight = img.height;
    exportCanvas.width = origWidth; exportCanvas.height = origHeight;
    exportCtx.clearRect(0,0,origWidth,origHeight);
    exportCtx.drawImage(img, 0, 0, origWidth, origHeight);
    // render a scaled preview from export canvas
    renderPreviewFromExport();
    downloadBtn.disabled = false;
  };
  img.onerror = ()=>{ alert('Unable to load image.'); };
  img.src = dataURL;
}

function handleFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    const dataURL = reader.result;
    try{ localStorage.setItem('savedImage', dataURL); }catch(e){ console.warn('Could not save image to localStorage', e); }
    loadFromDataURL(dataURL);
  };
  reader.onerror = ()=>{ alert('Failed to read file.'); };
  reader.readAsDataURL(file);
}

function convert(){
  if(!loadedImage){ alert('Please upload an image first.'); return; }
  const mode = modeSelect.value;
  if(mode==='ascii') convertToASCII(loadedImage, Number(fontSizeInput.value));
  else {
    // build paint options from checkboxes / sliders (mixable styles)
    const opts = {
      pixel: document.getElementById('stylePixel').checked,
      brush: document.getElementById('styleBrush').checked,
      gallery: document.getElementById('styleGallery').checked,
      impression: document.getElementById('styleImpression').checked,
      watercolor: document.getElementById('styleWatercolor').checked,
      pixelSize: Number(pixelSizeInput.value),
      brushStrength: Number(document.getElementById('brushStrength').value)/100,
      textureStrength: Number(document.getElementById('textureStrength').value)/100
    };
    convertToPaint(loadedImage, opts);
  }
}

function convertToPaint(img, opts){
  const pixelSize = Math.max(2, Math.round(opts.pixelSize || 8));
  const smallW = Math.max( Math.floor(origWidth / pixelSize), 1 );
  const smallH = Math.max( Math.floor(origHeight / pixelSize), 1 );

  // small source that represents color blocks (based on original size)
  const small = document.createElement('canvas');
  small.width = smallW; small.height = smallH;
  const sctx = small.getContext('2d');
  sctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, smallW, smallH);
  const smallData = sctx.getImageData(0,0,smallW,smallH).data;

  // Prepare export canvas (original size)
  exportCanvas.width = origWidth; exportCanvas.height = origHeight;
  exportCtx.clearRect(0,0,origWidth, origHeight);
  exportCtx.fillStyle = '#ffffff'; exportCtx.fillRect(0,0,origWidth,origHeight);
  exportCtx.imageSmoothingEnabled = false;

  // Pixel base layer (fast)
  if(opts.pixel){
    for(let y=0;y<smallH;y++){
      for(let x=0;x<smallW;x++){
        const i = (y*smallW + x)*4;
        const r = smallData[i], g = smallData[i+1], b = smallData[i+2], a = smallData[i+3]/255;
        exportCtx.fillStyle = `rgba(${r},${g},${b},${a})`;
        exportCtx.fillRect(x*pixelSize, y*pixelSize, pixelSize, pixelSize);
      }
    }
  }

  // Brush / painterly overlay
  if(opts.brush || opts.impression || opts.watercolor || opts.gallery){
    const brushAlpha = opts.brushStrength || 0.7;
    for(let y=0;y<smallH;y++){
      for(let x=0;x<smallW;x++){
        const i = (y*smallW + x)*4;
        const r = smallData[i], g = smallData[i+1], b = smallData[i+2], a = smallData[i+3]/255;
        const cx = x * pixelSize + pixelSize/2;
        const cy = y * pixelSize + pixelSize/2;

        // brush strokes (dense)
        if(opts.brush){
          const strokes = Math.max(1, Math.round(pixelSize/2));
          exportCtx.globalCompositeOperation = 'source-over';
          for(let s=0;s<strokes;s++){
            const jitterX = (Math.random()-0.5) * pixelSize * 0.6;
            const jitterY = (Math.random()-0.5) * pixelSize * 0.6;
            const radius = pixelSize * (0.45 + Math.random()*0.4);
            exportCtx.beginPath();
            exportCtx.fillStyle = `rgba(${r},${g},${b},${a * brushAlpha})`;
            exportCtx.arc(cx + jitterX, cy + jitterY, radius, 0, Math.PI*2);
            exportCtx.fill();
          }
        }

        // impressionist: sparse larger dabs
        if(opts.impression){
          if(Math.random() < 0.25){
            exportCtx.beginPath();
            exportCtx.fillStyle = `rgba(${Math.min(255,r+20)},${Math.min(255,g+10)},${b},${a*0.9})`;
            exportCtx.arc(cx + (Math.random()-0.5)*pixelSize, cy + (Math.random()-0.5)*pixelSize, pixelSize*0.8, 0, Math.PI*2);
            exportCtx.fill();
          }
        }

        // watercolor: translucent washes
        if(opts.watercolor){
          exportCtx.globalCompositeOperation = 'lighter';
          exportCtx.beginPath();
          exportCtx.fillStyle = `rgba(${r},${g},${b},${0.12 * (a+0.2)})`;
          exportCtx.arc(cx, cy, pixelSize, 0, Math.PI*2);
          exportCtx.fill();
          exportCtx.globalCompositeOperation = 'source-over';
        }
      }
    }
    exportCtx.globalAlpha = 1;
  }

  // gallery / texture overlay
  if(opts.gallery || opts.textureStrength){
    const tex = document.createElement('canvas'); tex.width = origWidth; tex.height = origHeight;
    const t = tex.getContext('2d');
    const imgd = t.createImageData(tex.width, tex.height);
    for(let i=0;i<imgd.data.length;i+=4){
      const v = 230 + Math.floor(Math.random()*25);
      imgd.data[i]=imgd.data[i+1]=imgd.data[i+2]=v;
      imgd.data[i+3]= Math.floor(10 + (opts.textureStrength||0)*40);
    }
    t.putImageData(imgd,0,0);
    exportCtx.globalCompositeOperation = 'overlay';
    exportCtx.globalAlpha = Math.min(0.95, 0.3 + (opts.textureStrength||0)*0.7);
    exportCtx.drawImage(tex,0,0);
    exportCtx.globalAlpha = 1; exportCtx.globalCompositeOperation = 'source-over';
  }

  // After drawing to export canvas, update preview
  renderPreviewFromExport();
}

function convertToASCII(img, fontSize){
  // Character set ordered dark->light
  const chars = '@%#*+=-:. ';
  // Decide target columns based on canvas width and font width
  const charW = Math.round(fontSize * 0.6);
  const charH = Math.round(fontSize * 1.0);
  const cols = Math.max( Math.floor(origWidth / charW), 20 );
  const rows = Math.max( Math.floor(origHeight / charH), 20 );

  const temp = document.createElement('canvas');
  temp.width = cols; temp.height = rows;
  const tctx = temp.getContext('2d');
  // draw reduced image from export (original) to temp
  tctx.drawImage(exportCanvas, 0, 0, exportCanvas.width, exportCanvas.height, 0, 0, cols, rows);
  const imgd = tctx.getImageData(0,0,cols,rows).data;

  // Prepare a temporary ASCII canvas (grid-based)
  const asciiW = cols * charW;
  const asciiH = rows * charH;
  const asciiCanvas = document.createElement('canvas');
  asciiCanvas.width = asciiW; asciiCanvas.height = asciiH;
  const asciiCtx = asciiCanvas.getContext('2d');
  asciiCtx.fillStyle = '#fff'; asciiCtx.fillRect(0,0,asciiW,asciiH);
  asciiCtx.fillStyle = '#000';
  asciiCtx.font = `${fontSize}px monospace`;
  asciiCtx.textBaseline = 'top';
  for(let y=0;y<rows;y++){
    for(let x=0;x<cols;x++){
      const i = (y*cols + x)*4;
      const r = imgd[i], g = imgd[i+1], b = imgd[i+2];
      const brightness = (0.299*r + 0.587*g + 0.114*b) / 255;
      const charIndex = Math.floor((1 - brightness) * (chars.length - 1));
      const ch = chars[charIndex];
      asciiCtx.fillText(ch, x * charW, y * charH);
    }
  }

  // Scale ascii canvas to original image size so output keeps original dimensions
  exportCanvas.width = origWidth; exportCanvas.height = origHeight;
  exportCtx.clearRect(0,0,origWidth,origHeight);
  exportCtx.drawImage(asciiCanvas, 0, 0, asciiW, asciiH, 0, 0, origWidth, origHeight);

  // Update preview from export canvas
  renderPreviewFromExport();
}

convertBtn.addEventListener('click', convert);

downloadBtn.addEventListener('click', ()=>{
  // download from export canvas (original converted size)
  const url = exportCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = 'converted.png';
  document.body.appendChild(a); a.click(); a.remove();
});

// Initialize UI state
modeSelect.dispatchEvent(new Event('change'));

// Wire clear saved image button and restore on load
const clearSavedBtn = document.getElementById('clearSavedBtn');
if(clearSavedBtn){
  clearSavedBtn.addEventListener('click', ()=>{
    localStorage.removeItem('savedImage');
    loadedImage = null;
    ctx.clearRect(0,0,outputCanvas.width, outputCanvas.height);
    downloadBtn.disabled = true;
  });
}

// Restore saved image (if any)
try{
  const saved = localStorage.getItem('savedImage');
  if(saved) loadFromDataURL(saved);
}catch(e){ console.warn('Could not access localStorage', e); }
