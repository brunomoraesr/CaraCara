const params = new URLSearchParams(location.search);
const BOARD_ID_PARAM = params.get('id');

let currentUser       = null;
let boardId           = BOARD_ID_PARAM || null;
// chars[pos] = { name, photo_url, photo_preview, _pendingFile }
// photo_preview: blob URL para exibição imediata (antes do upload)
// photo_url:     URL permanente do Supabase Storage (após upload)
// _pendingFile:  File aguardando upload no saveBoard
let chars                = {};
let customQuestions      = [];
let useDefaultQuestions  = true;
let editingPos           = null;
let photoFile       = null;       // File já recortado (pronto para upload)
let photoPreviewUrl = null;       // Blob URL para preview imediato no modal e no grid
let rawPhotoFile    = null;       // Arquivo original antes do crop (para recortar novamente)
let cropperInstance = null;

// ---- Init ----

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const profile = await getProfile(currentUser.id);
  document.getElementById('nav-username').textContent = profile?.username || currentUser.email;

  if (boardId) await loadBoard();
  renderGrid();
}

async function loadBoard() {
  const { data: board } = await sb.from('boards').select('*').eq('id', boardId).single();
  if (!board || board.user_id !== currentUser.id) {
    showToast('Tabuleiro não encontrado', 'error');
    location.href = 'dashboard.html';
    return;
  }
  document.getElementById('board-name').value = board.name;
  const shareCard  = document.getElementById('share-board-card');
  const importCard = document.getElementById('import-board-card');
  if (shareCard)  { shareCard.hidden  = false; document.getElementById('share-board-id').value = boardId; }
  if (importCard) { importCard.hidden = true; }
  customQuestions     = board.custom_questions || [];
  useDefaultQuestions = board.use_default_questions ?? true;
  const toggle = document.getElementById('use-default-questions');
  if (toggle) toggle.checked = useDefaultQuestions;
  updateDefaultToggleLabel();
  renderQuestionsList();

  const { data: charList } = await sb.from('characters').select('*').eq('board_id', boardId);
  (charList || []).forEach(c => {
    chars[c.position] = { name: c.name, photo_url: c.photo_url, photo_preview: null };
  });
  renderGrid();
}

// ---- Grid ----

function renderGrid() {
  const grid = document.getElementById('char-grid');
  grid.innerHTML = '';
  let count = 0;

  for (let pos = 1; pos <= 24; pos++) {
    const c = chars[pos];
    if (c) count++;

    const slot = document.createElement('div');
    slot.className = `char-slot ${c ? 'filled' : ''}`;
    slot.onclick = () => openModal(pos);

    if (c) {
      // Prioridade: preview local (blob) > URL salva no storage
      const photoSrc = c.photo_preview || c.photo_url;
      slot.innerHTML = `
        <div class="slot-edit-icon">✏️</div>
        ${photoSrc
          ? `<img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(c.name)}">`
          : `<div class="slot-initials" style="background:${posColor(pos)}">${nameInitials(c.name)}</div>`
        }
        <div class="slot-name">${escapeHtml(c.name)}</div>`;
    } else {
      slot.innerHTML = `
        <div class="slot-add">＋</div>
        <div class="slot-name" style="color:var(--muted)">${pos}</div>`;
    }
    grid.appendChild(slot);
  }
  document.getElementById('char-count').textContent = `${count} / 24`;
}

// ---- Modal ----

function openModal(pos) {
  editingPos      = pos;
  photoFile       = null;
  photoPreviewUrl = null;
  rawPhotoFile    = null;
  const c         = chars[pos];

  document.getElementById('modal-title').textContent = `Personagem ${pos}`;
  document.getElementById('char-name-input').value   = c?.name || '';
  document.getElementById('remove-btn').hidden        = !c;
  document.getElementById('photo-input').value        = '';

  const preview   = document.getElementById('photo-preview-area');
  const existSrc  = c?.photo_preview || c?.photo_url;
  const recropBtn = document.getElementById('recrop-btn');

  if (existSrc) {
    preview.innerHTML = `<img src="${escapeHtml(existSrc)}" style="width:100%;height:100%;object-fit:contain;background:#000;">`;
    recropBtn.hidden  = false;
    recropBtn.textContent = '✂️ Trocar/Recortar';
  } else {
    preview.innerHTML = `<div class="photo-placeholder"><span>📷</span>Clique para adicionar foto</div>`;
    recropBtn.hidden  = true;
  }

  document.getElementById('char-modal').hidden = false;
}

function closeModal() {
  document.getElementById('char-modal').hidden = true;
  document.getElementById('photo-input').value = '';
  photoFile       = null;
  photoPreviewUrl = null;
  rawPhotoFile    = null;
  editingPos      = null;
}

// ---- Photo / Crop ----

function onPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { showToast('Foto muito grande (máx 15MB)', 'error'); return; }
  rawPhotoFile = file;
  openCropper(file);
}

function reOpenCropper() {
  // Se já tem arquivo original carregado: reabre o crop com ele
  if (rawPhotoFile) {
    openCropper(rawPhotoFile);
  } else {
    // Caso contrário: abre o seletor de arquivo para trocar a foto
    document.getElementById('photo-input').click();
  }
}

function openCropper(file) {
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }

  const img = document.getElementById('crop-img');
  img.src   = '';                                      // limpa src anterior
  document.getElementById('crop-modal').hidden = false;

  const objectUrl = URL.createObjectURL(file);
  img.onload = () => {
    try {
      cropperInstance = new Cropper(img, {
        aspectRatio:  3 / 4,
        viewMode:     1,
        autoCropArea: 0.85,
        movable:      true,
        zoomable:     true,
        rotatable:    true,
        scalable:     true,
        guides:       true,
        highlight:    false,
        background:   true,
        responsive:   true,
        ready() {
          // Garante que o crop box esteja visível ao iniciar
          this.cropper.setCropBoxData({ left: 20, top: 20 });
        },
      });
    } catch (e) {
      showToast('Erro ao carregar o editor de imagem', 'error');
      console.error(e);
      document.getElementById('crop-modal').hidden = true;
    }
  };
  img.src = objectUrl;
}

function cancelCrop() {
  document.getElementById('crop-modal').hidden = true;
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  // Não limpamos photoFile/photoPreviewUrl para não perder um crop anterior
  if (!photoFile && !chars[editingPos]?.photo_url) {
    document.getElementById('photo-input').value = '';
  }
}

function confirmCrop() {
  if (!cropperInstance) return;

  const btn = document.querySelector('#crop-modal .btn-primary');
  btn.disabled = true; btn.textContent = 'Processando...';

  let canvas;
  try {
    canvas = cropperInstance.getCroppedCanvas({
      width:                 480,
      height:                640,
      fillColor:             '#ffffff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
  } catch (e) {
    showToast('Erro ao processar imagem: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '✅ Usar esta área';
    return;
  }

  canvas.toBlob(blob => {
    if (!blob) { showToast('Erro ao gerar imagem', 'error'); btn.disabled = false; btn.textContent = '✅ Usar esta área'; return; }

    photoFile       = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    photoPreviewUrl = URL.createObjectURL(blob);

    // Atualiza preview no modal
    document.getElementById('photo-preview-area').innerHTML =
      `<img src="${photoPreviewUrl}" style="width:100%;height:100%;object-fit:contain;background:#000;">`;
    const recropBtn = document.getElementById('recrop-btn');
    recropBtn.hidden      = false;
    recropBtn.textContent = '✂️ Ajustar recorte';

    document.getElementById('crop-modal').hidden = true;
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    btn.disabled = false; btn.textContent = '✅ Usar esta área';
  }, 'image/jpeg', 0.92);
}

// Controles do cropper
function cropperRotate(deg)  { cropperInstance?.rotate(deg); }
function cropperZoom(ratio)  { cropperInstance?.zoom(ratio); }
function cropperFlipH()      { cropperInstance?.scaleX(cropperInstance.getData().scaleX === -1 ? 1 : -1); }
function cropperReset()      { cropperInstance?.reset(); }

// ---- Save char ----

async function saveChar() {
  const name = document.getElementById('char-name-input').value.trim();
  if (!name) { showToast('Informe o nome do personagem', 'error'); return; }
  if (editingPos === null) return;

  const btn = document.querySelector('#char-modal .btn-primary');
  btn.disabled = true; btn.textContent = 'Salvando...';

  try {
    let photo_url     = chars[editingPos]?.photo_url     || null;
    let photo_preview = chars[editingPos]?.photo_preview || null;

    if (photoFile) {
      photo_preview = photoPreviewUrl; // exibe imediatamente no grid

      if (boardId) {
        // Tabuleiro já existe → faz upload agora
        const url = await uploadPhoto(photoFile, boardId, editingPos);
        if (url) { photo_url = url; photo_preview = null; } // URL permanente obtida
      }
      // Se boardId ainda não existe, guarda como pendente para upload no saveBoard
    }

    chars[editingPos] = {
      name,
      photo_url,
      photo_preview,
      _pendingFile: (!boardId && photoFile) ? photoFile : null,
    };

    closeModal();
    renderGrid();
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

// ---- Upload ----

async function uploadPhoto(file, bId, pos) {
  const path = `${bId}/${pos}.jpg`;
  const { error } = await sb.storage
    .from('character-photos')
    .upload(path, file, { upsert: true, contentType: 'image/jpeg' });

  if (error) {
    showToast('Erro ao enviar foto: ' + error.message, 'error');
    console.error('Upload error:', error);
    return null;
  }
  const { data } = sb.storage.from('character-photos').getPublicUrl(path);
  return data.publicUrl;
}

// ---- Remove char ----

function removeChar() {
  delete chars[editingPos];
  closeModal();
  renderGrid();
}

// ---- Save board ----

async function saveBoard() {
  const name = document.getElementById('board-name').value.trim();
  if (!name) { showToast('Dê um nome ao tabuleiro', 'error'); return; }

  const charEntries = Object.entries(chars);
  if (charEntries.length < 4) { showToast('Adicione pelo menos 4 personagens', 'error'); return; }

  const btn = document.querySelector('button[onclick="saveBoard()"]');
  btn.disabled = true; btn.textContent = 'Salvando...';

  try {
    // Cria ou atualiza o board
    useDefaultQuestions = document.getElementById('use-default-questions')?.checked ?? true;
    const boardPayload = { name, custom_questions: customQuestions, use_default_questions: useDefaultQuestions };

    if (!boardId) {
      const { data, error } = await sb.from('boards')
        .insert({ user_id: currentUser.id, ...boardPayload })
        .select().single();
      if (error) throw error;
      boardId = data.id;
      history.replaceState(null, '', `editor.html?id=${boardId}`);
    } else {
      const { error } = await sb.from('boards').update(boardPayload).eq('id', boardId);
      if (error) throw error;
    }

    // Faz upload de fotos pendentes agora que boardId existe
    for (const [posStr, c] of Object.entries(chars)) {
      if (c._pendingFile) {
        const url = await uploadPhoto(c._pendingFile, boardId, parseInt(posStr));
        if (url) {
          c.photo_url     = url;
          c.photo_preview = null; // limpa blob URL (não é mais necessária)
          c._pendingFile  = null;
        }
      }
    }

    // Substitui todos os personagens no banco
    await sb.from('characters').delete().eq('board_id', boardId);

    const inserts = Object.entries(chars).map(([pos, c]) => ({
      board_id:  boardId,
      position:  parseInt(pos),
      name:      c.name,
      photo_url: c.photo_url || null,
    }));

    if (inserts.length) {
      const { error } = await sb.from('characters').insert(inserts);
      if (error) throw error;
    }

    showToast('Tabuleiro salvo!', 'success');
    renderGrid();
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = '💾 Salvar Tabuleiro';
  }
}

// ---- Custom Questions ----

function updateDefaultToggleLabel() {
  const on   = document.getElementById('use-default-questions')?.checked ?? true;
  const hint = document.getElementById('default-q-hint');
  if (hint) hint.textContent = on
    ? 'As 30 perguntas padrão ficam disponíveis na partida.'
    : 'Somente as perguntas exclusivas deste tabuleiro estarão disponíveis.';
}

function renderQuestionsList() {
  const list = document.getElementById('custom-questions-list');
  if (!list) return;
  if (!customQuestions.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--muted);font-style:italic;margin-bottom:10px;">Nenhuma pergunta adicionada.</p>';
    return;
  }
  list.innerHTML = customQuestions.map((q, i) => `
    <div class="custom-q-item">
      <span>${escapeHtml(q)}</span>
      <button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:13px;flex-shrink:0;" onclick="removeQuestion(${i})">×</button>
    </div>
  `).join('');
}

async function saveQuestionsAuto() {
  if (!boardId) return; // tabuleiro ainda não salvo; perguntas serão incluídas no saveBoard()
  const { error } = await sb.from('boards')
    .update({ custom_questions: customQuestions })
    .eq('id', boardId);
  if (error) showToast('Erro ao salvar perguntas: ' + error.message, 'error');
  else       showToast('Pergunta(s) salva(s)!', 'success');
}

function addQuestion() {
  const input = document.getElementById('new-question-input');
  const text  = input.value.trim();
  if (!text) { showToast('Digite a pergunta', 'error'); return; }
  if (customQuestions.includes(text)) { showToast('Pergunta já existe', 'error'); return; }
  customQuestions.push(text);
  input.value = '';
  renderQuestionsList();
  saveQuestionsAuto();
}

function removeQuestion(i) {
  customQuestions.splice(i, 1);
  renderQuestionsList();
  saveQuestionsAuto();
}

function addDefaultQuestions() {
  let added = 0;
  QUESTIONS.forEach(q => {
    if (!customQuestions.includes(q.text)) {
      customQuestions.push(q.text);
      added++;
    }
  });
  if (!added) { showToast('Todas as perguntas padrão já estão na lista.', 'info'); return; }
  renderQuestionsList();
  saveQuestionsAuto();
}

function exportQuestionsToFile() {
  if (!customQuestions.length) { showToast('Nenhuma pergunta para exportar.', 'error'); return; }
  const content  = customQuestions.join('\n');
  const blob     = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const name     = document.getElementById('board-name').value.trim() || 'tabuleiro';
  a.href         = url;
  a.download     = `perguntas-${name}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function importQuestionsFromFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2 && l.length <= 120);
    let added = 0;
    lines.forEach(q => {
      if (!customQuestions.includes(q)) {
        customQuestions.push(q);
        added++;
      }
    });
    input.value = '';
    if (!added) { showToast('Nenhuma pergunta nova encontrada no arquivo.', 'info'); return; }
    renderQuestionsList();
    saveQuestionsAuto();
  };
  reader.readAsText(file, 'UTF-8');
}

async function importBoardInEditor() {
  const id       = document.getElementById('import-id-input').value.trim();
  const statusEl = document.getElementById('import-editor-status');
  const btn      = document.getElementById('import-board-btn');
  if (!id) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Cole o ID do tabuleiro.'; return; }

  btn.disabled = true; btn.textContent = 'Importando...';
  statusEl.textContent = '';

  const { data: board, error: bErr } = await sb.from('boards').select('*').eq('id', id).single();
  if (bErr || !board) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Tabuleiro não encontrado.';
    btn.disabled = false; btn.textContent = 'Importar';
    return;
  }
  if (board.user_id === currentUser.id) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Este tabuleiro já é seu!';
    btn.disabled = false; btn.textContent = 'Importar';
    return;
  }

  const { data: charList } = await sb.from('characters').select('*').eq('board_id', id);

  const { data: newBoard, error: nbErr } = await sb.from('boards').insert({
    user_id:               currentUser.id,
    name:                  board.name + ' (importado)',
    custom_questions:      board.custom_questions || [],
    use_default_questions: board.use_default_questions ?? true,
  }).select().single();

  if (nbErr) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Erro: ' + nbErr.message;
    btn.disabled = false; btn.textContent = 'Importar';
    return;
  }

  if (charList?.length) {
    await sb.from('characters').insert(charList.map(c => ({
      board_id: newBoard.id, position: c.position, name: c.name, photo_url: c.photo_url || null,
    })));
  }

  showToast('Tabuleiro importado! Abrindo editor...', 'success');
  setTimeout(() => { location.href = `editor.html?id=${newBoard.id}`; }, 1200);
}

function copyBoardId() {
  const input = document.getElementById('share-board-id');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => showToast('ID copiado!', 'success'));
}

// ---- Logout ----

async function doLogout() {
  await sb.auth.signOut();
  location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', init);
