// Simple, dependency-free converter: Image -> ASCII or pixelated paint
const fileElem = document.getElementById('fileElem');
const dropArea = document.getElementById('drop-area');
const modeSelect = document.getElementById('modeSelect');
const convertBtn = document.getElementById('convertBtn');
const downloadBtn = document.getElementById('downloadBtn');
const outputCanvas = document.getElementById('outputCanvas');
const ctx = outputCanvas.getContext('2d');
const fontSizeInput = document.getElementById('fontSize');
const pixelSizeInput = document.getElementById('pixelSize');
const asciiSettings = document.getElementById('asciiSettings');
const paintSettings = document.getElementById('paintSettings');

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
  asciiSettings.style.display = mode==='ascii' ? 'inline-flex' : 'none';
  paintSettings.style.display = mode==='paint' ? 'inline-flex' : 'none';
});

function loadFromDataURL(dataURL){
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = ()=>{
    loadedImage = img;
    const maxW = 900;
    const scale = Math.min(1, maxW / img.width);
    outputCanvas.width = Math.round(img.width * scale);
    outputCanvas.height = Math.round(img.height * scale);
    ctx.clearRect(0,0,outputCanvas.width, outputCanvas.height);
    ctx.drawImage(img, 0, 0, outputCanvas.width, outputCanvas.height);
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
    const style = document.getElementById('paintStyle')?.value || 'pixel';
    convertToPaint(loadedImage, Number(pixelSizeInput.value), style);
  }
}

function convertToPaint(img, pixelSize, style){
  const smallW = Math.max( Math.floor(outputCanvas.width / pixelSize), 1 );
  const smallH = Math.max( Math.floor(outputCanvas.height / pixelSize), 1 );
  const temp = document.createElement('canvas');
  temp.width = smallW; temp.height = smallH;
  const tctx = temp.getContext('2d');
  tctx.drawImage(img, 0, 0, smallW, smallH);

  // Prepare output canvas
  outputCanvas.width = smallW * pixelSize;
  outputCanvas.height = smallH * pixelSize;
  ctx.imageSmoothingEnabled = false;

  const data = tctx.getImageData(0,0,smallW,smallH).data;

  if(style === 'pixel'){
    for(let y=0;y<smallH;y++){
      for(let x=0;x<smallW;x++){
        const i = (y*smallW + x)*4;
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`;
        ctx.fillRect(x*pixelSize, y*pixelSize, pixelSize, pixelSize);
      }
    }
    return;
  }

  // For brush and gallery styles, draw with softer strokes
  ctx.clearRect(0,0,outputCanvas.width, outputCanvas.height);
  for(let y=0;y<smallH;y++){
    for(let x=0;x<smallW;x++){
      const i = (y*smallW + x)*4;
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3] / 255;
      const cx = x * pixelSize + pixelSize/2;
      const cy = y * pixelSize + pixelSize/2;
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;

      if(style === 'brush'){
        // multiple overlapping circles to simulate brush texture
        const strokes = Math.max(1, Math.round(pixelSize/3));
        for(let s=0;s<strokes;s++){
          const jitterX = (Math.random()-0.5) * pixelSize * 0.4;
          const jitterY = (Math.random()-0.5) * pixelSize * 0.4;
          const radius = pixelSize * (0.45 + (Math.random()-0.5)*0.15);
          ctx.beginPath();
          ctx.globalAlpha = 0.9 * a;
          ctx.shadowColor = `rgba(${r},${g},${b},${a*0.5})`;
          ctx.shadowBlur = 2;
          ctx.arc(cx + jitterX, cy + jitterY, radius, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }

      if(style === 'gallery'){
        // larger, softer strokes and an overall subtle texture
        const radius = pixelSize * (0.6 + Math.random()*0.6);
        ctx.beginPath();
        ctx.globalAlpha = 0.9 * a;
        ctx.filter = 'blur(0.5px)';
        ctx.arc(cx + (Math.random()-0.5)*pixelSize*0.2, cy + (Math.random()-0.5)*pixelSize*0.2, radius, 0, Math.PI*2);
        ctx.fill();
        ctx.filter = 'none'; ctx.globalAlpha = 1;
      }
    }
  }

  // gallery: overlay a subtle paper/noise texture
  if(style === 'gallery'){
    const tex = document.createElement('canvas');
    tex.width = outputCanvas.width; tex.height = outputCanvas.height;
    const t = tex.getContext('2d');
    const imgd = t.createImageData(tex.width, tex.height);
    for(let i=0;i<imgd.data.length;i+=4){
      const v = 230 + Math.floor(Math.random()*25); // light noise
      imgd.data[i]=imgd.data[i+1]=imgd.data[i+2]=v;
      imgd.data[i+3]=12; // very low alpha
    }
    t.putImageData(imgd,0,0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(tex,0,0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function convertToASCII(img, fontSize){
  // Character set ordered dark->light
  const chars = '@%#*+=-:. ';
  // Decide target columns based on canvas width and font width
  const charW = Math.round(fontSize * 0.6);
  const charH = Math.round(fontSize * 1.0);
  const cols = Math.max( Math.floor(outputCanvas.width / charW), 20 );
  const rows = Math.max( Math.floor(outputCanvas.height / charH), 20 );

  const temp = document.createElement('canvas');
  temp.width = cols; temp.height = rows;
  const tctx = temp.getContext('2d');
  tctx.drawImage(img, 0, 0, cols, rows);
  const imgd = tctx.getImageData(0,0,cols,rows).data;

  // Prepare output canvas sized to characters
  outputCanvas.width = cols * charW;
  outputCanvas.height = rows * charH;
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,outputCanvas.width,outputCanvas.height);
  ctx.fillStyle = '#000';
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  for(let y=0;y<rows;y++){
    for(let x=0;x<cols;x++){
      const i = (y*cols + x)*4;
      const r = imgd[i], g = imgd[i+1], b = imgd[i+2];
      const brightness = (0.299*r + 0.587*g + 0.114*b) / 255; // 0..1
      const charIndex = Math.floor((1 - brightness) * (chars.length - 1));
      const ch = chars[charIndex];
      ctx.fillText(ch, x * charW, y * charH);
    }
  }
}

convertBtn.addEventListener('click', convert);

downloadBtn.addEventListener('click', ()=>{
  const url = outputCanvas.toDataURL('image/png');
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
