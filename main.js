async function fetchImages() {
  const res = await fetch('/api/images');
  if (!res.ok) throw new Error('Failed to fetch images');
  const data = await res.json();
  return data.images || [];
}

function renderImageGrid(images) {
  const grid = document.getElementById('images');
  grid.innerHTML = '';
  for (const url of images) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = url.split('/').pop();
    grid.appendChild(img);
  }
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

async function generateUI(prompt, images) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Generation failed');
  }
  const data = await res.json();
  return data.html || '';
}

function stripMarkdownFences(text) {
  const fence = text.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n```/);
  if (fence && fence[1]) return fence[1];
  const fence2 = text.match(/```[a-zA-Z]*\s*\r?\n?([\s\S]*?)```/);
  if (fence2 && fence2[1]) return fence2[1];
  return text.replace(/^```[a-zA-Z]*\s*/g, '').replace(/```\s*$/g, '');
}

function injectGeneratedHtml(html) {
  const raw = stripMarkdownFences(html).trim();
  const container = document.getElementById('output');
  container.innerHTML = raw;
  // Re-execute any inline scripts
  const scripts = container.querySelectorAll('script');
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    if (oldScript.src) {
      newScript.src = oldScript.src;
    } else {
      newScript.textContent = oldScript.textContent;
    }
    // copy type if present
    if (oldScript.type) newScript.type = oldScript.type;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
  document.getElementById('htmlDump').textContent = raw;
  lastGeneratedHtml = raw;
}

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
function hasAllowedExtension(name) {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
function isAcceptableImage(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return hasAllowedExtension(file.name || '');
}

async function getFilesFromDataTransfer(dt) {
  const items = Array.from(dt.items || []);
  const files = [];
  // Prefer directory-aware traversal if available
  if (items.length && items[0].webkitGetAsEntry) {
    const entries = items
      .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    for (const entry of entries) {
      const nested = await traverseEntry(entry);
      files.push(...nested);
    }
    return files;
  }
  // Fallback: plain files
  return Array.from(dt.files || []);
}

function readDirEntries(dirReader) {
  return new Promise((resolve, reject) => {
    dirReader.readEntries(resolve, reject);
  });
}

async function traverseEntry(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve) => entry.file(resolve));
    return [file];
  }
  if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const collected = [];
    while (true) {
      const batch = await readDirEntries(dirReader);
      if (!batch.length) break;
      for (const e of batch) {
        const nested = await traverseEntry(e);
        collected.push(...nested);
      }
    }
    return collected;
  }
  return [];
}

let serverImageUrls = [];
let uploadedObjectUrls = [];
let lastGeneratedHtml = '';
function getAllImages() {
  return [...serverImageUrls, ...uploadedObjectUrls];
}
function appendUploadedImages(files) {
  const before = uploadedObjectUrls.length;
  const newUrls = [];
  for (const f of files) {
    if (!isAcceptableImage(f)) continue;
    const url = URL.createObjectURL(f);
    newUrls.push(url);
  }
  // Deduplicate by URL string (object URLs are unique per file instance),
  // but also prevent bloat by filtering invalid/empty
  uploadedObjectUrls = [...uploadedObjectUrls, ...newUrls].filter(Boolean);
  const all = getAllImages();
  renderImageGrid(all);
  const added = uploadedObjectUrls.length - before;
  setStatus(`Added ${added} image(s). Total: ${all.length}.`);
  // If there is an existing generated snippet, restart its lifecycle by re-injecting
  if (lastGeneratedHtml) {
    injectGeneratedHtml(lastGeneratedHtml);
  }
}

async function main() {
  setStatus('Loading images...');
  serverImageUrls = [];
  try {
    serverImageUrls = await fetchImages();
    renderImageGrid(getAllImages());
    setStatus('Images loaded. Ready.');
  } catch (e) {
    console.error(e);
    setStatus('Failed to load images');
  }

  const promptEl = document.getElementById('prompt');
  const btn = document.getElementById('generateBtn');
  const dropzone = document.getElementById('dropzone');
  const folderInput = document.getElementById('folderInput');
  const imagesInput = document.getElementById('imagesInput');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const selectImagesBtn = document.getElementById('selectImagesBtn');

  btn.addEventListener('click', async () => {
    const prompt = (promptEl.value || '').trim();
    if (!prompt) {
      setStatus('Enter a prompt first');
      return;
    }
    btn.disabled = true;
    setStatus('Generating with Gemini Flash...');
    try {
      const allImages = getAllImages();
      if (!allImages.length) {
        setStatus('No images available. Add images or upload a folder.');
        btn.disabled = false;
        return;
      }
      const html = await generateUI(prompt, allImages);
      injectGeneratedHtml(html);
      setStatus('Done');
    } catch (e) {
      console.error(e);
      setStatus('Generation failed');
    } finally {
      btn.disabled = false;
    }
  });

  // Folder selection via button
  selectFolderBtn.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', () => {
    const files = Array.from(folderInput.files || []);
    const nonImages = files.filter((f) => !isAcceptableImage(f));
    if (nonImages.length) {
      setStatus(`Ignored ${nonImages.length} non-image files.`);
    }
    appendUploadedImages(files);
  });

  // Individual images selection via button
  selectImagesBtn.addEventListener('click', () => imagesInput.click());
  imagesInput.addEventListener('change', () => {
    const files = Array.from(imagesInput.files || []);
    const nonImages = files.filter((f) => !isAcceptableImage(f));
    if (nonImages.length) {
      setStatus(`Ignored ${nonImages.length} non-image files.`);
    }
    appendUploadedImages(files);
  });

  // Drag & Drop folder support
  if (dropzone) {
    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (evt === 'dragleave') dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', async (e) => {
      dropzone.classList.remove('dragover');
      try {
        const files = await getFilesFromDataTransfer(e.dataTransfer);
        const nonImages = files.filter((f) => !isAcceptableImage(f));
        if (!files.length) {
          setStatus('No files detected in drop.');
          return;
        }
        if (nonImages.length) {
          setStatus(`Ignored ${nonImages.length} non-image files.`);
        }
        appendUploadedImages(files);
      } catch (err) {
        console.error(err);
        setStatus('Failed to read dropped folder');
      }
    });
  }

  // Cleanup object URLs on page unload
  window.addEventListener('beforeunload', () => {
    for (const url of uploadedObjectUrls) URL.revokeObjectURL(url);
  });
}

main();


