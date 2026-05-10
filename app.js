(function() {
  // ===================== SUPABASE =====================
  const SUPABASE_URL = 'https://pqgwrokpizeelfrjmgoc.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3dyb2twaXplZWxmcmptZ29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTAyMDksImV4cCI6MjA5MjcyNjIwOX0.qtFCGBnpwdQbtmpwSZxI_hH3arq4HBAw62vs5h8WmAk';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ===================== СОСТОЯНИЕ =====================
  let currentUser = null;
  let currentView = 'ai'; // 'ai' или 'wall'
  let chats = [];
  let activeChatId = null;
  let isWaitingAI = false;
  let mistralApiKey = '';
  let wallFilterTag = null;

  // ===================== УТИЛИТЫ =====================
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]); }
  function toast(title, msg, type='info') {
    const container = $('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-content"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(msg)}</div><button class="toast-close"><i class="fas fa-times"></i></button>`;
    container.appendChild(el);
    el.querySelector('.toast-close').onclick = () => el.remove();
    setTimeout(() => el.remove(), 4000);
  }

  // ===================== АВТОРИЗАЦИЯ =====================
  async function fetchMistralKey() {
    const { data } = await sb.from('service_config').select('mistral_api_key').eq('id', 1).single();
    if (data) mistralApiKey = data.mistral_api_key;
  }

  async function login() {
    const loginVal = $('loginIdentity').value.trim();
    const pass = $('loginPassword').value;
    if (!loginVal || !pass) return toast('Ошибка', 'Введите логин и пароль', 'warning');
    const btn = $('doLoginBtn');
    btn.disabled = true;
    const { data: user } = await sb.from('users').select('*').eq('login', loginVal).eq('password', pass).maybeSingle();
    if (!user) { toast('Ошибка', 'Неверный логин или пароль', 'error'); btn.disabled = false; return; }
    currentUser = {
      login: user.login,
      name: user.name || user.login,
      avatar: user.avatar || '',
      tags: user.tags || [],
      fa_icon: user.fa_icon || ''
    };
    localStorage.setItem('dirmess_user', JSON.stringify(currentUser));
    showMainUI();
    btn.disabled = false;
  }

  async function register() {
    const loginVal = $('regLogin').value.trim();
    const pass = $('regPassword').value;
    const tagsStr = $('regTags').value.trim();
    if (!loginVal || pass.length < 6) return toast('Ошибка', 'Логин и пароль (мин. 6 символов)', 'warning');
    const btn = $('doRegisterBtn');
    btn.disabled = true;
    const { data: exist } = await sb.from('users').select('login').eq('login', loginVal).maybeSingle();
    if (exist) { toast('Ошибка', 'Логин занят', 'error'); btn.disabled = false; return; }
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    const { error } = await sb.from('users').insert([{
      login: loginVal, password: pass, email: loginVal+'@diamkey.local',
      name: loginVal, avatar: '', fa_icon: '', tags
    }]);
    if (error) { toast('Ошибка', error.message, 'error'); btn.disabled = false; return; }
    toast('Успех', 'Аккаунт создан, войдите', 'success');
    // Переключение на вкладку входа
    $('tabRegister').classList.remove('active');
    $('tabLogin').classList.add('active');
    $('registerForm').style.display = 'none';
    $('loginForm').style.display = 'block';
    btn.disabled = false;
  }

  // ===================== ИНТЕРФЕЙС =====================
  function showMainUI() {
    $('authScreen').style.display = 'none';
    $('mainUI').style.display = 'flex';
    setTimeout(() => $('mainUI').classList.add('visible'), 50);
    updateUserPanel();
    loadChats();
    switchView(currentView);
  }

  function updateUserPanel() {
    if (!currentUser) return;
    $('userNameDisplay').textContent = currentUser.name;
    $('userAvatarImg').src = currentUser.avatar || 'default-avatar.png';
  }

  function switchView(view) {
    currentView = view;
    $('aiChatView').style.display = view === 'ai' ? 'flex' : 'none';
    $('wallView').style.display = view === 'wall' ? 'flex' : 'none';
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === view);
    });
    if (view === 'ai') renderAIChat();
    else renderWall();
  }

  // ===================== ИИ-ЧАТ =====================
  async function loadChats() {
    const { data } = await sb.from('dirmess_chats').select('*').eq('user_login', currentUser.login).order('last_activity', { ascending: false });
    chats = data || [];
    if (chats.length > 0) {
      activeChatId = chats[0].id;
    } else {
      activeChatId = null;
    }
    renderChatList();
    if (currentView === 'ai') renderAIChat();
  }

  function renderChatList() {
    const list = $('chatList');
    list.innerHTML = chats.map(c => `
      <div class="chat-item ${c.id === activeChatId ? 'active' : ''}" data-id="${c.id}">
        <i class="fas fa-comment"></i> <span class="chat-title">${escapeHtml(c.title || 'Новый чат')}</span>
      </div>
    `).join('');
    list.querySelectorAll('.chat-item').forEach(el => {
      el.onclick = () => {
        activeChatId = el.dataset.id;
        renderChatList();
        renderAIChat();
      };
    });
  }

  async function createNewAIChat() {
    const id = Date.now().toString();
    const newChat = {
      id, user_login: currentUser.login, title: 'Новый чат',
      messages: [], created_at: new Date().toISOString(),
      last_activity: new Date().toISOString(), pinned: false
    };
    chats.unshift(newChat);
    activeChatId = id;
    renderChatList();
    renderAIChat();
  }

  function getActiveChat() {
    return chats.find(c => c.id === activeChatId) || null;
  }

  function renderAIChat() {
    const chat = getActiveChat();
    const container = $('aiMessages');
    container.innerHTML = '';
    if (!chat || !chat.messages || chat.messages.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">Начните диалог с ИИ</div>';
      return;
    }
    chat.messages.forEach((msg, idx) => {
      const bubble = document.createElement('div');
      bubble.className = `message ${msg.role}`;
      const avatarHtml = msg.role === 'user'
        ? (currentUser.avatar ? `<img src="${currentUser.avatar}">` : '<i class="fas fa-user"></i>')
        : '<img src="bots.png">';
      const content = msg.role === 'assistant'
        ? DOMPurify.sanitize(marked.parse(msg.content))
        : escapeHtml(msg.content);
      bubble.innerHTML = `
        <div class="avatar">${avatarHtml}</div>
        <div class="message-content-wrapper">
          <div class="message-content">${content}</div>
          <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}</div>
        </div>
      `;
      container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
    // Рендер математики и кода
    if (window.renderMathInElement) renderMathInElement(container, { delimiters: [{left:'$$',right:'$$',display:true},{left:'\\(',right:'\\)',display:false}] });
  }

  async function sendAIMessage() {
    const input = $('aiUserInput');
    const text = input.value.trim();
    if (!text || isWaitingAI || !mistralApiKey) return;
    const chat = getActiveChat();
    if (!chat) {
      await createNewAIChat();
      return sendAIMessage(); // повторить
    }
    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    chat.messages.push(userMsg);
    if (chat.messages.filter(m => m.role === 'user').length === 1) {
      chat.title = text.substring(0, 50);
    }
    chat.last_activity = Date.now();
    await sb.from('dirmess_chats').upsert(chat);
    renderAIChat();
    input.value = '';
    updateSendButton();

    // Запрос к Mistral
    isWaitingAI = true;
    const systemPrompt = { role: 'system', content: `Ты — помощник Dirmess. Отвечай полезно, используй KaTeX для математики, выделяй код.` };
    const context = chat.messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
    const messages = [systemPrompt, ...context];
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${mistralApiKey}` },
        body: JSON.stringify({ model: 'mistral-small-2506', messages, temperature:0.3, max_tokens:1500 })
      });
      const data = await res.json();
      const reply = data.choices[0].message.content;
      chat.messages.push({ role: 'assistant', content: reply, timestamp: Date.now() });
    } catch(e) {
      chat.messages.push({ role: 'assistant', content: '❌ Ошибка соединения с ИИ.', timestamp: Date.now() });
    }
    await sb.from('dirmess_chats').upsert(chat);
    isWaitingAI = false;
    renderAIChat();
    updateSendButton();
  }

  function updateSendButton() {
    $('aiSendBtn').disabled = !$('aiUserInput').value.trim() || isWaitingAI;
  }

  // ===================== ОБЩАЯ СТЕНА =====================
  let wallSubscription = null;

  async function renderWall() {
    const container = $('wallMessages');
    let query = sb.from('dirmess_wall_messages').select('*').order('created_at', { ascending: false }).limit(50);
    if (wallFilterTag) {
      // Фильтрация по тегу на клиенте, т.к. tags у пользователей в другой таблице
      // Загружаем сообщения, потом фильтруем.
    }
    const { data } = await query;
    if (!data) return;
    container.innerHTML = '';
    let messages = data;
    if (wallFilterTag) {
      // Получить всех пользователей с этим тегом, потом фильтровать
      const { data: users } = await sb.from('users').select('login').contains('tags', [wallFilterTag]);
      const logins = users ? users.map(u => u.login) : [];
      messages = messages.filter(m => logins.includes(m.user_login));
    }
    messages.forEach(m => {
      const el = buildWallMessageEl(m);
      container.appendChild(el);
    });
    container.scrollTop = 0;
  }

  function buildWallMessageEl(msg) {
    const div = document.createElement('div');
    div.className = 'wall-message';
    div.innerHTML = `
      <div class="wall-message-avatar"><img src="${msg.user_avatar || 'default-avatar.png'}"></div>
      <div class="wall-message-body">
        <div class="wall-message-header">
          <span class="wall-message-author" data-login="${msg.user_login}">${escapeHtml(msg.user_name || msg.user_login)}</span>
          <span class="wall-message-time">${new Date(msg.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="wall-message-text">${escapeHtml(msg.message)}</div>
        <div class="wall-tags" id="tags-${msg.id}"></div>
      </div>
    `;
    // Загрузить теги автора
    loadUserTags(msg.user_login).then(tags => {
      const tagsDiv = div.querySelector(`#tags-${msg.id}`);
      tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'wall-tag';
        span.textContent = tag;
        span.onclick = () => filterByTag(tag);
        tagsDiv.appendChild(span);
      });
    });
    div.querySelector('.wall-message-author').onclick = () => showProfile(msg.user_login);
    return div;
  }

  async function loadUserTags(login) {
    const { data } = await sb.from('users').select('tags').eq('login', login).single();
    return data ? data.tags : [];
  }

  function filterByTag(tag) {
    wallFilterTag = tag;
    $('tagFilterContainer').style.display = 'flex';
    $('activeTag').textContent = tag;
    renderWall();
  }

  function clearTagFilter() {
    wallFilterTag = null;
    $('tagFilterContainer').style.display = 'none';
    renderWall();
  }

  async function sendWallMessage() {
    const input = $('wallMessageInput');
    const text = input.value.trim();
    if (!text || !currentUser) return;
    await sb.from('dirmess_wall_messages').insert({
      user_login: currentUser.login,
      user_name: currentUser.name,
      user_avatar: currentUser.avatar,
      message: text
    });
    input.value = '';
    renderWall();
  }

  // Realtime подписка на новые сообщения стены
  function subscribeToWall() {
    if (wallSubscription) sb.removeChannel(wallSubscription);
    wallSubscription = sb
      .channel('wall-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dirmess_wall_messages' }, payload => {
        const msg = payload.new;
        const container = $('wallMessages');
        const el = buildWallMessageEl(msg);
        container.insertBefore(el, container.firstChild);
      })
      .subscribe();
  }

  // ===================== ПОИСК ПО ТЕГАМ =====================
  async function searchUsersByTag() {
    const tag = prompt('Введите тег для поиска людей:');
    if (!tag) return;
    const { data: users } = await sb.from('users').select('login, name, avatar, tags').contains('tags', [tag.trim()]);
    if (users && users.length > 0) {
      alert('Найдено пользователей с тегом "' + tag + '": ' + users.map(u => u.name || u.login).join(', '));
    } else {
      toast('Поиск', 'Никого не найдено', 'info');
    }
  }

  // ===================== ПРОФИЛЬ =====================
  async function showProfile(login) {
    const { data } = await sb.from('users').select('*').eq('login', login).single();
    if (!data) return;
    const modal = $('profileModal');
    $('profileModalTitle').textContent = data.name || data.login;
    $('profileModalBody').innerHTML = `
      <img src="${data.avatar || 'default-avatar.png'}" class="profile-avatar">
      <div class="profile-name">${escapeHtml(data.name || '')}</div>
      <div class="profile-login">@${escapeHtml(data.login)}</div>
      <div class="profile-tags">${(data.tags||[]).map(t => `<span class="profile-tag">${escapeHtml(t)}</span>`).join('')}</div>
    `;
    modal.style.display = 'flex';
  }

  function closeProfileModal() {
    $('profileModal').style.display = 'none';
  }

  // ===================== ИНИЦИАЛИЗАЦИЯ =====================
  function setupListeners() {
    // Авторизация
    $('doLoginBtn').onclick = login;
    $('doRegisterBtn').onclick = register;
    $('tabLogin').onclick = () => { $('tabLogin').classList.add('active'); $('tabRegister').classList.remove('active'); $('loginForm').style.display='block'; $('registerForm').style.display='none'; };
    $('tabRegister').onclick = () => { $('tabRegister').classList.add('active'); $('tabLogin').classList.remove('active'); $('registerForm').style.display='block'; $('loginForm').style.display='none'; };

    // Навигация
    document.querySelectorAll('.view-tab').forEach(tab => tab.onclick = () => switchView(tab.dataset.view));
    $('sidebarToggle').onclick = () => {
      const sidebar = $('sidebar');
      if (window.innerWidth <= 768) sidebar.classList.toggle('open');
      else sidebar.classList.toggle('collapsed');
    };
    $('newAiChatBtn').onclick = createNewAIChat;
    $('aiSendBtn').onclick = sendAIMessage;
    $('aiUserInput').oninput = updateSendButton;
    $('aiUserInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); } };
    $('wallSendBtn').onclick = sendWallMessage;
    $('wallMessageInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWallMessage(); } };
    $('clearTagFilter').onclick = clearTagFilter;
    $('searchTagsBtn').onclick = searchUsersByTag;
    $('closeProfileModal').onclick = closeProfileModal;
    $('profileModal').onclick = e => { if (e.target === $('profileModal')) closeProfileModal(); };
    $('dropdownLogout').onclick = logout;
    $('dropdownProfile').onclick = () => showProfile(currentUser.login);
    $('userMenuBtn').onclick = e => { e.stopPropagation(); $('userDropdown').style.display = $('userDropdown').style.display === 'flex' ? 'none' : 'flex'; };
    document.addEventListener('click', () => { if ($('userDropdown').style.display === 'flex') $('userDropdown').style.display = 'none'; });
  }

  function logout() {
    currentUser = null;
    localStorage.removeItem('dirmess_user');
    $('mainUI').style.display = 'none';
    $('authScreen').style.display = 'flex';
    if (wallSubscription) sb.removeChannel(wallSubscription);
  }

  (async function init() {
    await fetchMistralKey();
    const saved = localStorage.getItem('dirmess_user');
    if (saved) {
      currentUser = JSON.parse(saved);
      showMainUI();
      subscribeToWall();
    } else {
      $('welcomeScreen').style.display = 'none';
      $('authScreen').style.display = 'flex';
    }
    setupListeners();
  })();
})();
