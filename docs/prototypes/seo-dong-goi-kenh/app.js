'use strict';

/* Prototype only: state and AI responses are simulated in the browser. */

const PROJECT = {
  title: 'Điện Biên Phủ 1954 — Trận quyết định làm rung chuyển thế giới',
  brief: 'Video lịch sử tài liệu về chiến dịch Điện Biên Phủ và bước ngoặt năm 1954.',
  language: 'vi',
  coreQuestion: 'Vì sao một cứ điểm được xem là bất khả xâm phạm lại sụp đổ?',
  openingHook: 'Một thung lũng xa xôi đã làm thay đổi cán cân của cả cuộc chiến.',
  motif: 'kẻ đi săn kiêu ngạo tự sập bẫy',
  renderUrl: '#video-rendered',
};

const TITLES = [
  { id: 'title-1', angle: 'number', text: 'Điện Biên Phủ 1954: 56 ngày làm rung chuyển thế giới' },
  { id: 'title-2', angle: 'curiosity', text: 'Vì sao “pháo đài bất khả xâm phạm” lại sụp đổ ở Điện Biên Phủ?' },
  { id: 'title-3', angle: 'stakes', text: 'Trận Điện Biên Phủ đã định đoạt số phận một cuộc chiến như thế nào?' },
  { id: 'title-4', angle: 'question', text: 'Điều gì thực sự xảy ra trong lòng chảo Điện Biên Phủ năm 1954?' },
  { id: 'title-5', angle: 'contrarian', text: 'Điện Biên Phủ không chỉ là một chiến thắng: đây là cái bẫy đã khép lại' },
];

const THUMBNAILS = [
  { id: 'thumb-1', overlayText: '56 NGÀY', concept: 'Bản đồ lòng chảo với các đường pháo hội tụ vào cứ điểm.', imagePrompt: 'Dramatic top-down 1954 Indochina valley map, artillery trails converging, warm amber highlights, documentary thumbnail composition, no text.', visual: '56 NGÀY' },
  { id: 'thumb-2', overlayText: 'CỨ ĐIỂM SỤP ĐỔ', concept: 'Hầm chỉ huy bị bao quanh, tương phản giữa bóng tối và ánh sáng.', imagePrompt: 'Cinematic documentary thumbnail, fortified command bunker surrounded by mist and soldiers silhouettes, high contrast blue and amber lighting, no text.', visual: 'SỤP ĐỔ' },
  { id: 'thumb-3', overlayText: 'CÁI BẪY KHÉP LẠI', concept: 'Hai đường nét bản đồ khép thành hình vòng vây trên thung lũng.', imagePrompt: 'Historical aerial view of Dien Bien Phu valley with a closing encirclement motif, paper map texture, restrained red accent, no text.', visual: 'CÁI BẪY' },
];

const requestedView = new URLSearchParams(window.location.search).get('state');
const state = {
  mode: requestedView === 'manual' ? 'manual' : 'auto',
  provider: 'deepseek',
  view: ['result', 'empty', 'generating', 'manual', 'error'].includes(requestedView) ? requestedView : 'result',
  chosenTitleId: 'title-1',
  intro: 'Năm 1954, tại thung lũng lòng chảo Điện Biên Phủ, một cứ điểm được xem là bất khả xâm phạm đã trở thành nơi định đoạt số phận của cả một cuộc chiến.',
  tags: ['Điện Biên Phủ', 'lịch sử Việt Nam', 'Chiến tranh Đông Dương', 'lịch sử quân sự', 'năm 1954'],
  hashtags: ['#DienBienPhu', '#LichSuVietNam', '#LichSuTheGioi', '#1954'],
  chosenThumbId: 'thumb-1',
  hasThumbnail: false,
  progress: requestedView === 'generating' ? 42 : 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

let toastTimer = null;
let generationTimer = null;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-visible'), 2500);
}

function chosenTitle() { return TITLES.find((title) => title.id === state.chosenTitleId) || TITLES[0]; }
function chosenThumbnail() { return THUMBNAILS.find((idea) => idea.id === state.chosenThumbId) || THUMBNAILS[0]; }
function tagLength() { return state.tags.join(', ').length; }
function normalizeHashtag(value) {
  const compact = value.trim().replace(/\s+/g, '');
  if (!compact) return '';
  return compact.startsWith('#') ? compact : `#${compact}`;
}

function chapterBlock() {
  return 'Mốc chương chưa hiển thị: dự án mẫu chưa đủ điều kiện YouTube (cần ít nhất 3 chương, mỗi chương từ 10 giây).';
}

function fullDescription() {
  const hashtags = state.hashtags.slice(0, 15).join(' ');
  return `${state.intro.trim()}\n\n${chapterBlock()}\n\n${hashtags}`;
}

function renderMode() {
  $$('[data-mode]').forEach((button) => button.classList.toggle('is-on', button.dataset.mode === state.mode));
  $('#provider-field').hidden = state.mode !== 'auto';
  $('#provider').value = state.provider;
  $('#state-select').value = state.view;
  $('#generate-all').disabled = state.view === 'generating';
}

function renderTitles() {
  const selected = chosenTitle();
  $('#chosen-title').value = selected.text;
  const count = selected.text.length;
  $('#title-count').textContent = `${count}/100`;
  $('#title-track').style.width = `${Math.min(count, 100)}%`;
  $('#title-track').style.background = count > 70 ? 'var(--amber)' : 'var(--indigo)';
  $('#title-options').innerHTML = TITLES.map((title) => {
    const length = title.text.length;
    return `<button class="title-option ${title.id === state.chosenTitleId ? 'is-selected' : ''}" type="button" data-title-id="${title.id}">
      <span class="title-option__head"><span class="angle">${esc(title.angle)}</span>${title.id === state.chosenTitleId ? `<span class="badge badge--amber">Đang chọn</span>` : ''}</span>
      <span class="title-option__text">${esc(title.text)}</span>
      <span class="title-option__count ${length > 70 ? 'warn' : ''}">${length}/100${length > 70 ? ' · nên rút gọn' : ''}</span>
    </button>`;
  }).join('');
}

function renderDescription() {
  const count = state.intro.length;
  $('#description-intro').value = state.intro;
  $('#description-count').textContent = `${count}/5000`;
  $('#description-preview').textContent = fullDescription();
}

function renderChips() {
  $('#tag-chips').innerHTML = state.tags.map((tag, index) => `<span class="chip-item">${esc(tag)}<button type="button" aria-label="Xoá tag ${esc(tag)}" data-remove-tag="${index}">×</button></span>`).join('');
  $('#hashtag-chips').innerHTML = state.hashtags.map((tag, index) => `<span class="chip-item chip-item--hashtag ${index < 3 ? 'is-top' : ''}">${esc(tag)}${index < 3 ? '<small>hiện</small>' : ''}<button type="button" aria-label="Xoá hashtag ${esc(tag)}" data-remove-hashtag="${index}">×</button></span>`).join('');
  const length = tagLength();
  $('#tag-budget').textContent = `${length}/500 ký tự`;
  $('#tag-budget').classList.toggle('is-near', length > 440);
}

function renderThumbnail() {
  $('#thumbnail-ideas').innerHTML = THUMBNAILS.map((idea) => `<button class="thumbnail-idea ${idea.id === state.chosenThumbId ? 'is-selected' : ''}" type="button" data-thumb-id="${idea.id}">
    <span class="thumbnail-idea__visual">${esc(idea.visual)}</span><span class="thumbnail-idea__text">${esc(idea.overlayText)}</span><span class="thumbnail-idea__concept">${esc(idea.concept)}</span><span class="thumbnail-idea__prompt">${esc(idea.imagePrompt)}</span><span class="thumbnail-idea__copy" data-copy-prompt="${idea.id}">${icon('copy')} Sao chép prompt</span>
  </button>`).join('');
}

function renderChecklist() {
  const items = [
    ['title', 'Đã chọn tiêu đề', state.chosenTitleId !== null, `${chosenTitle().text.length}/100 ký tự`],
    ['description', 'Đã có mô tả', Boolean(state.intro.trim()), `${state.intro.length}/5000 ký tự`],
    ['tags', 'Tags trong ngân sách', tagLength() <= 500, `${tagLength()}/500 ký tự`],
    ['hashtag', 'Có hashtag', state.hashtags.length > 0, `${state.hashtags.length} hashtag`],
    ['comment', 'Đã có bình luận ghim', Boolean($('#pinned-comment').value.trim()), 'Sẵn sàng sao chép'],
    ['thumbnail', 'Đã upload thumbnail', state.hasThumbnail, state.hasThumbnail ? 'Ảnh hợp lệ' : 'Chưa có ảnh cuối'],
    ['video', 'Video đã render', true, '1280×720 · 18:42'],
  ];
  const done = items.filter((item) => item[2]).length;
  $('#ready-count').textContent = `${done}/${items.length}`;
  $('#checklist').innerHTML = items.map(([, label, isDone, note]) => `<li class="${isDone ? 'is-done' : ''}"><span class="check">${isDone ? icon('check') : '·'}</span><span>${label}<small>${esc(note)}</small></span></li>`).join('');
}

function renderView() {
  const isEmpty = state.view === 'empty';
  const isManual = state.view === 'manual';
  const isGenerating = state.view === 'generating';
  $('#empty-state').hidden = !isEmpty;
  $('#workspace').hidden = isEmpty;
  $('#manual-panel').hidden = !isManual;
  $('#fact-alert').hidden = isEmpty;
  $('#error-banner').hidden = state.view !== 'error';
  $('#job-strip').hidden = !isGenerating;
  if (isGenerating) {
    $('#job-pct').textContent = `${Math.round(state.progress)}%`;
    $('#job-bar').setAttribute('aria-valuenow', String(Math.round(state.progress)));
    $('#job-bar > span').style.width = `${state.progress}%`;
  }
}

function render() {
  renderMode();
  renderTitles();
  renderDescription();
  renderChips();
  renderThumbnail();
  renderChecklist();
  renderView();
}

function setView(view) {
  clearInterval(generationTimer);
  state.view = view;
  state.progress = view === 'generating' ? 8 : 0;
  render();
  if (view === 'generating') {
    generationTimer = setInterval(() => {
      state.progress = Math.min(state.progress + 17, 100);
      render();
      if (state.progress >= 100) {
        clearInterval(generationTimer);
        state.view = 'result';
        render();
        toast('Đã tạo xong gói SEO mẫu.');
      }
    }, 380);
  }
}

async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); } catch { /* Prototype fallback: the toast still confirms the action. */ }
  toast(message);
}

function packageMarkdown() {
  return `# ${chosenTitle().text}\n\n## Mô tả\n\n${fullDescription()}\n\n## Tags\n\n${state.tags.join(', ')}\n\n## Hashtag\n\n${state.hashtags.join(' ')}\n\n## Bình luận ghim\n\n${$('#pinned-comment').value}\n\n## Thumbnail\n\n**${chosenThumbnail().overlayText}**\n\n${chosenThumbnail().concept}\n\nPrompt ảnh: ${chosenThumbnail().imagePrompt}\n\n---\nTạo từ prototype ngày ${new Date().toLocaleDateString('vi-VN')}`;
}

function downloadMarkdown() {
  const slug = chosenTitle().text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const url = URL.createObjectURL(new Blob([packageMarkdown()], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug || 'goi-dang-youtube'}.md`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Đã tải gói đăng Markdown.');
}

function importManualJson() {
  const raw = $('#manual-json').value;
  const error = $('#manual-error');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.titles) || parsed.titles.length === 0) throw new Error('thiếu trường titles');
    error.hidden = true;
    state.view = 'result';
    state.mode = 'manual';
    toast('Đã nhập gói SEO thủ công.');
  } catch (caught) {
    error.hidden = false;
    error.textContent = `JSON của gói SEO không hợp lệ. ${caught instanceof Error ? caught.message : 'Kiểm tra lại nội dung đã dán.'}`;
  }
  render();
}

function validateThumbnail(file) {
  const error = $('#thumbnail-error');
  const name = $('#thumbnail-file-name');
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    error.hidden = false; error.textContent = 'Chỉ nhận ảnh JPG hoặc PNG.'; state.hasThumbnail = false; renderChecklist(); return;
  }
  if (file.size > 2 * 1024 * 1024) {
    error.hidden = false; error.textContent = 'Thumbnail không được vượt quá 2 MB.'; state.hasThumbnail = false; renderChecklist(); return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (image.width < 640 || Math.abs(image.width / image.height - 16 / 9) > .04) {
      error.hidden = false; error.textContent = 'Thumbnail nên là tỉ lệ 16:9 và rộng tối thiểu 640 px.'; state.hasThumbnail = false;
      URL.revokeObjectURL(url); renderChecklist(); return;
    }
    error.hidden = true;
    state.hasThumbnail = true;
    name.textContent = `${file.name} · ${image.width}×${image.height}`;
    $('#upload-preview').innerHTML = `<img src="${url}" alt="Thumbnail đã chọn">`;
    renderChecklist();
    toast('Thumbnail hợp lệ.');
  };
  image.onerror = () => { error.hidden = false; error.textContent = 'Không đọc được ảnh thumbnail.'; URL.revokeObjectURL(url); };
  image.src = url;
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, a, [data-copy-prompt]');
  if (!target) return;
  if (target.matches('a[href="#"]')) event.preventDefault();

  if (target.dataset.mode) { state.mode = target.dataset.mode; if (state.mode === 'manual') state.view = 'manual'; render(); return; }
  if (target.id === 'generate-all' || target.dataset.action === 'empty-generate' || target.dataset.retry) { setView('generating'); return; }
  if (target.dataset.titleId) { state.chosenTitleId = target.dataset.titleId; render(); return; }
  if (target.dataset.thumbId && !target.dataset.copyPrompt) { state.chosenThumbId = target.dataset.thumbId; render(); return; }
  if (target.dataset.copyPrompt) { const idea = THUMBNAILS.find((item) => item.id === target.dataset.copyPrompt); if (idea) void copyText(idea.imagePrompt, 'Đã sao chép prompt ảnh thumbnail.'); return; }
  if (target.dataset.removeTag !== undefined) { state.tags.splice(Number(target.dataset.removeTag), 1); render(); return; }
  if (target.dataset.removeHashtag !== undefined) { state.hashtags.splice(Number(target.dataset.removeHashtag), 1); render(); return; }
  if (target.id === 'add-tag') { const input = $('#tag-input'); if (input.value.trim()) { state.tags.push(input.value.trim()); input.value = ''; render(); } return; }
  if (target.id === 'add-hashtag') { const input = $('#hashtag-input'); const value = normalizeHashtag(input.value); if (value) { state.hashtags.push(value); input.value = ''; render(); } return; }
  if (target.dataset.regenerate) { toast(`Đã xếp hàng tạo lại phần ${target.dataset.regenerate}.`); return; }
  if (target.id === 'copy-description') { void copyText(fullDescription(), 'Đã sao chép mô tả đầy đủ.'); return; }
  if (target.id === 'copy-comment') { void copyText($('#pinned-comment').value, 'Đã sao chép bình luận ghim.'); return; }
  if (target.id === 'copy-prompt') { void copyText('SYSTEM\nBạn là biên tập viên SEO cho kênh lịch sử Việt Nam.\n\nUSER\nTạo gói SEO trung thực cho video Điện Biên Phủ 1954.', 'Đã sao chép prompt SEO.'); return; }
  if (target.id === 'manual-import') { importManualJson(); return; }
  if (target.id === 'copy-all') { void copyText(packageMarkdown(), 'Đã sao chép toàn bộ gói đăng.'); return; }
  if (target.id === 'download-package') { downloadMarkdown(); }
});

$('#provider').addEventListener('change', (event) => { state.provider = event.target.value; toast(`Đã chọn ${state.provider === 'deepseek' ? 'DeepSeek' : 'Claude'}.`); });
$('#state-select').addEventListener('change', (event) => { setView(event.target.value); if (event.target.value === 'manual') state.mode = 'manual'; render(); });
$('#chosen-title').addEventListener('input', (event) => {
  const value = event.target.value;
  const selected = chosenTitle();
  selected.text = value;
  renderTitles();
  renderChecklist();
});
$('#description-intro').addEventListener('input', (event) => { state.intro = event.target.value; renderDescription(); renderChecklist(); });
$('#tag-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('#add-tag').click(); } });
$('#hashtag-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('#add-hashtag').click(); } });
$('#pinned-comment').addEventListener('input', renderChecklist);
$('#thumbnail-file').addEventListener('change', (event) => { validateThumbnail(event.target.files?.[0]); event.target.value = ''; });

render();
