// ============================================================
// Cara a Cara — Game Engine
// ============================================================

const GAME_ID = new URLSearchParams(location.search).get('id');

let guestName = null;

const state = {
  game:           null,
  characters:     [],
  events:         [],
  user:           null,
  profile:        null,
  myNum:          null,
  boardQuestions:      [],
  useDefaultQuestions: true,
  // Cada jogador tem seu próprio conjunto de eliminações (independente)
  eliminated: { 1: new Set(), 2: new Set() },
  guessMode:  false,
};

// Retorna o Set de eliminações do jogador ativo no momento
function getEliminated() {
  const g = state.game;
  if (!g) return state.eliminated[1];
  // Local: usa o turno atual como chave; Online: usa myNum
  const key = g.mode === 'local' ? g.current_turn : (state.myNum || 1);
  return state.eliminated[key];
}

let realtimeChannel = null;

// ---- Init ----

async function init() {
  if (!GAME_ID) { location.href = 'dashboard.html'; return; }

  state.user = await getUser();

  if (!state.user) {
    guestName = await promptGuestName();
    if (!guestName) return;

    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data?.user) {
      showSection('loading');
      document.getElementById('section-loading').innerHTML = `
        <div class="loading-screen" style="height:calc(100vh - 56px);">
          <div style="text-align:center;max-width:380px;margin:0 auto;padding:20px;">
            <div style="font-size:48px;margin-bottom:12px;">⚙️</div>
            <p style="color:#f1f5f9;font-size:17px;font-weight:700;margin-bottom:8px;">Entrada como convidado não configurada</p>
            <p style="color:#94a3b8;font-size:14px;margin-bottom:20px;">
              Para liberar acesso por link, o dono do projeto precisa:<br>
              <strong style="color:#f59e0b;">1.</strong> Habilitar <em>Anonymous Sign-in</em> no Supabase Dashboard<br>
              <strong style="color:#f59e0b;">2.</strong> Atualizar a política RLS da tabela <em>games</em>
            </p>
            <a href="index.html" class="btn btn-primary">Criar conta / Entrar</a>
          </div>
        </div>`;
      return;
    }
    state.user = data.user;
    showSection('loading');
  } else {
    state.profile = await getProfile(state.user.id);
  }

  await refreshGame();
  await loadCharacters();
  await loadEvents();
  await loadBoardQuestions();

  determineMyNum();
  await tryJoinGame();

  subscribeRealtime();
  render();
}

function promptGuestName() {
  return new Promise(resolve => {
    showSection('guest');
    const btn     = document.getElementById('guest-enter-btn');
    const input   = document.getElementById('guest-name-input');
    const errorEl = document.getElementById('guest-error');

    function submit() {
      const name = input.value.trim();
      if (!name || name.length < 2) {
        errorEl.textContent = 'Digite seu nome (mínimo 2 caracteres).';
        return;
      }
      resolve(name);
    }

    input.addEventListener('input', () => {
      btn.disabled = input.value.trim().length < 2;
    });

    btn.onclick     = submit;
    input.onkeydown = e => { if (e.key === 'Enter') submit(); };
    setTimeout(() => input.focus(), 100);
  });
}

async function refreshGame() {
  const { data, error } = await sb.from('games').select('*').eq('id', GAME_ID).single();
  if (error || !data) { showToast('Partida não encontrada.', 'error'); location.href = 'dashboard.html'; return; }
  state.game = data;
}

async function loadCharacters() {
  const { data } = await sb.from('characters').select('*').eq('board_id', state.game.board_id).order('position');
  state.characters = data || [];
}

async function loadBoardQuestions() {
  const { data } = await sb.from('boards').select('custom_questions, use_default_questions').eq('id', state.game.board_id).single();
  state.boardQuestions      = data?.custom_questions || [];
  state.useDefaultQuestions = data?.use_default_questions ?? true;
}

async function loadEvents() {
  const { data } = await sb.from('game_events').select('*').eq('game_id', GAME_ID).order('created_at');
  state.events = data || [];
}

function determineMyNum() {
  const g = state.game;
  if (g.player1_id === state.user.id) state.myNum = 1;
  else if (g.player2_id === state.user.id) state.myNum = 2;
  else state.myNum = null;
}

async function tryJoinGame() {
  const g = state.game;

  // Já é um dos jogadores — não precisa fazer nada
  if (state.myNum !== null) return;

  // Modo local: player1 é o único usuário autenticado, nunca há join
  if (g.mode === 'local') return;

  // Online: partida ainda aguardando player2
  if (g.status === 'waiting' && !g.player2_id) {
    const { data, error } = await sb.from('games').update({
      player2_id:   state.user.id,
      player2_name: state.profile?.username || guestName || state.user.email || 'Convidado',
      status:       'selecting',
    })
    .eq('id', GAME_ID)
    .is('player2_id', null)   // garante que não houve race condition
    .select()
    .single();

    if (error) {
      showToast('Erro ao entrar na partida: ' + error.message, 'error');
      return;
    }
    if (data) {
      state.myNum = 2;
      state.game  = data;
    } else {
      showToast('Partida não encontrada ou já iniciada.', 'error');
    }
    return;
  }

  // Partida já em andamento: verifica se este usuário é player2 que recarregou a página
  if (g.player2_id === state.user.id) {
    state.myNum = 2;
  }
}

// ---- Realtime ----

function subscribeRealtime() {
  realtimeChannel = sb.channel(`game-${GAME_ID}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${GAME_ID}`
    }, payload => {
      state.game = payload.new;
      render();
    })
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${GAME_ID}`
    }, payload => {
      state.events.push(payload.new);
      renderLog();
    })
    .subscribe();
}

// ---- Main render dispatcher ----

function showSection(id) {
  ['loading','waiting','selecting','pass-device','playing','finished','guest'].forEach(s => {
    const el = document.getElementById(`section-${s}`);
    if (el) el.hidden = (s !== id);
  });
}

function render() {
  const g = state.game;
  if (!g) return;

  // Navbar info
  document.getElementById('nav-board-name').textContent = ''; // optional: load board name
  const p1 = g.player1_name || 'J1';
  const p2 = g.player2_name || (g.mode === 'online' ? 'Aguardando...' : 'J2');
  document.getElementById('nav-players').textContent = `${p1} vs ${p2}`;

  switch (g.status) {
    case 'waiting':       renderWaiting();    break;
    case 'selecting':     renderSelecting();  break;
    case 'selecting_p2':  renderSelectingP2(); break;
    case 'playing':       renderPlaying();    break;
    case 'finished':      renderFinished();   break;
    default: showSection('loading');
  }
}

// ---- Waiting ----

function renderWaiting() {
  showSection('waiting');
  const link = `${location.origin}${location.pathname}?id=${GAME_ID}`;
  document.getElementById('game-link').value = link;
}

function copyGameLink() {
  const input = document.getElementById('game-link');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => showToast('Link copiado!', 'success'));
}

// ---- Selecting character ----

function renderSelecting() {
  const g = state.game;
  const myReady = state.myNum === 1 ? g.player1_ready : g.player2_ready;

  if (myReady) {
    showSection('selecting');
    document.getElementById('section-selecting').innerHTML = `
      <div style="max-width:480px;margin:60px auto;text-align:center;">
        <div style="font-size:52px;margin-bottom:12px;">✅</div>
        <h2 style="color:#f1f5f9;margin-bottom:8px;">Personagem escolhido!</h2>
        <p style="color:#94a3b8;">Aguardando o seu oponente escolher...</p>
        <div class="spinner" style="margin:24px auto 0;"></div>
      </div>`;
    return;
  }

  showSection('selecting');
  const playerName = state.myNum === 1 ? g.player1_name : g.player2_name;
  document.getElementById('section-selecting').innerHTML = `
    <div class="selecting-header">
      <h2>🎭 ${escapeHtml(playerName)}, escolha seu personagem secreto</h2>
      <p>Clique no personagem que você quer ser. Seu oponente não vai saber!</p>
    </div>
    <div class="board-area">
      <div class="board-frame">
        <div class="board-frame-top">
          <span class="board-frame-logo">🎭 <span class="logo-a">Cara</span> <span class="logo-b">a</span> <span class="logo-a">Cara</span></span>
          <span class="board-frame-hint-text">Clique no seu personagem secreto</span>
        </div>
        <div class="game-board" id="game-board"></div>
      </div>
    </div>`;
  renderBoardCards({ selecting: true });
}

function renderSelectingP2() {
  const g = state.game;
  const p2Ready = g.player2_ready;

  if (p2Ready) {
    // Both ready, waiting for DB update to 'playing'
    showSection('selecting');
    document.getElementById('section-selecting').innerHTML = `
      <div style="max-width:480px;margin:60px auto;text-align:center;">
        <div class="spinner" style="margin:0 auto 12px;"></div>
        <p style="color:#94a3b8;">Iniciando partida...</p>
      </div>`;
    return;
  }

  // Show pass-device screen for player 2 to click ready
  showSection('pass-device');
  const p2Name = g.player2_name || 'Jogador 2';
  document.getElementById('pass-device-title').textContent = `Vez de ${p2Name}`;
  document.getElementById('pass-device-msg').textContent =
    `Passe o dispositivo para ${p2Name} e peça que ele clique em "Estou pronto".`;
  document.getElementById('pass-device-btn').onclick = () => showSelectingP2Board();
}

function showSelectingP2Board() {
  const g = state.game;
  const p2Name = g.player2_name || 'Jogador 2';
  showSection('selecting');
  document.getElementById('section-selecting').innerHTML = `
    <div class="selecting-header">
      <h2>🎭 ${escapeHtml(p2Name)}, escolha seu personagem secreto</h2>
      <p>Clique no personagem que você quer ser. Ninguém vai ver!</p>
    </div>
    <div class="board-area">
      <div class="board-frame">
        <div class="board-frame-top">
          <span class="board-frame-logo">🎭 <span class="logo-a">Cara</span> <span class="logo-b">a</span> <span class="logo-a">Cara</span></span>
          <span class="board-frame-hint-text">Clique no seu personagem secreto</span>
        </div>
        <div class="game-board" id="game-board"></div>
      </div>
    </div>`;
  renderBoardCards({ selecting: true, forPlayer: 2 });
}

// ---- Character selection action ----

async function selectCharacter(pos, forPlayer) {
  const playerNum = forPlayer || state.myNum;
  if (!playerNum) return;

  const charField  = `player${playerNum}_character`;
  const readyField = `player${playerNum}_ready`;

  const { error } = await sb.from('games').update({
    [charField]:  pos,
    [readyField]: true,
  }).eq('id', GAME_ID);

  if (error) { showToast('Erro ao selecionar personagem', 'error'); return; }
  await refreshGame();

  const g = state.game;
  // Check if both ready → start game
  if (g.player1_ready) {
    if (g.mode === 'online' && g.player2_ready) {
      await sb.from('games').update({ status: 'playing', current_turn: 1 }).eq('id', GAME_ID);
    } else if (g.mode === 'local' && playerNum === 1) {
      // P1 done → move to selecting_p2
      await sb.from('games').update({ status: 'selecting_p2' }).eq('id', GAME_ID);
    } else if (g.mode === 'local' && playerNum === 2) {
      await sb.from('games').update({ status: 'playing', current_turn: 1 }).eq('id', GAME_ID);
    }
  }

  await refreshGame();
  render();
}

// ---- Playing ----

function renderPlaying() {
  showSection('playing');
  const g = state.game;

  // Personagem secreto do jogador que está vendo o tabuleiro agora
  const viewerNum = g.mode === 'local' ? g.current_turn : state.myNum;
  const mySecret  = viewerNum === 1 ? g.player1_character : g.player2_character;
  const myName    = viewerNum === 1 ? g.player1_name      : g.player2_name;

  // Atualiza badge do tabuleiro
  const badge = document.getElementById('bf-player-badge');
  if (badge) badge.textContent = `🃏 Tabuleiro de ${myName}`;

  renderBoardCards({ mySecretPos: mySecret });
  renderPanel();
  renderLog();
}

function renderPanel() {
  const g   = state.game;
  const top = document.getElementById('panel-top');

  // My secret character mini card
  const mySecret = state.myNum === 1 ? g.player1_character : (state.myNum === 2 ? g.player2_character : g.player1_character);
  const myChar   = state.characters.find(c => c.position === mySecret);
  let secretHtml = '';
  if (myChar) {
    secretHtml = `
      <div class="my-secret-card">
        <div class="mini-photo">${charAvatar(myChar)}</div>
        <div class="mini-info">
          <div class="mini-label">⭐ Meu personagem</div>
          <div class="mini-name">${escapeHtml(myChar.name)}</div>
        </div>
      </div>`;
  }

  if (g.mode === 'local') {
    const curName = g.current_turn === 1 ? g.player1_name : g.player2_name;
    const allQ = [
      ...(state.useDefaultQuestions ? QUESTIONS.map(q => q.text) : []),
      ...state.boardQuestions,
    ];
    top.innerHTML = `
      ${secretHtml}
      <div class="turn-indicator ${g.current_turn === state.myNum ? 'my-turn' : 'opp-turn'}">
        <div class="turn-label">Vez de:</div>
        <div class="turn-name">${escapeHtml(curName)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-accent" onclick="openGuessModal()">🎯 Tentar Adivinhar</button>
        <button class="btn btn-primary" onclick="doPassLocalTurn()">➡️ Próximo Turno</button>
      </div>
      ${allQ.length ? `
      <div class="questions-ref">
        <div class="questions-ref-title">Perguntas disponíveis</div>
        <ul class="questions-ref-list">
          ${allQ.map(q => `<li>${escapeHtml(q)}</li>`).join('')}
        </ul>
      </div>` : ''}`;
    return;
  }

  // Online mode
  const myTurn = isMyTurn();
  const hasPending = !!g.pending_question;

  if (myTurn && !hasPending) {
    // My turn to ask or guess
    top.innerHTML = `
      ${secretHtml}
      <div class="turn-indicator my-turn">
        <div class="turn-label">🎤 Sua vez de perguntar!</div>
      </div>
      <select class="question-select" id="q-select">
        <option value="">Selecione uma pergunta...</option>
        ${state.useDefaultQuestions ? `
        <optgroup label="Perguntas padrão">
          ${QUESTIONS.map(q => `<option value="${escapeHtml(q.text)}">${escapeHtml(q.text)}</option>`).join('')}
        </optgroup>` : ''}
        ${state.boardQuestions.length ? `
        <optgroup label="Perguntas do tabuleiro">
          ${state.boardQuestions.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
        </optgroup>` : ''}
      </select>
      <button class="btn btn-primary btn-full" onclick="doAskQuestion()">Perguntar</button>
      <div class="or-divider">ou</div>
      <button class="btn btn-accent btn-full" onclick="openGuessModal()">🎯 Tentar Adivinhar!</button>
      <div class="or-divider">ou</div>
      <button class="btn btn-ghost btn-full" onclick="doPassOnlineTurn()">➡️ Passar Turno</button>`;
  } else if (myTurn && hasPending) {
    // I asked, waiting for answer
    top.innerHTML = `
      ${secretHtml}
      <div class="turn-indicator my-turn">
        <div class="turn-label">⏳ Aguardando resposta...</div>
      </div>
      <div class="pending-box">
        <div class="pending-label">Você perguntou:</div>
        <p>${escapeHtml(g.pending_question)}</p>
      </div>`;
  } else if (!myTurn && hasPending) {
    // Opponent asked me, I must answer
    const oppName = state.myNum === 1 ? g.player2_name : g.player1_name;
    top.innerHTML = `
      ${secretHtml}
      <div class="turn-indicator opp-turn">
        <div class="turn-label">❓ ${escapeHtml(oppName)} perguntou:</div>
      </div>
      <div class="pending-box">
        <p>${escapeHtml(g.pending_question)}</p>
      </div>
      <div class="answer-btns">
        <button class="btn btn-success" onclick="doAnswer(true)">✅ SIM</button>
        <button class="btn btn-danger"  onclick="doAnswer(false)">❌ NÃO</button>
        <button class="btn btn-ghost answer-unsure" onclick="doAnswer(null)">🤷 Não sei</button>
      </div>`;
  } else {
    // Opponent's turn, no pending question
    const oppName = state.myNum === 1 ? g.player2_name : g.player1_name;
    top.innerHTML = `
      ${secretHtml}
      <div class="turn-indicator opp-turn">
        <div class="turn-label">Vez do adversário</div>
        <div class="turn-name">${escapeHtml(oppName)}</div>
        <div class="turn-sub">Aguardando pergunta...</div>
      </div>`;
  }
}

// ---- Board rendering ----

function renderBoardCards({ selecting = false, mySecretPos = null, forPlayer = null } = {}) {
  const board = document.getElementById('game-board');
  if (!board) return;
  board.innerHTML = '';

  const elim = getEliminated();

  state.characters.forEach(char => {
    const pos      = char.position;
    const isElim   = elim.has(pos);
    const isSecret = pos === mySecretPos;

    // Wrapper: controla perspectiva e classes de estado
    const wrap = document.createElement('div');
    wrap.className = [
      'gc-wrap',
      isElim   ? 'eliminated' : '',
      isSecret ? 'is-secret'  : '',
      selecting ? 'selecting'  : '',
    ].filter(Boolean).join(' ');
    wrap.dataset.pos = pos;

    // Card interno: é este que anima (rotateX)
    wrap.innerHTML = `
      <div class="gc-card">
        <div class="gc-photo">
          ${charAvatar(char)}
          ${isSecret ? '<div class="gc-secret-badge">⭐ Eu</div>' : ''}
        </div>
        <div class="gc-name">${escapeHtml(char.name)}</div>
      </div>`;

    if (selecting) {
      wrap.addEventListener('click', () => showCharConfirm(char, () => selectCharacter(pos, forPlayer)));
    } else {
      wrap.addEventListener('click', () => toggleEliminate(pos, wrap));
    }

    board.appendChild(wrap);
  });
}

function showCharConfirm(char, onConfirm) {
  const modal = document.getElementById('char-confirm-modal');
  document.getElementById('char-confirm-avatar').innerHTML = charAvatar(char);
  document.getElementById('char-confirm-name').textContent = char.name;
  modal.hidden = false;

  document.getElementById('char-confirm-ok').onclick = () => {
    modal.hidden = true;
    onConfirm();
  };
  document.getElementById('char-confirm-cancel').onclick = () => {
    modal.hidden = true;
  };
}

function toggleEliminate(pos, wrap) {
  const elim = getEliminated();
  if (elim.has(pos)) {
    elim.delete(pos);
    wrap.classList.remove('eliminated');
  } else {
    elim.add(pos);
    wrap.classList.add('eliminated');
  }
}

// ---- Game actions ----

async function doAskQuestion() {
  const select = document.getElementById('q-select');
  const text   = select?.value;
  if (!text) { showToast('Selecione uma pergunta', 'error'); return; }
  if (!isMyTurn()) return;

  const { error: evErr } = await sb.from('game_events').insert({
    game_id:     GAME_ID,
    player_num:  state.myNum,
    player_name: state.myNum === 1 ? state.game.player1_name : state.game.player2_name,
    type:        'question',
    data:        { text },
  });
  if (evErr) { showToast('Erro ao enviar pergunta', 'error'); return; }

  await sb.from('games').update({ pending_question: text }).eq('id', GAME_ID);
  await refreshGame();
  renderPanel();
}

async function doAnswer(answer) {
  if (isMyTurn() || !state.game.pending_question) return;

  const myName = state.myNum === 1 ? state.game.player1_name : state.game.player2_name;
  await sb.from('game_events').insert({
    game_id:     GAME_ID,
    player_num:  state.myNum,
    player_name: myName,
    type:        'answer',
    data:        { answer },
  });

  // Turn passes to me (the answerer)
  await sb.from('games').update({
    pending_question: null,
    current_turn:     state.myNum,
  }).eq('id', GAME_ID);

  await refreshGame();
  renderPlaying();
}

async function doPassLocalTurn() {
  const g        = state.game;
  const nextTurn = g.current_turn === 1 ? 2 : 1;
  const myName   = g.current_turn === 1 ? g.player1_name : g.player2_name;
  const nextName = nextTurn === 1 ? g.player1_name : g.player2_name;

  await sb.from('game_events').insert({
    game_id:     GAME_ID,
    player_num:  g.current_turn,
    player_name: myName,
    type:        'pass_turn',
    data:        {},
  });

  await sb.from('games').update({ current_turn: nextTurn }).eq('id', GAME_ID);
  await refreshGame();
  await loadEvents();

  // Mostra overlay de troca de turno para esconder o tabuleiro do jogador anterior
  document.getElementById('lto-next-name').textContent = nextName;
  document.getElementById('local-turn-overlay').hidden  = false;
}

async function continueLocalTurn() {
  document.getElementById('local-turn-overlay').hidden = true;
  renderPlaying();
}

async function doPassOnlineTurn() {
  if (!isMyTurn() || state.game.pending_question) return;
  const g      = state.game;
  const myName = state.myNum === 1 ? g.player1_name : g.player2_name;
  const next   = state.myNum === 1 ? 2 : 1;

  await sb.from('game_events').insert({
    game_id:     GAME_ID,
    player_num:  state.myNum,
    player_name: myName,
    type:        'pass_turn',
    data:        {},
  });
  await sb.from('games').update({ current_turn: next, pending_question: null }).eq('id', GAME_ID);
  await refreshGame();
  renderPlaying();
}

// ---- Guess ----

function openGuessModal() {
  const modal = document.getElementById('guess-modal');
  const grid  = document.getElementById('guess-modal-grid');
  modal.hidden = false;
  grid.innerHTML = '';

  state.characters.forEach(char => {
    const btn = document.createElement('div');
    btn.className = 'guess-char-btn';
    btn.innerHTML = `
      ${charAvatar(char)}
      <span>${escapeHtml(char.name)}</span>`;
    btn.addEventListener('click', () => {
      modal.hidden = true;
      showGuessConfirm(char);
    });
    grid.appendChild(btn);
  });
}

function showGuessConfirm(char) {
  const modal = document.getElementById('guess-confirm-modal');
  document.getElementById('guess-confirm-avatar').innerHTML = charAvatar(char);
  document.getElementById('guess-confirm-name').textContent = char.name;
  modal.hidden = false;

  document.getElementById('guess-confirm-ok').onclick = () => {
    modal.hidden = true;
    confirmGuess(char.position, char.name);
  };
  document.getElementById('guess-confirm-cancel').onclick = () => {
    modal.hidden = true;
    openGuessModal();
  };
}

async function confirmGuess(pos, name) {
  const g = state.game;
  const oppField = state.myNum === 1 ? 'player2_character' : (state.myNum === 2 ? 'player1_character' : null);

  // For local mode, use current_turn to figure out whose guess this is
  let oppChar;
  if (g.mode === 'local') {
    oppChar = g.current_turn === 1 ? g.player2_character : g.player1_character;
  } else {
    oppChar = oppField ? g[oppField] : null;
  }

  const correct  = oppChar === pos;
  const actorNum = g.mode === 'local' ? g.current_turn : state.myNum;
  const actorName = actorNum === 1 ? g.player1_name : g.player2_name;

  await sb.from('game_events').insert({
    game_id:     GAME_ID,
    player_num:  actorNum,
    player_name: actorName,
    type:        'guess',
    data:        { position: pos, characterName: name, correct },
  });

  const winner = correct ? actorNum : (actorNum === 1 ? 2 : 1);
  await sb.from('games').update({ status: 'finished', winner }).eq('id', GAME_ID);
  await refreshGame();
  await loadEvents();
  render();
}

// ---- Finished ----

function renderFinished() {
  showSection('finished');
  const g       = state.game;
  const iWon    = g.mode === 'local' ? null : (g.winner === state.myNum);
  const winnerName = g.winner === 1 ? g.player1_name : g.player2_name;

  // Reveal opponent's character
  let oppCharPos;
  if (g.mode === 'local') {
    // In local mode, show both
    oppCharPos = null;
  } else {
    oppCharPos = state.myNum === 1 ? g.player2_character : g.player1_character;
  }
  const oppChar = state.characters.find(c => c.position === oppCharPos);

  const p1Char  = state.characters.find(c => c.position === g.player1_character);
  const p2Char  = state.characters.find(c => c.position === g.player2_character);

  let resultEmoji, title;
  if (g.mode === 'local') {
    resultEmoji = '🏆'; title = `${escapeHtml(winnerName)} venceu!`;
  } else {
    resultEmoji = iWon ? '🏆' : '😔';
    title = iWon ? 'Você Venceu!' : 'Você Perdeu!';
  }

  const revealHtml = g.mode === 'local' ? `
    <div class="reveal-label">Personagens secretos:</div>
    <div style="display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;">
      ${p1Char ? `<div class="reveal-char"><div class="reveal-label">${escapeHtml(g.player1_name)}</div>${charAvatar(p1Char)}<span>${escapeHtml(p1Char.name)}</span></div>` : ''}
      ${p2Char ? `<div class="reveal-char"><div class="reveal-label">${escapeHtml(g.player2_name || 'J2')}</div>${charAvatar(p2Char)}<span>${escapeHtml(p2Char.name)}</span></div>` : ''}
    </div>
  ` : oppChar ? `
    <div class="reveal-label">O personagem do seu oponente era:</div>
    <div class="reveal-char" style="margin:0 auto 20px;width:fit-content;">${charAvatar(oppChar)}<span>${escapeHtml(oppChar.name)}</span></div>
  ` : '';

  document.getElementById('section-finished').innerHTML = `
    <div class="finished-box">
      <div class="result-emoji">${resultEmoji}</div>
      <h2>${title}</h2>
      <p>${g.mode === 'local' ? `${escapeHtml(winnerName)} adivinhou o personagem do adversário!` : (iWon ? 'Parabéns, você adivinhou!' : `${escapeHtml(winnerName)} adivinhou primeiro.`)}</p>
      ${revealHtml}
      <a href="dashboard.html" class="btn btn-primary btn-lg">← Voltar ao Menu</a>
    </div>`;
}

// ---- Q&A History ----

function getQAPairs() {
  const g = state.game;
  if (!g) return [];

  // Local: mostra perguntas do jogador cujo turno está ativo; Online: do usuário atual
  const viewerNum = g.mode === 'local' ? g.current_turn : state.myNum;

  const pairs  = [];
  const events = state.events;
  for (let i = 0; i < events.length; i++) {
    const ev        = events[i];
    const next      = events[i + 1];
    const hasAnswer = next?.type === 'answer';

    if (ev.type === 'question') {
      if (ev.player_num === viewerNum) {
        pairs.push({ q: ev, a: hasAnswer ? next : null });
      }
      if (hasAnswer) i++; // pula a resposta independente de quem perguntou
    }
  }
  return pairs.reverse();
}

function renderQAHistory() {
  const list    = document.getElementById('qa-list');
  const countEl = document.getElementById('qa-count');
  if (!list) return;

  const pairs    = getQAPairs();
  const answered = pairs.filter(p => p.a).length;

  if (countEl) countEl.textContent = answered || '';

  if (!pairs.length) {
    list.innerHTML = '<li class="qa-empty">Nenhuma pergunta feita ainda.</li>';
    return;
  }

  list.innerHTML = pairs.map(({ q, a }) => {
    let itemClass, answerHtml;
    if (!a) {
      itemClass  = 'qa-pending-item';
      answerHtml = `<span class="qa-answer qa-pending">⏳ Aguardando...</span>`;
    } else if (a.data?.answer === true) {
      itemClass  = 'qa-yes-item';
      answerHtml = `<span class="qa-answer qa-yes">✅ SIM</span>`;
    } else if (a.data?.answer === false) {
      itemClass  = 'qa-no-item';
      answerHtml = `<span class="qa-answer qa-no">❌ NÃO</span>`;
    } else {
      itemClass  = 'qa-unknown-item';
      answerHtml = `<span class="qa-answer qa-unknown">🤷 Não sei</span>`;
    }
    return `
      <li class="qa-item ${itemClass}">
        <div class="qa-question">${escapeHtml(q.data?.text || '')}</div>
        <div class="qa-answer-row">
          ${answerHtml}
          <span class="qa-asker">${escapeHtml(q.player_name)}</span>
        </div>
      </li>`;
  }).join('');
}

function renderLog() {
  renderQAHistory();
}

// ---- Helpers ----

function isMyTurn() {
  return state.game?.current_turn === state.myNum;
}

// ---- Start ----
document.addEventListener('DOMContentLoaded', init);
