// ============================================================
// AGRIDEEPAI – Frontend Application
// ============================================================

// --- DOM refs ---
const sidebar = document.getElementById('sidebar');
const openSidebarBtn = document.getElementById('openSidebarBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const chatList = document.getElementById('chatList');
const newChatBtn = document.getElementById('newChatBtn');
const messageList = document.getElementById('messageList');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const authSidebarBtn = document.getElementById('authSidebarBtn');
const attachBtn = document.getElementById('attachBtn');
const chips = document.querySelectorAll('.chip');
const chatTitle = document.getElementById('chatTitle');
const authModal = document.getElementById('authModal');
const authModalBody = document.getElementById('authModalBody');
const modalClose = document.querySelector('.modal-close');
const composer = document.getElementById('composer');

// --- State ---
let state = {
  activeChatId: null,
  chats: [],
  messages: [],
  isGenerating: false,
  abortController: null,
  supabase: null,
  currentUser: null,
  attachments: [],
};

// --- Supabase init ---
async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    state.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

    state.supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        state.currentUser = session.user;
        updateAuthUI();
        loadCloudConversations();
      } else {
        state.currentUser = null;
        updateAuthUI();
        loadLocalConversations();
      }
    });

    const { data: { session } } = await state.supabase.auth.getSession();
    if (session) {
      state.currentUser = session.user;
      updateAuthUI();
      await loadCloudConversations();
    } else {
      updateAuthUI();
      loadLocalConversations();
    }
  } catch (err) {
    console.error('Supabase init error:', err);
    loadLocalConversations();
  }
}

// --- Auth UI ---
function updateAuthUI() {
  if (state.currentUser) {
    const name = state.currentUser.email?.split('@')[0] || 'User';
    authSidebarBtn.textContent = '👤 ' + name;
    authSidebarBtn.onclick = () => openSettingsModal();
  } else {
    authSidebarBtn.textContent = 'Sign In';
    authSidebarBtn.onclick = () => openAuthModal('login');
  }
}

// --- API helper ---
async function apiFetch(endpoint, options = {}) {
  const session = await state.supabase.auth.getSession();
  const token = session.data.session?.access_token;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(endpoint, { ...options, headers });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Request failed');
  }
  return res;
}

// --- Local storage ---
function loadLocalConversations() {
  const stored = localStorage.getItem('agrideep_local_chats');
  state.chats = stored ? JSON.parse(stored) : [];
  const currentId = localStorage.getItem('agrideep_local_current');
  if (currentId && state.chats.some(c => c.id === currentId)) {
    state.activeChatId = currentId;
  } else {
    state.activeChatId = null;
  }
  renderChatList();
  if (state.activeChatId) {
    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (chat) {
      state.messages = chat.messages || [];
      renderMessages();
      chatTitle.textContent = chat.title || 'New Chat';
    }
  } else {
    state.messages = [];
    renderMessages();
    chatTitle.textContent = 'AgriDeepAI';
  }
}

function saveLocalConversations() {
  localStorage.setItem('agrideep_local_chats', JSON.stringify(state.chats));
  if (state.activeChatId) {
    localStorage.setItem('agrideep_local_current', state.activeChatId);
  } else {
    localStorage.removeItem('agrideep_local_current');
  }
}

// --- Cloud conversations ---
async function loadCloudConversations() {
  if (!state.currentUser) return;
  try {
    const res = await apiFetch('/api/chat/conversations');
    state.chats = await res.json();
    renderChatList();
    if (state.activeChatId) {
      const exists = state.chats.some(c => c.id === state.activeChatId);
      if (!exists) state.activeChatId = null;
    }
    if (state.activeChatId) {
      await loadCloudMessages(state.activeChatId);
    } else {
      state.messages = [];
      renderMessages();
      chatTitle.textContent = 'AgriDeepAI';
    }
  } catch (err) { console.error(err); }
}

async function loadCloudMessages(chatId) {
  if (!state.currentUser) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
    state.messages = await res.json();
    const chat = state.chats.find(c => c.id === chatId);
    if (chat) chatTitle.textContent = chat.title || 'New Chat';
    renderMessages();
    renderChatList();
  } catch (err) { console.error(err); }
}

// --- Render chat list ---
function renderChatList() {
  chatList.innerHTML = '';
  if (!state.chats.length) {
    chatList.innerHTML = '<div style="text-align:center;color:#484f58;padding:1.5rem 0;font-size:0.9rem;">No chats yet</div>';
    return;
  }
  const sorted = [...state.chats].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    const da = a.updated_at || a.updatedAt || a.createdAt;
    const db = b.updated_at || b.updatedAt || b.createdAt;
    return new Date(db) - new Date(da);
  });
  sorted.forEach(chat => {
    const div = document.createElement('div');
    div.className = `chat-item${chat.id === state.activeChatId ? ' active' : ''}`;
    div.dataset.id = chat.id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    titleSpan.textContent = chat.title || 'New Chat';
    if (chat.pinned) {
      const pin = document.createElement('span');
      pin.className = 'pin-icon';
      pin.textContent = '📌';
      titleSpan.prepend(pin);
    }
    div.appendChild(titleSpan);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const pinBtn = document.createElement('button');
    pinBtn.textContent = chat.pinned ? '📌' : '📍';
    pinBtn.title = chat.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', e => { e.stopPropagation(); togglePin(chat.id); });
    actions.appendChild(pinBtn);

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', e => { e.stopPropagation(); renameChat(chat.id); });
    actions.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteChat(chat.id); });
    actions.appendChild(delBtn);

    div.appendChild(actions);
    div.addEventListener('click', () => selectChat(chat.id));
    chatList.appendChild(div);
  });
}

// --- Render messages ---
function renderMessages() {
  messageList.innerHTML = '';
  if (!state.messages.length) {
    welcomeScreen.style.display = 'flex';
    messageList.style.display = 'none';
    return;
  }
  welcomeScreen.style.display = 'none';
  messageList.style.display = 'flex';

  state.messages.forEach((msg, index) => {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${msg.role}`;

    if (msg.role === 'assistant') {
      const header = document.createElement('div');
      header.className = 'assistant-header';
      header.innerHTML = '<img src="/logo.png" alt="AgriDeepAI" /> AgriDeepAI';
      msgDiv.appendChild(header);
    }

    const contentSpan = document.createElement('span');
    contentSpan.textContent = msg.content;
    msgDiv.appendChild(contentSpan);

    // Sources / files
    if (msg.files && msg.files.length > 0) {
      const fileDiv = document.createElement('div');
      fileDiv.style.cssText = 'font-size:0.8rem;margin-top:0.3rem;opacity:0.7;';
      msg.files.forEach(f => {
        if (f.sources) {
          const sourcesDiv = document.createElement('div');
          sourcesDiv.className = 'sources';
          sourcesDiv.innerHTML = '<strong>Sources:</strong><ul style="list-style:none;padding-left:0.5rem;margin:0.2rem 0;">' +
            f.sources.map(s => `<li style="margin:0.1rem 0;"><a href="${s.url}" target="_blank">${s.title || s.url}</a></li>`).join('') +
            '</ul>';
          msgDiv.appendChild(sourcesDiv);
        } else if (f.public_url) {
          const link = document.createElement('a');
          link.href = f.public_url;
          link.target = '_blank';
          link.textContent = '📎 ' + (f.filename || 'File');
          fileDiv.appendChild(link);
          fileDiv.appendChild(document.createTextNode(' '));
        }
      });
      if (fileDiv.children.length > 0) msgDiv.appendChild(fileDiv);
    }

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(msg.content).then(() => showToast('Copied!'));
    });
    actionsDiv.appendChild(copyBtn);

    if (msg.role === 'user') {
      const editBtn = document.createElement('button');
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', () => editUserMessage(index));
      actionsDiv.appendChild(editBtn);
    }

    if (msg.role === 'assistant') {
      const regenBtn = document.createElement('button');
      regenBtn.textContent = '🔄';
      regenBtn.title = 'Regenerate';
      regenBtn.addEventListener('click', () => regenerateMessage(index));
      actionsDiv.appendChild(regenBtn);
    }

    msgDiv.appendChild(actionsDiv);
    row.appendChild(msgDiv);
    messageList.appendChild(row);
  });

  const container = document.getElementById('chatContainer');
  if (isNearBottom(container)) container.scrollTop = container.scrollHeight;
}

function isNearBottom(container, threshold = 150) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

function showToast(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#238636;color:#fff;padding:0.5rem 1.2rem;border-radius:8px;font-size:0.9rem;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:9999;opacity:0;transition:opacity 0.3s;';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.style.opacity = '1');
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
}

// --- Chat CRUD ---
function createLocalChat(title = 'New Chat') {
  const chat = {
    id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    title,
    messages: [],
    pinned: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  state.chats.unshift(chat);
  saveLocalConversations();
  renderChatList();
  return chat;
}

async function createChat(title = 'New Chat') {
  if (state.currentUser) {
    try {
      const res = await apiFetch('/api/chat/conversations', { method: 'POST', body: JSON.stringify({ title }) });
      const chat = await res.json();
      state.chats.unshift(chat);
      renderChatList();
      return chat;
    } catch (err) {
      showToast('Failed to create chat');
      return null;
    }
  } else {
    return createLocalChat(title);
  }
}

async function selectChat(id) {
  state.activeChatId = id;
  if (state.currentUser) {
    await loadCloudMessages(id);
    renderChatList();
  } else {
    const chat = state.chats.find(c => c.id === id);
    if (chat) {
      state.messages = chat.messages || [];
      renderMessages();
      chatTitle.textContent = chat.title || 'New Chat';
      renderChatList();
      saveLocalConversations();
    }
  }
  if (window.innerWidth < 768) sidebar.classList.remove('open');
}

async function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  if (state.currentUser) {
    try {
      await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      state.chats = state.chats.filter(c => c.id !== id);
      if (state.activeChatId === id) {
        state.activeChatId = null;
        state.messages = [];
        renderMessages();
        chatTitle.textContent = 'AgriDeepAI';
      }
      renderChatList();
    } catch (err) { showToast('Failed to delete'); }
  } else {
    state.chats = state.chats.filter(c => c.id !== id);
    if (state.activeChatId === id) {
      state.activeChatId = null;
      state.messages = [];
      renderMessages();
      chatTitle.textContent = 'AgriDeepAI';
    }
    saveLocalConversations();
    renderChatList();
  }
}

async function renameChat(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  const newTitle = prompt('New title:', chat.title);
  if (!newTitle || !newTitle.trim()) return;
  if (state.currentUser) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title: newTitle.trim() }) });
      const updated = await res.json();
      const idx = state.chats.findIndex(c => c.id === id);
      if (idx !== -1) state.chats[idx] = updated;
      renderChatList();
      if (state.activeChatId === id) chatTitle.textContent = updated.title;
    } catch (err) { showToast('Failed to rename'); }
  } else {
    chat.title = newTitle.trim();
    chat.updatedAt = new Date().toISOString();
    saveLocalConversations();
    renderChatList();
    if (state.activeChatId === id) chatTitle.textContent = chat.title;
  }
}

async function togglePin(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  if (state.currentUser) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ pinned: !chat.pinned }) });
      const updated = await res.json();
      const idx = state.chats.findIndex(c => c.id === id);
      if (idx !== -1) state.chats[idx] = updated;
      renderChatList();
    } catch (err) { showToast('Failed to update pin'); }
  } else {
    chat.pinned = !chat.pinned;
    chat.updatedAt = new Date().toISOString();
    saveLocalConversations();
    renderChatList();
  }
}

// --- Composer helpers ---
function resizeComposer() {
  messageInput.style.height = '0px';
  const maxHeight = 120;
  const sh = messageInput.scrollHeight;
  messageInput.style.height = Math.min(sh, maxHeight) + 'px';
  messageInput.style.overflowY = sh > maxHeight ? 'auto' : 'hidden';
}

function updateSendButton() {
  const has = messageInput.value.trim() !== '' || state.attachments.length > 0;
  sendBtn.style.opacity = has ? '1' : '0.35';
}

function showFilePreview() {
  const old = document.getElementById('filePreviewContainer');
  if (old) old.remove();
  if (!state.attachments.length) return;
  const container = document.createElement('div');
  container.id = 'filePreviewContainer';
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;padding:0.25rem 0.5rem;';
  state.attachments.forEach((f, idx) => {
    const pill = document.createElement('span');
    pill.style.cssText = 'background:#21262d;padding:0.2rem 0.6rem;border-radius:16px;font-size:0.8rem;display:flex;align-items:center;gap:0.3rem;color:#c9d1d9;border:1px solid #30363d;';
    pill.textContent = f.name + ' (' + (f.size/1024).toFixed(0) + 'KB)';
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.style.cssText = 'background:none;border:none;cursor:pointer;font-weight:bold;color:#8b949e;padding:0 2px;';
    rm.addEventListener('click', () => {
      state.attachments.splice(idx, 1);
      showFilePreview();
      updateSendButton();
    });
    pill.appendChild(rm);
    container.appendChild(pill);
  });
  composer.parentNode.insertBefore(container, composer);
}

// --- Send message ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && state.attachments.length === 0) return;
  if (state.isGenerating) return;

  let chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    const title = text.substring(0, 30) + (text.length > 30 ? '...' : '') || 'New Chat';
    chat = await createChat(title);
    if (!chat) return;
    state.activeChatId = chat.id;
    state.messages = [];
    chatTitle.textContent = chat.title;
    if (!state.currentUser) {
      chat.messages = state.messages;
      saveLocalConversations();
    }
  }

  // User message
  const userMsg = {
    id: 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    role: 'user',
    content: text || '[File attached]',
    files: state.attachments.map(f => ({ filename: f.name, mime_type: f.type, size: f.size })),
    created_at: new Date().toISOString(),
  };
  state.messages.push(userMsg);
  if (!state.currentUser) {
    chat.messages = state.messages;
    saveLocalConversations();
  }
  renderMessages();

  messageInput.value = '';
  const atts = [...state.attachments];
  state.attachments = [];
  showFilePreview();
  resizeComposer();
  updateSendButton();
  messageInput.disabled = true;

  // Assistant placeholder
  const assistantMsg = {
    id: 'assist_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    role: 'assistant',
    content: '',
    files: [],
    created_at: new Date().toISOString(),
  };
  state.messages.push(assistantMsg);
  if (!state.currentUser) {
    chat.messages = state.messages;
    saveLocalConversations();
  }
  renderMessages();

  state.isGenerating = true;
  sendBtn.classList.add('generating');
  sendBtn.disabled = false;
  state.abortController = new AbortController();

  try {
    let response;
    const formData = new FormData();
    formData.append('message', text || '');
    formData.append('search', 'true');
    atts.forEach(f => formData.append('file', f));

    if (state.currentUser) {
      const session = await state.supabase.auth.getSession();
      const token = session.data.session?.access_token;
      response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: state.abortController.signal,
      });
    } else {
      const payload = {
        messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      };
      response = await fetch('/api/chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: state.abortController.signal,
      });
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              full += parsed.text;
              const last = state.messages[state.messages.length - 1];
              if (last && last.role === 'assistant') {
                last.content = full;
                if (!state.currentUser) {
                  chat.messages = state.messages;
                  saveLocalConversations();
                }
                renderMessages();
              }
            } else if (parsed.sources) {
              const last = state.messages[state.messages.length - 1];
              if (last && last.role === 'assistant') {
                if (!last.files) last.files = [];
                last.files.push({ sources: parsed.sources });
                if (!state.currentUser) {
                  chat.messages = state.messages;
                  saveLocalConversations();
                }
                renderMessages();
              }
            }
          } catch (e) {}
        }
      }
    }

    if (state.currentUser) {
      await loadCloudMessages(chat.id);
      await loadCloudConversations();
    } else {
      chat.messages = state.messages;
      saveLocalConversations();
      renderMessages();
      renderChatList();
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant') {
        last.status = 'stopped';
        if (!state.currentUser) {
          chat.messages = state.messages;
          saveLocalConversations();
        }
        renderMessages();
      }
    } else {
      console.error(err);
      showToast('Error: ' + err.message);
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        state.messages.pop();
        if (!state.currentUser) {
          chat.messages = state.messages;
          saveLocalConversations();
        }
        renderMessages();
      }
    }
  } finally {
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    messageInput.disabled = false;
    state.abortController = null;
    updateSendButton();
  }
}

function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    messageInput.disabled = false;
    updateSendButton();
  }
}

// --- Edit user message ---
async function editUserMessage(index) {
  const msg = state.messages[index];
  if (!msg || msg.role !== 'user') return;
  const newContent = prompt('Edit your message:', msg.content);
  if (newContent === null || newContent.trim() === '') return;
  const trimmed = newContent.trim();

  if (state.currentUser) {
    try {
      await apiFetch(`/api/chat/messages/${msg.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: trimmed, truncate: true }),
      });
      msg.content = trimmed;
      state.messages = state.messages.slice(0, index + 1);
      const chat = state.chats.find(c => c.id === state.activeChatId);
      if (!state.currentUser && chat) {
        chat.messages = state.messages;
        saveLocalConversations();
      }
      renderMessages();
      showToast('Message updated. Send a new message to continue.');
    } catch (err) {
      showToast('Failed to edit: ' + err.message);
    }
  } else {
    msg.content = trimmed;
    state.messages = state.messages.slice(0, index + 1);
    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (chat) {
      chat.messages = state.messages;
      saveLocalConversations();
      renderMessages();
    }
    showToast('Message updated. Send a new message to continue.');
  }
}

// --- Regenerate ---
async function regenerateMessage(index) {
  const msg = state.messages[index];
  if (!msg || msg.role !== 'assistant') return;
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;

  if (!state.currentUser) {
    // Guest: truncate and re-send last user message
    state.messages = state.messages.slice(0, index);
    const lastUser = state.messages[state.messages.length - 1];
    if (lastUser && lastUser.role === 'user') {
      chat.messages = state.messages;
      saveLocalConversations();
      renderMessages();
      await sendGuestMessage(lastUser.content, chat);
    }
    return;
  }

  try {
    const res = await apiFetch(`/api/chat/conversations/${chat.id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ messageIndex: index }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    state.messages = state.messages.slice(0, index);
    const newAssistant = {
      id: 'assist_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      role: 'assistant',
      content: '',
      files: [],
      created_at: new Date().toISOString(),
    };
    state.messages.push(newAssistant);
    renderMessages();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              full += parsed.text;
              const last = state.messages[state.messages.length - 1];
              if (last && last.role === 'assistant') {
                last.content = full;
                renderMessages();
              }
            }
          } catch (e) {}
        }
      }
    }
    await loadCloudMessages(chat.id);
    await loadCloudConversations();
  } catch (err) {
    showToast('Regenerate failed: ' + err.message);
  }
}

// --- Guest send helper ---
async function sendGuestMessage(text, chat) {
  const payload = {
    messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
  };

  state.isGenerating = true;
  sendBtn.classList.add('generating');
  sendBtn.disabled = false;
  state.abortController = new AbortController();

  try {
    const response = await fetch('/api/chat/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: state.abortController.signal,
    });
    if (!response.ok) throw new Error('AI request failed');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    const newAssistant = {
      id: 'assist_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      role: 'assistant',
      content: '',
      files: [],
      created_at: new Date().toISOString(),
    };
    state.messages.push(newAssistant);
    chat.messages = state.messages;
    saveLocalConversations();
    renderMessages();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              full += parsed.text;
              const last = state.messages[state.messages.length - 1];
              if (last && last.role === 'assistant') {
                last.content = full;
                renderMessages();
              }
            }
          } catch (e) {}
        }
      }
    }
    chat.messages = state.messages;
    saveLocalConversations();
    renderMessages();
    renderChatList();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Error: ' + err.message);
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        state.messages.pop();
        chat.messages = state.messages;
        saveLocalConversations();
        renderMessages();
      }
    }
  } finally {
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    state.abortController = null;
    updateSendButton();
  }
}

// --- Auth Modal ---
function openAuthModal(mode = 'login') {
  authModal.classList.remove('hidden');
  renderAuthForm(mode);
}
function closeAuthModal() {
  authModal.classList.add('hidden');
}
modalClose.addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e) => {
  if (e.target === authModal) closeAuthModal();
});

function renderAuthForm(mode) {
  const isLogin = mode === 'login';
  authModalBody.innerHTML = `
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div id="authError" class="error-msg" style="display:none;"></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com" />
    <label>Password</label>
    <input type="password" id="authPassword" placeholder="••••••••" />
    ${!isLogin ? `<label>Full Name (optional)</label><input type="text" id="authFullName" placeholder="Your name" />` : ''}
    <button class="btn-primary" id="authSubmitBtn">${isLogin ? 'Sign In' : 'Sign Up'}</button>
    <div class="toggle-link" id="authToggle">${isLogin ? 'Create an account' : 'Already have an account? Sign in'}</div>
    ${!isLogin ? `<div id="verifySection" style="display:none; margin-top:1rem;">
      <p>We sent a verification code to your email. Enter it below:</p>
      <input type="text" id="verifyCode" placeholder="6-digit code" />
      <button class="btn-primary" id="verifyBtn">Verify</button>
      <button id="resendVerifyBtn" style="background:none;border:none;color:#58a6ff;cursor:pointer;margin-top:0.5rem;">Resend code</button>
    </div>` : ''}
  `;

  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleLink = document.getElementById('authToggle');
  const errorDiv = document.getElementById('authError');

  toggleLink.addEventListener('click', () => {
    renderAuthForm(isLogin ? 'signup' : 'login');
  });

  submitBtn.addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    errorDiv.style.display = 'none';
    if (!email || !password) {
      errorDiv.textContent = 'Email and password required.';
      errorDiv.style.display = 'block';
      return;
    }
    try {
      if (isLogin) {
        const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        closeAuthModal();
      } else {
        const fullName = document.getElementById('authFullName')?.value.trim() || email.split('@')[0];
        const { data, error } = await state.supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        document.getElementById('verifySection').style.display = 'block';
        submitBtn.disabled = true;
        const userId = data.user.id;
        document.getElementById('verifyBtn').addEventListener('click', async () => {
          const code = document.getElementById('verifyCode').value.trim();
          if (!code) { showToast('Enter the code'); return; }
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, code }),
          });
          const result = await res.json();
          if (res.ok) {
            showToast('Email verified! You can now sign in.');
            closeAuthModal();
            renderAuthForm('login');
          } else {
            showToast(result.error || 'Verification failed');
          }
        });
        document.getElementById('resendVerifyBtn').addEventListener('click', async () => {
          await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          showToast('New code sent');
        });
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Authentication failed';
      errorDiv.style.display = 'block';
    }
  });
}

// --- Settings Modal ---
function openSettingsModal() {
  if (!state.currentUser) return;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'settingsModal';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" id="settingsClose">&times;</button>
      <h2>Account Settings</h2>
      <p style="margin-bottom:1rem;color:#8b949e;">Email: ${state.currentUser.email}</p>
      <div id="settingsError" class="error-msg" style="display:none;"></div>
      <h3>Change Password</h3>
      <label>Current Password</label>
      <input type="password" id="currentPassword" placeholder="Current password" />
      <label>New Password</label>
      <input type="password" id="newPassword" placeholder="New password" />
      <button class="btn-primary" id="changePasswordBtn">Change Password</button>
      <hr />
      <h3>Change Email</h3>
      <label>New Email</label>
      <input type="email" id="newEmail" placeholder="New email" />
      <button class="btn-primary" id="changeEmailBtn">Change Email</button>
      <hr />
      <h3 style="color:#f85149;">Delete Account</h3>
      <p style="color:#f85149;font-size:0.85rem;">This action is permanent and cannot be undone.</p>
      <button class="btn-primary" id="deleteAccountBtn" style="background:#da3633;">Delete Account</button>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#settingsClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  modal.querySelector('#changePasswordBtn').addEventListener('click', async () => {
    const currentPassword = modal.querySelector('#currentPassword').value;
    const newPassword = modal.querySelector('#newPassword').value;
    if (!currentPassword || !newPassword) {
      modal.querySelector('#settingsError').textContent = 'Both fields required.';
      modal.querySelector('#settingsError').style.display = 'block';
      return;
    }
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast('Password changed');
      modal.querySelector('#settingsError').style.display = 'none';
      modal.querySelector('#currentPassword').value = '';
      modal.querySelector('#newPassword').value = '';
    } catch (err) {
      modal.querySelector('#settingsError').textContent = err.message;
      modal.querySelector('#settingsError').style.display = 'block';
    }
  });

  modal.querySelector('#changeEmailBtn').addEventListener('click', async () => {
    const newEmail = modal.querySelector('#newEmail').value.trim();
    if (!newEmail) {
      modal.querySelector('#settingsError').textContent = 'New email required.';
      modal.querySelector('#settingsError').style.display = 'block';
      return;
    }
    try {
      await apiFetch('/api/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail }),
      });
      showToast('Email change requested. Verify new email.');
      modal.querySelector('#settingsError').style.display = 'none';
      modal.querySelector('#newEmail').value = '';
    } catch (err) {
      modal.querySelector('#settingsError').textContent = err.message;
      modal.querySelector('#settingsError').style.display = 'block';
    }
  });

  modal.querySelector('#deleteAccountBtn').addEventListener('click', async () => {
    if (!confirm('Permanently delete your account? This cannot be undone!')) return;
    if (!confirm('All your conversations will be lost. Continue?')) return;
    try {
      await apiFetch('/api/auth/delete-account', { method: 'DELETE' });
      showToast('Account deleted');
      await state.supabase.auth.signOut();
      closeModal();
    } catch (err) {
      modal.querySelector('#settingsError').textContent = err.message;
      modal.querySelector('#settingsError').style.display = 'block';
    }
  });
}

// --- Event listeners ---
newChatBtn.addEventListener('click', async () => {
  const chat = await createChat('New Chat');
  if (chat) selectChat(chat.id);
});

openSidebarBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

sendBtn.addEventListener('click', () => {
  if (state.isGenerating) {
    stopGeneration();
  } else {
    sendMessage();
  }
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
messageInput.addEventListener('input', () => {
  resizeComposer();
  updateSendButton();
});

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    messageInput.value = chip.dataset.prompt;
    updateSendButton();
    sendMessage();
  });
});

attachBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,.txt,.doc,.docx';
  input.multiple = true;
  input.onchange = (e) => {
    const files = Array.from(e.target.files);
    const maxSize = 10 * 1024 * 1024;
    if (files.some(f => f.size > maxSize)) {
      showToast('Files must be smaller than 10MB.');
      return;
    }
    state.attachments = state.attachments.concat(files);
    showFilePreview();
    updateSendButton();
  };
  input.click();
});

// --- Close sidebar on backdrop click (mobile) ---
document.addEventListener('click', (e) => {
  if (window.innerWidth < 768) {
    const isOpen = sidebar.classList.contains('open');
    if (isOpen && !sidebar.contains(e.target) && e.target !== openSidebarBtn) {
      sidebar.classList.remove('open');
    }
  }
});

// --- Init ---
initSupabase();
updateSendButton();
