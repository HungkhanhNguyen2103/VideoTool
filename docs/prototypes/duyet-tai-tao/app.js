'use strict';

/* ==========================================================================
   Video Tool — Duyệt & Tái Tạo
   Vanilla JS, không cần build. Dữ liệu và AI đều là giả lập.
   Khi nối backend thật, chỉ cần thay các hàm trong `api` bên dưới bằng fetch.
   ========================================================================== */

/* ---------- Hằng số ---------- */

const PROJECT_TITLE = 'Sự kiêu ngạo của Ô Mã Nhi và bản án tử hình cho 30 vạn quân Nguyên';

const STATUS = {
  approved: { label: 'Đã duyệt', cls: 'badge--green' },
  'needs-fix': { label: 'Cần sửa', cls: 'badge--amber' },
  generating: { label: 'Đang tạo lại', cls: 'badge--indigo' },
  pending: { label: 'Chưa duyệt', cls: 'badge--muted' },
};

const LEVELS = { light: 'Nhẹ', medium: 'Vừa', rewrite: 'Viết lại' };

/* ---------- Dữ liệu mẫu ---------- */

const chapters = [
  {
    id: 'c1', no: '01', title: 'Mở đầu', scenes: 6, seconds: 30, status: 'approved',
    paragraphs: [
      'Một đạo quân sử Việt chép khoảng ba mươi vạn người. Và nó bắt đầu thất bại vì thuyền lương bị bỏ lại phía sau.',
      '[Các đoạn tiếp theo của chương 1]',
    ],
  },
  { id: 'c2', no: '02', title: 'Bối cảnh', scenes: 8, seconds: 40, status: 'needs-fix', paragraphs: ['[Nội dung chương 2]'] },
  { id: 'c3', no: '03', title: 'Diễn biến', scenes: 9, seconds: 45, status: 'pending', paragraphs: ['[Nội dung chương 3]'] },
  { id: 'c4', no: '04', title: 'Bước ngoặt', scenes: 7, seconds: 35, status: 'pending', paragraphs: ['[Nội dung chương 4]'] },
  { id: 'c5', no: '05', title: 'Kết cục', scenes: 4, seconds: 20, status: 'pending', paragraphs: ['[Nội dung chương 5]'] },
].map((c) => ({
  ...c,
  selected: c.id === 'c2', // chương 2 được chọn sẵn
  expanded: c.id === 'c1', // chương 1 mở sẵn
  editing: false,
  progress: 0,
  prevStatus: null,
  controller: null,
}));

/* ---------- API giả lập (thay bằng fetch tới backend) ---------- */

const api = {
  /** Tạo lại nội dung một chương. Trả về mảng đoạn văn mới. */
  regenerateChapter(chapter, { instruction, level }, { onProgress, signal }) {
    return new Promise((resolve, reject) => {
      let pct = 0;
      const timer = setInterval(() => {
        pct += 8 + Math.random() * 10;
        onProgress(Math.min(pct, 100));
        if (pct >= 100) {
          clearInterval(timer);
          const paragraphs = [`[Nội dung chương ${chapter.no} do AI tạo lại (mô phỏng), mức "${LEVELS[level]}"]`];
          if (instruction) paragraphs.push(`[Theo yêu cầu: ${instruction}]`);
          resolve(paragraphs);
        }
      }, 250);
      signal.addEventListener('abort', () => {
        clearInterval(timer);
        reject(new DOMException('Đã hủy', 'AbortError'));
      });
    });
  },

  /** Chốt kịch bản để sang bước chia cảnh. */
  finalizeScript() {
    return Promise.resolve({ ok: true });
  },
};

/* ---------- Tiện ích ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const byId = (id) => chapters.find((c) => c.id === id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const els = {
  title: $('#project-title'),
  meta: $('#project-meta'),
  stepper: $('#stepper'),
  summary: $('#chapters-summary'),
  list: $('#chapter-list'),
  selectAll: $('#select-all'),
  approveAll: $('#approve-all'),
  regenAll: $('#regen-all'),
  instruction: $('#instruction'),
  selectedCount: $('#selected-count'),
  regenSelected: $('#regen-selected'),
  regenSelectedLabel: $('#regen-selected-label'),
  versions: $('#version-list'),
  approvedText: $('#approved-text'),
  approvedBar: $('#approved-bar'),
  finalizeHint: $('#finalize-hint'),
  finalize: $('#finalize'),
  back: $('#back-draft'),
  dialog: $('#confirm-dialog'),
  toast: $('#toast'),
};

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2800);
}

const currentLevel = () => document.querySelector('input[name="level"]:checked').value;

/* ---------- Phiên bản (lịch sử) ---------- */

const versions = [];
let currentVersionId = null;
let versionSeq = 0;

function snapshot() {
  return chapters.map((c) => ({
    id: c.id,
    status: c.status === 'generating' ? (c.prevStatus || 'pending') : c.status,
    paragraphs: [...c.paragraphs],
  }));
}

function pushVersion(note) {
  versionSeq += 1;
  const v = { id: versionSeq, note, at: new Date(), data: snapshot() };
  versions.unshift(v);
  currentVersionId = v.id;
  renderVersions();
}

function restoreVersion(id) {
  if (chapters.some((c) => c.status === 'generating')) {
    toast('Đang tạo lại, hãy đợi hoặc hủy trước khi khôi phục.');
    return;
  }
  const v = versions.find((x) => x.id === id);
  if (!v) return;
  v.data.forEach((s) => {
    const c = byId(s.id);
    c.paragraphs = [...s.paragraphs];
    c.status = s.status;
    c.editing = false;
  });
  currentVersionId = id;
  renderAll();
  toast(`Đã khôi phục Bản ${id}.`);
}

function renderVersions() {
  els.versions.innerHTML = versions
    .map((v) => {
      const time = v.at.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      const isCurrent = v.id === currentVersionId;
      const right = isCurrent
        ? '<span class="badge badge--green">Hiện tại</span>'
        : `<button type="button" class="btn btn--ghost btn--sm" data-restore="${v.id}">${icon('history')}Khôi phục</button>`;
      return `<li class="version">
        <div><span class="version__name">Bản ${v.id}</span>
        <span class="version__note">${esc(v.note)} · ${time}</span></div>${right}</li>`;
    })
    .join('');
}

/* ---------- Render: chương ---------- */

function cardHTML(c) {
  const st = STATUS[c.status];
  const busy = c.status === 'generating';
  const approved = c.status === 'approved';
  const flagged = c.status === 'needs-fix';

  const actions = busy
    ? '<button type="button" class="btn btn--red" data-action="cancel">Hủy</button>'
    : `<button type="button" class="btn btn--icon ${flagged ? 'is-on' : ''}" data-action="flag"
         aria-pressed="${flagged}" aria-label="Đánh dấu cần sửa chương ${c.no}" title="Đánh dấu cần sửa">${icon('flag')}</button>
       <button type="button" class="btn btn--ghost" data-action="edit">${icon('edit')}Sửa</button>
       <button type="button" class="btn btn--indigoline" data-action="regen">${icon('refresh')}Tái tạo</button>
       <button type="button" class="btn ${approved ? 'btn--green' : 'btn--ghost'}" data-action="approve"
         aria-pressed="${approved}">${icon('check')}${approved ? 'Đã duyệt' : 'Duyệt'}</button>`;

  let body;
  if (c.editing) {
    body = `<label class="sr-only" for="edit-${c.id}">Nội dung chương ${c.no}</label>
      <textarea class="textarea" id="edit-${c.id}">${esc(c.paragraphs.join('\n\n'))}</textarea>
      <div class="editor-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-action="edit-cancel">Hủy</button>
        <button type="button" class="btn btn--amber btn--sm" data-action="edit-save">${icon('save')}Lưu</button>
      </div>`;
  } else {
    body = c.paragraphs
      .map((p) => `<p${/^\[.*\]$/.test(p) ? ' class="placeholder"' : ''}>${esc(p)}</p>`)
      .join('');
  }

  const progress = busy
    ? `<div class="progress">
         <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(c.progress)}"
           aria-label="Tiến độ tạo lại chương ${c.no}"><span style="width:${c.progress}%"></span></div>
         <span class="progress__text">Đang viết lại chương…</span>
       </div>`
    : '';

  return `<article class="chapter" data-id="${c.id}" data-selected="${c.selected}">
    <div class="chapter__top">
      <input type="checkbox" data-select aria-label="Chọn chương ${c.no}" ${c.selected ? 'checked' : ''}>
      <button type="button" class="chapter__toggle" aria-expanded="${c.expanded}" aria-controls="body-${c.id}">
        <span class="chapter__no">${c.no}</span>
        <span class="chapter__title">${esc(c.title)}</span>
        <span class="chapter__meta">${c.scenes} cảnh • ${c.seconds}s</span>
        <svg class="ic chapter__chevron" aria-hidden="true"><use href="#i-chevron"/></svg>
      </button>
      <span class="badge ${st.cls}">${st.label}</span>
      <div class="spacer"></div>
      <div class="chapter__actions">${actions}</div>
    </div>
    ${progress}
    <div class="chapter__body" id="body-${c.id}" ${c.expanded || c.editing ? '' : 'hidden'}>${body}</div>
  </article>`;
}

function renderList() {
  els.list.innerHTML = chapters.map(cardHTML).join('');
}

/** Vẽ lại một thẻ chương, giữ focus vào phần tử `focusSel` nếu có. */
function rerenderCard(c, focusSel) {
  const old = els.list.querySelector(`[data-id="${c.id}"]`);
  if (!old) return;
  old.outerHTML = cardHTML(c);
  if (focusSel) {
    const fresh = els.list.querySelector(`[data-id="${c.id}"] ${focusSel}`);
    if (fresh) fresh.focus();
  }
}

function setProgress(c, pct) {
  c.progress = pct;
  const card = els.list.querySelector(`[data-id="${c.id}"]`);
  if (!card) return;
  const bar = card.querySelector('.bar');
  if (!bar) return;
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  bar.firstElementChild.style.width = `${pct}%`;
}

/* ---------- Render: tổng hợp (stepper, thanh chốt, panel bên phải) ---------- */

function renderStepper(approvedCount, allApproved) {
  const steps = [
    { label: 'Dàn ý', sub: 'Hoàn tất', state: 'done' },
    { label: 'Nháp kịch bản', sub: 'Hoàn tất', state: 'done' },
    {
      label: 'Duyệt & tái tạo',
      sub: allApproved ? 'Hoàn tất' : `Đã duyệt ${approvedCount}/${chapters.length}`,
      state: allApproved ? 'done' : 'active',
    },
    { label: 'Chốt & chia cảnh', sub: allApproved ? 'Sẵn sàng' : 'Chưa bắt đầu', state: allApproved ? 'active' : 'todo' },
  ];
  els.stepper.innerHTML = steps
    .map((s, i) => {
      const dot = s.state === 'done' ? icon('check') : String(i + 1);
      const cur = s.state === 'active' ? ' aria-current="step"' : '';
      const line = i < steps.length - 1
        ? `<li class="step__line ${s.state === 'done' ? 'is-done' : ''}" aria-hidden="true"></li>`
        : '';
      return `<li class="step is-${s.state}"${cur}>
        <span class="step__dot">${dot}</span>
        <div><div class="step__label">${esc(s.label)}</div><div class="step__sub">${esc(s.sub)}</div></div>
      </li>${line}`;
    })
    .join('');
}

function updateSummary() {
  const total = chapters.length;
  const approvedCount = chapters.filter((c) => c.status === 'approved').length;
  const anyBusy = chapters.some((c) => c.status === 'generating');
  const allApproved = approvedCount === total;
  const totalScenes = chapters.reduce((n, c) => n + c.scenes, 0);
  const totalSeconds = chapters.reduce((n, c) => n + c.seconds, 0);

  els.meta.textContent = `${totalScenes} cảnh • ${totalSeconds}s`;
  els.summary.textContent = `${total} chương • ${totalScenes} cảnh • ${totalSeconds}s`;

  renderStepper(approvedCount, allApproved);

  // Thanh chốt
  const pct = Math.round((approvedCount / total) * 100);
  els.approvedText.textContent = `Đã duyệt ${approvedCount}/${total} chương`;
  els.approvedBar.setAttribute('aria-valuenow', String(pct));
  els.approvedBar.firstElementChild.style.width = `${pct}%`;
  els.finalize.disabled = !allApproved || anyBusy;
  els.finalizeHint.textContent = anyBusy
    ? 'Đang tạo lại, hãy đợi hoàn tất.'
    : allApproved ? '' : `Cần duyệt nốt ${total - approvedCount} chương để chốt.`;

  // Chọn tất cả
  const selected = chapters.filter((c) => c.selected);
  els.selectAll.checked = selected.length === total;
  els.selectAll.indeterminate = selected.length > 0 && selected.length < total;

  // Panel yêu cầu tái tạo
  const eligible = selected.filter((c) => c.status !== 'generating');
  els.selectedCount.textContent = selected.length
    ? `Áp dụng cho ${selected.length} chương đã chọn`
    : 'Chưa chọn chương nào';
  els.regenSelected.disabled = eligible.length === 0;
  els.regenSelectedLabel.textContent = eligible.length
    ? `Tái tạo ${eligible.length} chương đã chọn`
    : 'Tái tạo chương đã chọn';

  els.approveAll.disabled = allApproved || anyBusy;
  els.regenAll.disabled = anyBusy;
}

function renderAll() {
  renderList();
  renderVersions();
  updateSummary();
}

/* ---------- Hành động ---------- */

async function regenerate(ids, opts) {
  const jobs = ids.map((id) => {
    const c = byId(id);
    c.prevStatus = c.status;
    c.status = 'generating';
    c.progress = 0;
    c.editing = false;
    c.controller = new AbortController();
    rerenderCard(c);

    return api
      .regenerateChapter(c, opts, { signal: c.controller.signal, onProgress: (p) => setProgress(c, p) })
      .then((paragraphs) => {
        c.paragraphs = paragraphs;
        c.status = 'pending'; // nội dung mới phải được duyệt lại
        c.controller = null;
        rerenderCard(c);
        updateSummary();
        return c;
      })
      .catch((err) => {
        if (err.name !== 'AbortError') throw err;
        c.status = c.prevStatus || 'pending';
        c.controller = null;
        rerenderCard(c);
        updateSummary();
        return null;
      });
  });
  updateSummary();

  const results = await Promise.allSettled(jobs);
  const done = results.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
  if (done.length) {
    pushVersion(`Tái tạo chương ${done.map((c) => c.no).join(', ')} (mức ${LEVELS[opts.level]})`);
    toast(`Đã tạo lại ${done.length} chương. Hãy duyệt lại nội dung mới.`);
  }
  updateSummary();
}

function regenOptions() {
  return { instruction: els.instruction.value.trim(), level: currentLevel() };
}

function saveEdit(c) {
  const ta = $(`#edit-${c.id}`);
  const paragraphs = ta.value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) {
    toast('Nội dung chương không được để trống.');
    ta.focus();
    return;
  }
  const changed = paragraphs.join('\n\n') !== c.paragraphs.join('\n\n');
  c.editing = false;
  if (changed) {
    c.paragraphs = paragraphs;
    c.status = 'pending';
    pushVersion(`Sửa tay chương ${c.no}`);
    toast(`Đã lưu chương ${c.no}. Hãy duyệt lại.`);
  }
  rerenderCard(c, '[data-action="edit"]');
  updateSummary();
}

/* ---------- Sự kiện ---------- */

els.list.addEventListener('click', (e) => {
  const card = e.target.closest('.chapter');
  if (!card) return;
  const c = byId(card.dataset.id);

  if (e.target.closest('.chapter__toggle')) {
    c.expanded = !c.expanded;
    rerenderCard(c, '.chapter__toggle');
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  switch (btn.dataset.action) {
    case 'flag':
      c.status = c.status === 'needs-fix' ? 'pending' : 'needs-fix';
      rerenderCard(c, '[data-action="flag"]');
      break;
    case 'approve':
      c.status = c.status === 'approved' ? 'pending' : 'approved';
      rerenderCard(c, '[data-action="approve"]');
      break;
    case 'edit':
      c.editing = true;
      c.expanded = true;
      rerenderCard(c, 'textarea');
      break;
    case 'edit-cancel':
      c.editing = false;
      rerenderCard(c, '[data-action="edit"]');
      break;
    case 'edit-save':
      saveEdit(c);
      return; // saveEdit tự cập nhật
    case 'regen':
      regenerate([c.id], regenOptions());
      return;
    case 'cancel':
      if (c.controller) c.controller.abort();
      return;
    default:
      return;
  }
  updateSummary();
});

els.list.addEventListener('change', (e) => {
  if (!e.target.matches('[data-select]')) return;
  const card = e.target.closest('.chapter');
  const c = byId(card.dataset.id);
  c.selected = e.target.checked;
  card.dataset.selected = String(c.selected);
  updateSummary();
});

els.selectAll.addEventListener('change', () => {
  chapters.forEach((c) => { c.selected = els.selectAll.checked; });
  renderList();
  updateSummary();
});

els.approveAll.addEventListener('click', () => {
  chapters.forEach((c) => { if (c.status !== 'generating') c.status = 'approved'; });
  renderList();
  updateSummary();
  toast('Đã duyệt tất cả chương.');
});

els.regenSelected.addEventListener('click', () => {
  const ids = chapters.filter((c) => c.selected && c.status !== 'generating').map((c) => c.id);
  if (ids.length) regenerate(ids, regenOptions());
});

els.regenAll.addEventListener('click', () => {
  els.dialog.showModal();
});

els.dialog.addEventListener('close', () => {
  if (els.dialog.returnValue === 'ok') {
    regenerate(chapters.map((c) => c.id), regenOptions());
  }
});

els.versions.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-restore]');
  if (btn) restoreVersion(Number(btn.dataset.restore));
});

els.finalize.addEventListener('click', async () => {
  els.finalize.disabled = true;
  await api.finalizeScript();
  toast('Đã chốt kịch bản. Bước tiếp theo: Studio Phân Cảnh & Xuất Video.');
  els.finalize.disabled = false;
  // Backend thật: điều hướng sang tab 3 tại đây.
});

els.back.addEventListener('click', () => toast('Bước "Nháp kịch bản" chưa dựng trong bản demo.'));

document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    toast(`Tab "${tab.dataset.tab}" chưa dựng trong bản demo.`);
  });
});

/* ---------- Khởi động ---------- */

els.title.textContent = PROJECT_TITLE;
pushVersion('Nháp ban đầu');
renderAll();
