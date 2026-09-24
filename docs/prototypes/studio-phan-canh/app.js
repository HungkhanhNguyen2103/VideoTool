'use strict';

/* ==========================================================================
   Video Tool — Studio Phân Cảnh & Xuất Video
   Vanilla JS, không cần build. Dữ liệu và AI đều là giả lập.
   Khi nối backend thật, chỉ cần thay các hàm trong `api` bên dưới bằng fetch,
   theo đúng contract của src/client/features/asset/api.ts.
   ========================================================================== */

/* ---------- Hằng số & dữ liệu mẫu ---------- */

const PROJECT = {
  title: 'Kodak: Kẻ phát minh ra máy ảnh kỹ thuật số tự tay giết chết chính mình',
  status: 'assets',
  renderEngine: 'ffmpeg',
  bgmMood: '',
  bgmUrl: null,
  renderUrl: null,
};

const STATUS_LABEL = { draft: 'Bản nháp', script: 'Kịch bản', assets: 'Đang làm asset', rendered: 'Đã render' };
const STATUS_CLS = { draft: 'badge--muted', script: 'badge--indigo', assets: 'badge--green', rendered: 'badge--green' };

let scenes = [
  {
    id: 's1', no: 1, narration: 'Ngày 19 tháng 1 năm 2012, ban giám đốc Eastman Kodak ký vào đơn xin bảo hộ phá sản.',
    durationSec: 8, assetType: 'image', visualPrompt: 'Ảnh tư liệu đen trắng, trụ sở Kodak ở Rochester, ánh sáng lạnh, không khí u ám.',
    assetKind: 'image', assetUrl: 'https://picsum.photos/seed/kodak1/640/360', livePreviewUrl: null,
    audioUrl: 'data:audio/mp3;base64,', sfxPrompt: '', sfxUrl: null, editing: false,
  },
  {
    id: 's2', no: 2, narration: 'Công ty từng có giá trị hơn 30 tỷ đô la, từng là cái tên đồng nghĩa với nhiếp ảnh.',
    durationSec: 6, assetType: 'video', visualPrompt: 'B-roll chuyển động chậm qua các cuộn phim Kodak xếp trên kệ kho.',
    assetKind: 'other', assetUrl: 'data:application/pdf;base64,', livePreviewUrl: null, audioUrl: 'data:audio/mp3;base64,',
    sfxPrompt: 'tiếng cuộn phim lách cách', sfxUrl: 'data:audio/mp3;base64,', editing: false,
  },
  {
    id: 's3', no: 3, narration: 'Nhưng câu chuyện thật sự không bắt đầu ở đây. Nó bắt đầu 37 năm trước.',
    durationSec: 5, assetType: 'image', visualPrompt: '', assetKind: null, assetUrl: null, livePreviewUrl: null,
    audioUrl: null, sfxPrompt: '', sfxUrl: null, editing: false,
  },
  {
    id: 's4', no: 4, narration: 'Một kỹ sư trẻ mang tới ban lãnh đạo một chiếc hộp nặng bốn ký, chạy bằng pin.',
    durationSec: 7, assetType: 'image', visualPrompt: 'Cận cảnh chiếc máy ảnh số nguyên mẫu năm 1975, phong cách phục cổ.',
    assetKind: 'video', assetUrl: 'https://picsum.photos/seed/kodak4/640/360', livePreviewUrl: null, audioUrl: 'data:audio/mp3;base64,',
    sfxPrompt: '', sfxUrl: null, editing: false,
  },
  {
    id: 's5', no: 5, narration: 'Anh gọi nó là "chiếc máy ảnh không cần phim."',
    durationSec: 4, assetType: 'image', visualPrompt: 'Cận cảnh tay kỹ sư ấn nút chụp, biểu cảm hồi hộp.',
    assetKind: 'image', assetUrl: 'https://picsum.photos/seed/kodak5/640/360', livePreviewUrl: null, audioUrl: null,
    sfxPrompt: '', sfxUrl: null, editing: true,
  },
  {
    id: 's6', no: 6, narration: 'Làm sao một phát minh có thể cứu cả một đế chế, lại trở thành thứ không ai muốn nhìn thấy?',
    durationSec: 6, assetType: 'video', visualPrompt: 'Toàn cảnh trên cao tòa nhà trụ sở Kodak về đêm, đèn tắt dần từng tầng.',
    assetKind: null, assetUrl: null, livePreviewUrl: null, audioUrl: 'data:audio/mp3;base64,', sfxPrompt: '', sfxUrl: null, editing: false,
  },
];

let draftPrompt = '';
let busy = null;
let jobActive = false;
let jobProgress = 0;
let jobLogs = [];
let skippedFiles = [];
let uploadPct = null;

/* ---------- API giả lập (thay bằng fetch tới backend thật) ---------- */

const api = {
  copyJson() { return Promise.resolve(JSON.stringify(scenes, null, 2)); },
  exportJson() { return Promise.resolve(JSON.stringify(scenes, null, 2)); },
  importZip(file) {
    return new Promise((resolve) => {
      let pct = 0;
      const timer = setInterval(() => {
        pct += 20;
        uploadPct = Math.min(pct, 100);
        render();
        if (pct >= 100) {
          clearInterval(timer);
          resolve({ updated: 3, skipped: ['scene-99.png', 'thumbs.db'] });
        }
      }, 200);
    });
  },
  setAllAssetType(type) {
    scenes = scenes.map((s) => ({ ...s, assetType: type }));
    return Promise.resolve();
  },
  patchScene(id, patch) {
    scenes = scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
    return Promise.resolve();
  },
  generateAllVoiceovers() { return startJob('generate-voiceovers', ['Đang tổng hợp giọng đọc…', 'Đang chuẩn hoá âm lượng…']); },
  generateVisualPrompts() { return startJob('generate-visual-prompts', ['Đang tạo visual prompt theo chương…', 'Chương 1/3 xong…', 'Chương 2/3 xong…']); },
  regenerateVoiceover(id) {
    return new Promise((resolve) => setTimeout(() => {
      scenes = scenes.map((s) => (s.id === id ? { ...s, audioUrl: 'data:audio/mp3;base64,' } : s));
      resolve();
    }, 500));
  },
  generateSfx(id) {
    return new Promise((resolve) => setTimeout(() => {
      scenes = scenes.map((s) => (s.id === id ? { ...s, sfxUrl: 'data:audio/mp3;base64,' } : s));
      resolve();
    }, 500));
  },
  generateBgm(mood) {
    return new Promise((resolve) => setTimeout(() => { PROJECT.bgmUrl = 'data:audio/mp3;base64,'; resolve(); }, 600));
  },
  renderProject() { return startJob('render', ['Đang ghép cảnh…', 'Đang trộn âm thanh…', 'Đang xuất video…']); },
  previewScene(id) {
    return new Promise((resolve) => setTimeout(() => {
      scenes = scenes.map((s) => (s.id === id ? { ...s, livePreviewUrl: 'data:video/mp4;base64,' } : s));
      resolve();
    }, 400));
  },
};

function startJob(kind, logLines) {
  jobActive = true; jobProgress = 0; jobLogs = [];
  return new Promise((resolve) => {
    let i = 0;
    const timer = setInterval(() => {
      jobProgress = Math.min(jobProgress + 18 + Math.random() * 12, 100);
      if (i < logLines.length && jobProgress > (i + 1) * (100 / (logLines.length + 1))) {
        jobLogs.push(logLines[i]); i += 1;
      }
      render();
      if (jobProgress >= 100) {
        clearInterval(timer);
        jobLogs.push('Hoàn tất.');
        if (kind === 'render') PROJECT.renderUrl = 'data:video/mp4;base64,';
        render();
        setTimeout(() => { jobActive = false; render(); }, 900);
        resolve();
      }
    }, 260);
  });
}

/* ---------- Tiện ích ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const byId = (id) => scenes.find((s) => s.id === id);

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}

function missingSceneNumbers() {
  return scenes.filter((s) => !s.assetUrl).map((s) => s.no);
}

async function withBusy(key, fn) {
  busy = key; render();
  try { await fn(); }
  catch (err) { toast(err && err.message ? err.message : 'Có lỗi xảy ra.'); }
  finally { busy = null; render(); }
}

/* ---------- Render ---------- */

function renderHeader() {
  $('#project-title').textContent = PROJECT.title;
  $('#project-meta').textContent = `${scenes.length} cảnh`;

  $('#page-project-title').textContent = PROJECT.title;
  const statusEl = $('#project-status');
  statusEl.textContent = STATUS_LABEL[PROJECT.status];
  statusEl.className = `badge ${STATUS_CLS[PROJECT.status]}`;
}

function renderOverview() {
  const filled = scenes.filter((s) => s.assetUrl).length;
  $('#scene-summary').textContent = `${filled} / ${scenes.length} scenes have assets`;

  const uploadText = $('#upload-progress-text');
  uploadText.hidden = uploadPct === null;
  if (uploadPct !== null) uploadText.textContent = `Đang upload ${uploadPct}%`;

  const skippedPanel = $('#skipped-panel');
  skippedPanel.hidden = skippedFiles.length === 0;
  if (skippedFiles.length > 0) {
    $('#skipped-summary').textContent = `Bỏ qua ${skippedFiles.length} file`;
    $('#skipped-list').innerHTML = skippedFiles.map((name) => `<li>${esc(name)}</li>`).join('');
  }

  document.querySelectorAll('.toolbar-row .btn, .studio-header .btn').forEach((el) => { el.disabled = busy !== null; });
  $('#gen-visual-prompts').disabled = busy !== null || scenes.length === 0 || jobActive;
  $('#render-project').disabled = busy !== null || missingSceneNumbers().length > 0;
}

function renderMedia() {
  $('#bgm-mood').value = PROJECT.bgmMood;
  $('#bgm-player').innerHTML = PROJECT.bgmUrl ? `<audio controls src="${PROJECT.bgmUrl}"></audio>` : '';

  document.querySelectorAll('#engine-selector .btn').forEach((btn) => {
    btn.className = `btn btn--sm ${btn.dataset.engine === PROJECT.renderEngine ? 'btn--indigoline is-on' : 'btn--ghost'}`;
    btn.setAttribute('aria-pressed', String(btn.dataset.engine === PROJECT.renderEngine));
  });

  const missing = missingSceneNumbers();
  const warn = $('#missing-warning');
  warn.hidden = missing.length === 0;
  if (missing.length > 0) warn.textContent = `Chưa sẵn sàng render: scene ${missing.join(', ')} thiếu asset.`;

  const renderPreview = $('#render-preview');
  renderPreview.hidden = !PROJECT.renderUrl;
  if (PROJECT.renderUrl) renderPreview.innerHTML = `<video class="render-player" controls src="${PROJECT.renderUrl}"></video>`;

  const jobPanel = $('#job-progress');
  jobPanel.hidden = !jobActive;
  if (jobActive) {
    $('#job-status').textContent = `Job ${jobProgress >= 100 ? 'done' : 'running'}`;
    $('#job-pct').textContent = `${Math.round(jobProgress)}%`;
    $('#job-bar > span').style.width = `${jobProgress}%`;
    $('#job-logs').innerHTML = jobLogs.map((l) => `<li>${esc(l)}</li>`).join('');
  }
}

function sceneCardHtml(scene, index) {
  const shortNarration = scene.narration.length > 80 ? `${scene.narration.slice(0, 80)}…` : scene.narration;
  const mismatch = scene.assetKind && (scene.assetKind === 'image' || scene.assetKind === 'video') && scene.assetKind !== scene.assetType;
  const sceneBusy = busy === `scene:${scene.id}`;

  // 4 mutually exclusive states, matching StudioPage.tsx's preview precedence:
  // 1) a live preview just generated via the "Preview" button (takes priority over the stored asset)
  // 2) a stored asset with a recognized type (image/video) — render it, plus a trailing mismatch note if needed
  // 3) a stored asset with an unrecognized mime type — "can't preview this file type"
  // 4) no asset at all — "No asset yet"
  let previewHtml;
  if (scene.livePreviewUrl) {
    previewHtml = `<video controls src="${scene.livePreviewUrl}"></video>`;
  } else if (scene.assetUrl && (scene.assetKind === 'image' || scene.assetKind === 'video')) {
    previewHtml = scene.assetKind === 'video'
      ? `<video controls src="${scene.assetUrl}"></video>`
      : `<img src="${scene.assetUrl}" alt="Asset scene ${index + 1}">`;
    if (mismatch) previewHtml += `<span class="mismatch">Asset ${scene.assetKind} không khớp loại scene ${scene.assetType}.</span>`;
  } else if (scene.assetUrl) {
    previewHtml = `<span class="placeholder">Không thể preview loại file này.</span>`;
  } else {
    previewHtml = `<span class="placeholder">No asset yet</span>`;
  }

  const promptHtml = scene.editing
    ? `<textarea class="textarea" data-role="prompt-input">${esc(scene.visualPrompt)}</textarea>
       <div class="editor-actions">
         <button type="button" class="btn btn--sm" data-action="cancel-prompt" data-id="${scene.id}">Cancel</button>
         <button type="button" class="btn btn--sm btn--amber" data-action="save-prompt" data-id="${scene.id}" ${sceneBusy ? 'disabled' : ''}>Save</button>
       </div>`
    : `<div class="prompt-line">
         <span class="${scene.visualPrompt ? '' : 'is-empty'}">${esc(scene.visualPrompt || 'Chưa có visual prompt.')}</span>
         <button type="button" class="btn btn--sm" data-action="edit-prompt" data-id="${scene.id}" ${busy ? 'disabled' : ''}>Edit</button>
       </div>`;

  return `
    <article class="scene-card" data-id="${scene.id}" data-editing="${scene.editing}">
      <div class="scene-card__head">
        <span class="scene-card__no">${String(index + 1).padStart(2, '0')}</span>
        <div class="scene-card__text">
          <strong>${esc(shortNarration)}</strong>
          <span class="mono muted small">${scene.durationSec}s</span>
        </div>
        <button type="button" class="btn btn--sm ${scene.assetType === 'video' ? 'btn--indigoline' : 'btn--ghost'}" data-action="toggle-type" data-id="${scene.id}" ${busy ? 'disabled' : ''}>
          ${scene.assetType}
        </button>
      </div>
      <div class="scene-card__body">
        <div class="prompt-block">
          <span class="label">Visual prompt</span>
          ${promptHtml}
        </div>
        <div class="scene-card__side">
          <div class="audio-block">
            <label class="label" for="sfx-${scene.id}">SFX prompt</label>
            <input class="input" id="sfx-${scene.id}" data-action="sfx-input" data-id="${scene.id}" value="${esc(scene.sfxPrompt)}" placeholder="Ví dụ: tiếng gió">
            <div class="row">
              <button type="button" class="btn btn--sm" data-action="gen-sfx" data-id="${scene.id}" ${busy ? 'disabled' : ''}>Tạo SFX</button>
              <button type="button" class="btn btn--sm" data-action="regen-voice" data-id="${scene.id}" ${busy ? 'disabled' : ''}>Tạo lại voiceover</button>
              <button type="button" class="btn btn--sm" data-action="preview-scene" data-id="${scene.id}" ${busy ? 'disabled' : ''}>Preview</button>
            </div>
            <div class="audio-players">
              ${scene.audioUrl ? `<audio controls src="${scene.audioUrl}"></audio>` : ''}
              ${scene.sfxUrl ? `<audio controls src="${scene.sfxUrl}"></audio>` : ''}
            </div>
          </div>
          <div class="media-preview">${previewHtml}</div>
        </div>
      </div>
    </article>`;
}

function renderScenes() {
  $('#scene-list').innerHTML = scenes.map((s, i) => sceneCardHtml(s, i)).join('');
}

function render() {
  renderHeader();
  renderOverview();
  renderMedia();
  renderScenes();
}

/* ---------- Sự kiện ---------- */

$('#copy-json').addEventListener('click', () => withBusy('copy', async () => {
  const json = await api.copyJson();
  await navigator.clipboard.writeText(json).catch(() => {});
  toast('Đã copy JSON.');
}));

$('#download-json').addEventListener('click', () => withBusy('download', async () => {
  const json = await api.exportJson();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'scenes-export.json'; link.click();
  URL.revokeObjectURL(url);
}));

$('#import-zip').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  withBusy('import', async () => {
    uploadPct = 0; render();
    const result = await api.importZip(file);
    skippedFiles = result.skipped;
    uploadPct = null;
    toast(`Đã import ${result.updated} scene${result.updated === 1 ? '' : 's'}.`);
  });
  event.target.value = '';
});

$('#set-all-image').addEventListener('click', () => withBusy('type', () => api.setAllAssetType('image')));
$('#set-all-video').addEventListener('click', () => withBusy('type', () => api.setAllAssetType('video')));

$('#gen-voiceover-all').addEventListener('click', () => withBusy('voiceover-all', async () => {
  await api.generateAllVoiceovers();
  toast('Đã xếp hàng tạo voiceover.');
}));

$('#gen-visual-prompts').addEventListener('click', () => withBusy('visual-prompts', async () => {
  await api.generateVisualPrompts();
  toast('Đã xếp hàng tạo visual prompt.');
}));

$('#render-project').addEventListener('click', () => withBusy('render', async () => {
  await api.renderProject();
  toast('Đã xếp hàng render.');
}));

$('#gen-bgm').addEventListener('click', () => withBusy('bgm', async () => {
  PROJECT.bgmMood = $('#bgm-mood').value;
  await api.generateBgm(PROJECT.bgmMood);
  toast('Đã tạo BGM.');
}));

$('#engine-selector').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-engine]');
  if (!btn || busy) return;
  PROJECT.renderEngine = btn.dataset.engine;
  toast(`Đã chọn engine ${btn.dataset.engine === 'ffmpeg' ? 'FFmpeg' : 'Remotion'}.`);
  render();
});

$('#scene-list').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const scene = byId(id);
  const action = btn.dataset.action;

  if (action === 'toggle-type') {
    return withBusy(`scene:${id}`, () => api.patchScene(id, { assetType: scene.assetType === 'image' ? 'video' : 'image' }));
  }
  if (action === 'edit-prompt') {
    draftPrompt = scene.visualPrompt;
    scenes = scenes.map((s) => (s.id === id ? { ...s, editing: true } : s));
    return render();
  }
  if (action === 'cancel-prompt') {
    scenes = scenes.map((s) => (s.id === id ? { ...s, editing: false } : s));
    return render();
  }
  if (action === 'save-prompt') {
    const card = btn.closest('.scene-card');
    const value = card.querySelector('[data-role="prompt-input"]').value;
    return withBusy(`scene:${id}`, async () => {
      await api.patchScene(id, { visualPrompt: value, editing: false });
      toast('Đã lưu visual prompt.');
    });
  }
  if (action === 'gen-sfx') return withBusy(`sfx:${id}`, async () => { await api.generateSfx(id); toast('Đã tạo SFX.'); });
  if (action === 'regen-voice') return withBusy(`voice:${id}`, async () => { await api.regenerateVoiceover(id); toast('Đã tạo lại voiceover.'); });
  if (action === 'preview-scene') return withBusy(`preview:${id}`, () => api.previewScene(id));
});

$('#scene-list').addEventListener('blur', (event) => {
  const input = event.target.closest('[data-action="sfx-input"]');
  if (!input) return;
  const id = input.dataset.id;
  const scene = byId(id);
  if (input.value !== scene.sfxPrompt) withBusy(`scene:${id}`, () => api.patchScene(id, { sfxPrompt: input.value }));
}, true);

render();
