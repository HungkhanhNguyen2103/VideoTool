'use strict';

/* ==========================================================================
   Video Tool — Khởi Tạo Dự Án
   Vanilla JS, không cần build. Dữ liệu lưu trong localStorage (giả lập backend).
   Khi nối backend thật, chỉ cần thay các hàm trong `api` bằng fetch.
   ========================================================================== */

/* ---------- Cấu hình ---------- */

const CONFIG = {
  nextPageUrl: '../duyet-tai-tao/index.html', // trang tab "Duyệt & Tái Tạo"
  navigateDelayMs: 900,
  apiDelayMs: 350,
};

const STORAGE_KEY = 'videoTool.projects.v1';
const CURRENT_KEY = 'videoTool.currentProjectId.v1';

const STATUS = {
  draft: { label: 'Nháp', cls: 'badge--muted' },
  script: { label: 'Đã có kịch bản', cls: 'badge--indigo' },
  assets: { label: 'Đã có asset', cls: 'badge--amber' },
  rendered: { label: 'Đã render', cls: 'badge--green' },
};

const RESOLUTIONS = {
  '16:9': [[1920, 1080], [1280, 720]],
  '9:16': [[1080, 1920], [720, 1280]],
  '1:1': [[1080, 1080]],
};

const LIMITS = { maxFiles: 10, maxFileBytes: 10 * 1024 * 1024 };

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac']);

/* ---------- Tiện ích ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu. */
const norm = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${sec} giây`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} phút ${s} giây` : `${m} phút`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
function relTime(ts) {
  const diff = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return 'vừa xong';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString('vi-VN');
}

/* ---------- Lưu trữ (localStorage, có dự phòng bộ nhớ) ---------- */

const memory = {};
function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return key in memory ? memory[key] : null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    memory[key] = value;
  }
}

/* Dữ liệu mẫu cho lần chạy đầu tiên. Tên/số liệu ở dự án 2, 3 chỉ là minh họa. */
function seedProjects() {
  const now = Date.now();
  const base = { language: 'vi', scriptPresetId: 'documentary', createdAt: now };
  return [
    { ...base, id: 'p-seed-1', title: 'Sự kiêu ngạo của Ô Mã Nhi và bản án tử hình cho 30 vạn quân Nguyên',
      status: 'script', scenesCount: 34, durationSec: 170, updatedAt: now - 2 * 3600e3 },
    { ...base, id: 'p-seed-2', title: '[Tên dự án 2]',
      status: 'rendered', scenesCount: 20, durationSec: 100, updatedAt: now - 26 * 3600e3 },
    { ...base, id: 'p-seed-3', title: '[Tên dự án 3]',
      status: 'draft', scenesCount: null, durationSec: null, updatedAt: now - 6 * 86400e3 },
  ];
}

/* ---------- Trạng thái ---------- */

let projects = load(STORAGE_KEY);
if (!Array.isArray(projects)) {
  projects = seedProjects();
  save(STORAGE_KEY, projects);
}
let currentId = load(CURRENT_KEY);
if (currentId === null && projects.length) currentId = projects[0].id;

const ui = { query: '', status: 'all', files: [], submitted: false, pendingDeleteId: null, zip: null };

const persist = () => save(STORAGE_KEY, projects);
const setCurrent = (id) => { currentId = id; save(CURRENT_KEY, id); };

/* ---------- API giả lập (thay bằng fetch tới backend) ---------- */

const api = {
  async createProject(payload) {
    await delay(CONFIG.apiDelayMs);
    const now = Date.now();
    const project = { ...payload, id: uid(), status: 'draft', scenesCount: null, durationSec: null, createdAt: now, updatedAt: now };
    projects = [project, ...projects];
    persist();
    return project;
  },

  async duplicateProject(id) {
    await delay(150);
    const src = projects.find((p) => p.id === id);
    if (!src) throw new Error('Không tìm thấy dự án.');
    const now = Date.now();
    const copy = {
      ...src, id: uid(), title: `${src.title} (bản sao)`, createdAt: now, updatedAt: now,
      status: src.status === 'rendered' ? 'assets' : src.status, // bản sao chưa có file video
    };
    projects = [copy, ...projects];
    persist();
    return copy;
  },

  async deleteProject(id) {
    await delay(150);
    projects = projects.filter((p) => p.id !== id);
    persist();
  },

  async importZip({ name, summary }) {
    await delay(CONFIG.apiDelayMs);
    const now = Date.now();
    const project = {
      id: uid(), title: name, language: 'vi', scriptPresetId: 'documentary', status: 'draft',
      scenesCount: null, durationSec: null, source: 'zip', zipSummary: summary, createdAt: now, updatedAt: now,
    };
    projects = [project, ...projects];
    persist();
    return project;
  },
};

/* ---------- Đọc danh mục file trong ZIP (không giải nén) ---------- */

async function readZipEntries(file) {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await file.slice(tailStart).arrayBuffer();
  const tv = new DataView(tail);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Không phải file ZIP hợp lệ.');

  const total = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 (file rất lớn) chưa hỗ trợ xem trước.');
  if (total === 0) return [];

  const cd = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const dv = new DataView(cd);
  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cd.byteLength || dv.getUint32(p, true) !== CD_SIG) throw new Error('Danh mục ZIP bị hỏng.');
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    if (p + 46 + nameLen > cd.byteLength) throw new Error('Danh mục ZIP bị hỏng.');
    const name = decoder.decode(new Uint8Array(cd, p + 46, nameLen));
    entries.push({ name, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function summarizeZip(entries) {
  const files = entries.filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(e.name));
  const s = { total: files.length, json: 0, images: 0, audio: 0, other: 0, names: files.map((f) => f.name) };
  files.forEach((f) => {
    const dot = f.name.lastIndexOf('.');
    const ext = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : '';
    if (ext === 'json') s.json += 1;
    else if (IMAGE_EXT.has(ext)) s.images += 1;
    else if (AUDIO_EXT.has(ext)) s.audio += 1;
    else s.other += 1;
  });
  return s;
}

/* ---------- Phần tử giao diện ---------- */

const els = {
  title: $('#project-title'),
  meta: $('#project-meta'),
  form: $('#project-form'),
  formError: $('#form-error'),
  fTitle: $('#title'),
  fBrief: $('#brief'),
  fRefsText: $('#refs-text'),
  fRefsFiles: $('#refs-files'),
  fDuration: $('#duration'),
  fChapters: $('#chapters'),
  fPreset: $('#preset'),
  fLanguage: $('#language'),
  fResolution: $('#resolution'),
  fFps: $('#fps'),
  fVoice: $('#voice'),
  briefCount: $('#brief-count'),
  durationHint: $('#duration-hint'),
  fileChips: $('#file-chips'),
  btnDraft: $('#btn-draft'),
  btnOutline: $('#btn-outline'),
  btnOutlineLabel: $('#btn-outline-label'),
  recentCount: $('#recent-count'),
  search: $('#search'),
  statusFilter: $('#status-filter'),
  list: $('#project-list'),
  empty: $('#project-empty'),
  openZip: $('#open-zip'),
  dlgDelete: $('#dlg-delete'),
  dlgDeleteText: $('#dlg-delete-text'),
  dlgZip: $('#dlg-zip'),
  dropzone: $('#dropzone'),
  zipFile: $('#zip-file'),
  zipPreview: $('#zip-preview'),
  zipImport: $('#zip-import'),
  zipCancel: $('#zip-cancel'),
  toast: $('#toast'),
};

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3000);
}

/* ---------- Render: tiêu đề & danh sách ---------- */

function projectMeta(p) {
  return p.scenesCount != null ? `${p.scenesCount} cảnh • ${p.durationSec}s` : STATUS[p.status].label;
}

function renderHeader() {
  const p = projects.find((x) => x.id === currentId);
  els.title.textContent = p ? p.title : 'Chưa mở dự án nào';
  els.meta.textContent = p ? projectMeta(p) : '—';
}

function filteredProjects() {
  const q = norm(ui.query.trim());
  return [...projects]
    .filter((p) => (ui.status === 'all' || p.status === ui.status) && (!q || norm(p.title).includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function projectHTML(p) {
  const st = STATUS[p.status];
  const isCurrent = p.id === currentId;
  const meta = [p.scenesCount != null ? `${p.scenesCount} cảnh • ${p.durationSec}s` : null, relTime(p.updatedAt)]
    .filter(Boolean).join(' · ');
  return `<li class="project" data-id="${esc(p.id)}" data-current="${isCurrent}">
    <div class="project__top">
      <h3 class="project__title">${esc(p.title)}</h3>
      <div class="project__badges">
        <span class="badge ${st.cls}">${st.label}</span>
        ${isCurrent ? '<span class="badge badge--amber">Đang mở</span>' : ''}
      </div>
    </div>
    <div class="project__meta">${esc(meta)}</div>
    <div class="project__actions">
      <button type="button" class="btn btn--ghost btn--sm" data-action="open" ${isCurrent ? 'disabled' : ''}>${icon('folder')}${isCurrent ? 'Đang mở' : 'Mở'}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-action="duplicate" aria-label="Nhân bản ${esc(p.title)}">${icon('copy')}Nhân bản</button>
      <button type="button" class="btn btn--red btn--sm" data-action="delete" aria-label="Xóa ${esc(p.title)}">${icon('trash')}Xóa</button>
    </div>
  </li>`;
}

function renderList() {
  const items = filteredProjects();
  const filtering = ui.query.trim() !== '' || ui.status !== 'all';
  els.recentCount.textContent = filtering ? `${items.length}/${projects.length} dự án` : `${projects.length} dự án`;
  els.list.innerHTML = items.map(projectHTML).join('');

  if (items.length) {
    els.empty.hidden = true;
    els.list.hidden = false;
    return;
  }
  els.list.hidden = true;
  els.empty.hidden = false;
  els.empty.innerHTML = projects.length
    ? `<strong>Không có dự án khớp bộ lọc</strong><button type="button" class="btn btn--ghost btn--sm" data-action="clear-filter">Xóa bộ lọc</button>`
    : `<strong>Chưa có dự án nào</strong><span>Tạo dự án đầu tiên ở form bên trái, hoặc nhập từ file ZIP.</span>`;
}

function renderAll() {
  renderHeader();
  renderList();
}

/* ---------- Form: dữ liệu, kiểm tra, gửi ---------- */

function fillResolutions(aspect, keep) {
  els.fResolution.innerHTML = RESOLUTIONS[aspect]
    .map(([w, h]) => `<option value="${w}x${h}">${w}×${h}</option>`)
    .join('');
  if (keep && [...els.fResolution.options].some((o) => o.value === keep)) els.fResolution.value = keep;
}

const currentAspect = () => document.querySelector('input[name="aspect"]:checked').value;

function updateBriefCount() {
  els.briefCount.textContent = String(els.fBrief.value.trim().length);
}

function updateDurationHint() {
  const v = Number(els.fDuration.value);
  els.durationHint.textContent = Number.isInteger(v) && v > 0 ? `≈ ${formatDuration(v)}` : '';
}

function validate() {
  const errors = {};
  const title = els.fTitle.value.trim();
  if (!title) errors.title = 'Vui lòng nhập tên dự án.';
  else if (title.length > 120) errors.title = 'Tên dự án tối đa 120 ký tự.';

  const briefLen = els.fBrief.value.trim().length;
  if (briefLen < 10) errors.brief = `Brief cần tối thiểu 10 ký tự (hiện có ${briefLen}).`;

  if (ui.files.length > LIMITS.maxFiles) errors.refs = `Tối đa ${LIMITS.maxFiles} file tư liệu.`;
  else {
    const big = ui.files.find((f) => f.size > LIMITS.maxFileBytes);
    if (big) errors.refs = `"${big.name}" vượt quá 10 MB.`;
  }

  const durRaw = els.fDuration.value.trim();
  const dur = Number(durRaw);
  if (!durRaw || !Number.isInteger(dur) || dur < 30 || dur > 3600) errors.duration = 'Nhập số nguyên từ 30 đến 3600 giây.';

  const chRaw = els.fChapters.value.trim();
  if (chRaw) {
    const ch = Number(chRaw);
    if (!Number.isInteger(ch) || ch < 1 || ch > 20) errors.chapters = 'Nhập số nguyên từ 1 đến 20, hoặc để trống.';
  }
  return errors;
}

const FIELD_MAP = {
  title: { input: els.fTitle, err: $('#title-err') },
  brief: { input: els.fBrief, err: $('#brief-err') },
  refs: { input: els.fRefsText, err: $('#refs-err'), noInvalid: true },
  duration: { input: els.fDuration, err: $('#duration-err') },
  chapters: { input: els.fChapters, err: $('#chapters-err') },
};
const FIELD_ORDER = ['title', 'brief', 'refs', 'duration', 'chapters'];

function showErrors(errors) {
  FIELD_ORDER.forEach((key) => {
    const { input, err, noInvalid } = FIELD_MAP[key];
    err.textContent = errors[key] || '';
    if (!noInvalid) input.setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
  });
  const n = Object.keys(errors).length;
  els.formError.hidden = n === 0;
  els.formError.innerHTML = n ? `${icon('alert')}<span>Vui lòng kiểm tra ${n} trường bên dưới.</span>` : '';
}

function collect() {
  const [width, height] = els.fResolution.value.split('x').map(Number);
  const chRaw = els.fChapters.value.trim();
  return {
    title: els.fTitle.value.trim(),
    language: els.fLanguage.value,
    brief: els.fBrief.value.trim(),
    referencesText: els.fRefsText.value.trim(),
    referenceFiles: ui.files.map((f) => ({ name: f.name, size: f.size })),
    scriptPresetId: els.fPreset.value,
    targetDurationSec: Number(els.fDuration.value),
    chapterCount: chRaw ? Number(chRaw) : null,
    renderSettings: { aspect: currentAspect(), width, height, fps: Number(els.fFps.value) },
    voiceId: els.fVoice.value || null,
  };
}

function resetForm() {
  els.form.reset();
  ui.files = [];
  ui.submitted = false;
  fillResolutions('16:9');
  renderFiles();
  showErrors({});
  updateBriefCount();
  updateDurationHint();
}

function setBusy(busy, mode) {
  [els.btnDraft, els.btnOutline].forEach((b) => { b.disabled = busy; });
  const active = mode === 'draft' ? els.btnDraft : els.btnOutline;
  if (busy) active.setAttribute('aria-busy', 'true'); else active.removeAttribute('aria-busy');
  els.btnOutlineLabel.textContent = busy && mode === 'outline' ? 'Đang tạo…' : 'Tạo dàn ý';
  els.btnDraft.textContent = busy && mode === 'draft' ? 'Đang lưu…' : 'Chỉ lưu nháp';
}

function goToNextPage() {
  window.location.assign(CONFIG.nextPageUrl);
}

async function submit(mode) {
  ui.submitted = true;
  const errors = validate();
  showErrors(errors);
  const firstInvalid = FIELD_ORDER.find((k) => errors[k]);
  if (firstInvalid) {
    FIELD_MAP[firstInvalid].input.focus();
    return;
  }

  setBusy(true, mode);
  try {
    const project = await api.createProject(collect());
    setCurrent(project.id);
    resetForm();
    renderAll();
    if (mode === 'outline') {
      toast('Đã tạo dự án. Đang chuyển sang "Duyệt & Tái Tạo"…');
      setTimeout(goToNextPage, CONFIG.navigateDelayMs);
    } else {
      toast('Đã lưu bản nháp.');
    }
  } catch (err) {
    toast(`Không tạo được dự án: ${err.message}`);
  } finally {
    setBusy(false, mode);
  }
}

/* ---------- File tư liệu ---------- */

function renderFiles() {
  els.fileChips.innerHTML = ui.files
    .map((f, i) => `<li class="file-chip"><span>${esc(f.name)}</span><span class="file-chip__size">${formatSize(f.size)}</span>
      <button type="button" data-remove-file="${i}" aria-label="Bỏ file ${esc(f.name)}">${icon('x')}</button></li>`)
    .join('');
}

function addFiles(list) {
  [...list].forEach((f) => {
    if (!ui.files.some((x) => x.name === f.name && x.size === f.size)) ui.files.push(f);
  });
  renderFiles();
  if (ui.submitted) showErrors(validate());
}

/* ---------- Hộp thoại nhập ZIP ---------- */

function resetZipDialog() {
  ui.zip = null;
  els.zipFile.value = '';
  els.zipPreview.hidden = true;
  els.zipPreview.innerHTML = '';
  els.zipImport.disabled = true;
  els.dropzone.classList.remove('is-over');
}

async function handleZipFile(file) {
  if (!file) return;
  ui.zip = null;
  els.zipImport.disabled = true;
  els.zipPreview.hidden = false;

  if (!/\.zip$/i.test(file.name)) {
    els.zipPreview.innerHTML = `<div class="zip-note zip-note--error">${icon('alert')}<span>Chỉ nhận file .zip.</span></div>`;
    return;
  }

  try {
    const entries = await readZipEntries(file);
    const summary = summarizeZip(entries);
    const notes = [];
    if (summary.total === 0) {
      notes.push(['error', 'ZIP không chứa file nào.']);
    } else if (summary.json === 0) {
      notes.push(['warn', 'Không thấy file dữ liệu (.json). Vẫn nhập được, nhưng dự án sẽ chưa có kịch bản.']);
    }
    const shown = summary.names.slice(0, 6).map((n) => `<li title="${esc(n)}">${esc(n)}</li>`).join('');
    const more = summary.total > 6 ? `<li>…và ${summary.total - 6} file khác</li>` : '';

    els.zipPreview.innerHTML = `
      <div class="zip-name">${esc(file.name)} · ${formatSize(file.size)} · ${summary.total} file</div>
      <div class="zip-stats">
        <div class="zip-stat"><strong>${summary.json}</strong><span>Dữ liệu (.json)</span></div>
        <div class="zip-stat"><strong>${summary.images}</strong><span>Ảnh</span></div>
        <div class="zip-stat"><strong>${summary.audio}</strong><span>Audio</span></div>
        <div class="zip-stat"><strong>${summary.other}</strong><span>Khác</span></div>
      </div>
      ${notes.map(([kind, text]) => `<div class="zip-note zip-note--${kind}">${icon('alert')}<span>${esc(text)}</span></div>`).join('')}
      ${summary.total ? `<ul class="zip-files" aria-label="Một số file trong ZIP">${shown}${more}</ul>` : ''}`;

    if (summary.total > 0) {
      ui.zip = { file, summary };
      els.zipImport.disabled = false;
    }
  } catch (err) {
    els.zipPreview.innerHTML = `<div class="zip-note zip-note--error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
  }
}

async function importZip() {
  if (!ui.zip) return;
  const { file, summary } = ui.zip;
  els.zipImport.disabled = true;
  const project = await api.importZip({ name: file.name.replace(/\.zip$/i, ''), summary: { ...summary, names: undefined } });
  setCurrent(project.id);
  els.dlgZip.close('ok');
  renderAll();
  toast(`Đã nhập "${project.title}" từ ZIP.`);
}

/* ---------- Sự kiện ---------- */

// Form
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(e.submitter && e.submitter.value === 'draft' ? 'draft' : 'outline');
});

els.form.addEventListener('input', (e) => {
  if (e.target === els.fBrief) updateBriefCount();
  if (e.target === els.fDuration) updateDurationHint();
  if (ui.submitted) showErrors(validate()); // kiểm tra lại ngay sau lần gửi đầu tiên
});

els.form.addEventListener('change', (e) => {
  if (e.target.name === 'aspect') fillResolutions(e.target.value);
});

document.querySelectorAll('.chip-btn[data-duration]').forEach((b) => {
  b.addEventListener('click', () => {
    els.fDuration.value = b.dataset.duration;
    updateDurationHint();
    if (ui.submitted) showErrors(validate());
  });
});

els.fRefsFiles.addEventListener('change', () => {
  addFiles(els.fRefsFiles.files);
  els.fRefsFiles.value = '';
});

els.fileChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-file]');
  if (!btn) return;
  ui.files.splice(Number(btn.dataset.removeFile), 1);
  renderFiles();
  if (ui.submitted) showErrors(validate());
});

// Danh sách dự án
els.search.addEventListener('input', () => { ui.query = els.search.value; renderList(); });
els.statusFilter.addEventListener('change', () => { ui.status = els.statusFilter.value; renderList(); });

els.empty.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="clear-filter"]')) return;
  ui.query = ''; ui.status = 'all';
  els.search.value = ''; els.statusFilter.value = 'all';
  renderList();
});

els.list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  const li = e.target.closest('.project');
  if (!btn || !li) return;
  const id = li.dataset.id;
  const p = projects.find((x) => x.id === id);
  if (!p) return;

  if (btn.dataset.action === 'open') {
    setCurrent(id);
    renderAll();
    toast(`Đã mở "${p.title}".`);
  } else if (btn.dataset.action === 'duplicate') {
    const copy = await api.duplicateProject(id);
    renderAll();
    toast(`Đã nhân bản thành "${copy.title}".`);
  } else if (btn.dataset.action === 'delete') {
    ui.pendingDeleteId = id;
    els.dlgDeleteText.textContent = `Dự án "${p.title}" sẽ bị xóa khỏi danh sách. Thao tác này không thể hoàn tác.`;
    els.dlgDelete.showModal();
  }
});

els.dlgDelete.addEventListener('close', async () => {
  const id = ui.pendingDeleteId;
  ui.pendingDeleteId = null;
  if (els.dlgDelete.returnValue !== 'ok' || !id) return;
  await api.deleteProject(id);
  if (currentId === id) setCurrent(projects.length ? projects[0].id : null);
  renderAll();
  toast('Đã xóa dự án.');
});

// ZIP
els.openZip.addEventListener('click', () => { resetZipDialog(); els.dlgZip.showModal(); });
els.zipCancel.addEventListener('click', () => els.dlgZip.close('cancel'));
els.zipImport.addEventListener('click', importZip);
els.zipFile.addEventListener('change', () => handleZipFile(els.zipFile.files[0]));

['dragenter', 'dragover'].forEach((t) =>
  els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) =>
  els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.remove('is-over'); }));
els.dropzone.addEventListener('drop', (e) => handleZipFile(e.dataTransfer.files[0]));

// Tab
document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    toast(`Tab "${tab.dataset.tab}" chưa dựng trong bản demo.`);
  });
});
const nextTab = $('[data-tab-link="next"]');
if (nextTab) nextTab.setAttribute('href', CONFIG.nextPageUrl);

/* ---------- Khởi động ---------- */

fillResolutions('16:9');
updateBriefCount();
updateDurationHint();
renderAll();
