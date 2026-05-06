let currentUser = null;
let userProfile = null;
let boards = [];

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  userProfile = await getProfile(currentUser.id);
  document.getElementById('nav-username').textContent = userProfile?.username || currentUser.email;

  await loadBoards();

  // Toggle local mode player2 name field
  document.getElementById('game-mode').addEventListener('change', e => {
    document.getElementById('p2-name-field').hidden = e.target.value !== 'local';
  });
}

async function loadBoards() {
  const { data, error } = await sb
    .from('boards')
    .select('id, name, created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { showToast('Erro ao carregar tabuleiros', 'error'); return; }
  boards = data || [];

  document.getElementById('boards-count').textContent = boards.length;
  renderBoardsList();
  populateBoardSelect();
}

function renderBoardsList() {
  const el = document.getElementById('boards-list');
  if (!boards.length) {
    el.className = '';
    el.innerHTML = `
      <div class="empty-state">
        <p>Você ainda não criou nenhum tabuleiro.</p>
        <a href="editor.html" class="btn btn-primary">Criar meu primeiro tabuleiro</a>
      </div>`;
    return;
  }

  el.className = '';
  el.innerHTML = boards.map(b => `
    <div class="board-card" style="margin-bottom:10px;">
      <div class="board-card-info">
        <h3>${escapeHtml(b.name)}</h3>
        <p>Criado em ${new Date(b.created_at).toLocaleDateString('pt-BR')}</p>
      </div>
      <div class="board-card-actions">
        <a href="editor.html?id=${b.id}" class="btn btn-ghost btn-sm">Editar</a>
        <button class="btn btn-danger btn-sm" onclick="deleteBoard('${b.id}')">Excluir</button>
      </div>
    </div>
  `).join('');
}

function populateBoardSelect() {
  const sel = document.getElementById('game-board');
  sel.innerHTML = '<option value="">Selecione um tabuleiro...</option>' +
    boards.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

async function deleteBoard(id) {
  if (!confirm('Excluir este tabuleiro? Todos os personagens serão removidos.')) return;
  const { error } = await sb.from('boards').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir', 'error'); return; }
  showToast('Tabuleiro excluído', 'success');
  await loadBoards();
}

async function createGame() {
  const boardId  = document.getElementById('game-board').value;
  const mode     = document.getElementById('game-mode').value;
  const p2Name   = document.getElementById('p2-name').value.trim();

  if (!boardId) { showToast('Selecione um tabuleiro', 'error'); return; }
  if (mode === 'local' && !p2Name) { showToast('Informe o nome do Jogador 2', 'error'); return; }

  const gameData = {
    board_id:     boardId,
    player1_id:   currentUser.id,
    player1_name: userProfile?.username || currentUser.email,
    mode,
    status:       mode === 'local' ? 'selecting' : 'waiting',
  };

  if (mode === 'local') {
    gameData.player2_name = p2Name;
  }

  const { data, error } = await sb.from('games').insert(gameData).select().single();
  if (error) { showToast('Erro ao criar partida: ' + error.message, 'error'); return; }

  const gameUrl = `${location.origin}${location.pathname.replace('dashboard.html','game.html')}?id=${data.id}`;
  document.getElementById('created-link').value = gameUrl;
  document.getElementById('go-to-game').href    = `game.html?id=${data.id}`;
  document.getElementById('created-modal').hidden = false;
}

function copyLink() {
  const input = document.getElementById('created-link');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => showToast('Link copiado!', 'success'));
}

function joinById() {
  const id = document.getElementById('join-id').value.trim();
  if (!id) { showToast('Cole o ID da partida', 'error'); return; }
  window.location.href = `game.html?id=${id}`;
}

async function importBoard() {
  const boardId  = document.getElementById('import-board-id').value.trim();
  const statusEl = document.getElementById('import-status');
  const btn      = document.getElementById('import-btn');
  if (!boardId) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Cole o ID do tabuleiro.'; return; }

  btn.disabled = true; btn.textContent = 'Importando...';
  statusEl.textContent = '';

  // Busca o tabuleiro original
  const { data: board, error: bErr } = await sb.from('boards').select('*').eq('id', boardId).single();
  if (bErr || !board) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Tabuleiro não encontrado. Verifique o ID.';
    btn.disabled = false; btn.textContent = 'Importar';
    return;
  }
  if (board.user_id === currentUser.id) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Este tabuleiro já é seu!';
    btn.disabled = false; btn.textContent = 'Importar';
    return;
  }

  // Busca personagens
  const { data: chars } = await sb.from('characters').select('*').eq('board_id', boardId);

  // Cria cópia do tabuleiro
  const { data: newBoard, error: nbErr } = await sb.from('boards').insert({
    user_id:              currentUser.id,
    name:                 board.name + ' (importado)',
    custom_questions:     board.custom_questions || [],
    use_default_questions: board.use_default_questions ?? true,
  }).select().single();

  if (nbErr) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Erro ao criar cópia: ' + nbErr.message;
    btn.disabled = false; btn.textContent = 'Importar';
    return;
  }

  // Copia personagens (reusa as URLs de foto originais)
  if (chars?.length) {
    const inserts = chars.map(c => ({
      board_id:  newBoard.id,
      position:  c.position,
      name:      c.name,
      photo_url: c.photo_url || null,
    }));
    await sb.from('characters').insert(inserts);
  }

  statusEl.style.color = 'var(--green-d)';
  statusEl.textContent = `✅ "${board.name}" importado com sucesso!`;
  document.getElementById('import-board-id').value = '';
  btn.disabled = false; btn.textContent = 'Importar';
  await loadBoards();
}

async function doLogout() {
  await sb.auth.signOut();
  location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', init);
