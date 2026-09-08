// ============================================================
// AGRIDEEPAI – Full Frontend Application (Complete)
// ============================================================

// --- Logging helper ---
const log = (msg, type = 'info') => {
  const timestamp = new Date().toISOString();
  console.log(`[FRONTEND] [${timestamp}] [${type.toUpperCase()}] ${msg}`);
};

// --- DOM refs ---
const sidebar = document.getElementById('sidebar');
const openSidebarBtn = document.getElementById('openSidebarBtn');
const sidebarToggle = document.getElementById('sidebarToggle');
const chatList = document.getElementById('chatList');
const newChatBtn = document.getElementById('newChatBtn');
const messageList = document.getElementById('messageList');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const authSidebarBtn = document.getElementById('authSidebarBtn');
const attachBtn = document.getElementById('attachBtn');
const chips = document.querySelectorAll('.chip');
const authModal = document.getElementById('authModal');
const authModalBody = document.getElementById('authModalBody');
const modalClose = document.querySelectorAll('.modal-close');
const composer = document.getElementById('composer');
const attachmentPreview = document.getElementById('attachmentPreview');
const shareModal = document.getElementById('shareModal');
const shareLinkDisplay = document.getElementById('shareLinkDisplay');
const copyShareLink = document.getElementById('copyShareLink');
const chatMenu = document.getElementById('chatMenu');

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
  editingMessageId: null,
  editingContent: '',
  likedMessages: new Set(),
  dislikedMessages: new Set(),
  contextMenuTarget: null,
};

// --- Supabase init ---
async function initSupabase() {
  log('Initializing Supabase...', 'info');
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    log('Config fetched', 'debug');
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    state.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

    state.supabase.auth.onAuthStateChange((event, session) => {
      log(`Auth state changed: ${event}`, 'info');
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
    log(`Supabase init error: ${err.message}`, 'error');
    loadLocalConversations();
  }
}

// --- Auth UI ---
function updateAuthUI() {
  if (state.currentUser) {
    const displayName = state.currentUser.email?.split('@')[0] || 'User';
    authSidebarBtn.innerHTML = `<i data-lucide="user"></i><span>${displayName}</span>`;
    authSidebarBtn.onclick = () => openSettingsModal();
  } else {
    authSidebarBtn.innerHTML = `<i data-lucide="log-in"></i><span>Sign In</span>`;
    authSidebarBtn.onclick = () => openAuthModal('login');
  }
  window.refreshIcons();
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
  log('Loading local conversations', 'debug');
  const stored = localStorage.getItem('agrideepai_local_chats');
  state.chats = stored ? JSON.parse(stored) : [];
  state.chats = state.chats.filter(c => c.messages && c.messages.length > 0);
  const currentId = localStorage.getItem('agrideepai_local_current');
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
    }
  } else {
    state.messages = [];
    renderMessages();
  }
}

function saveLocalConversations() {
  const validChats = state.chats.filter(c => c.messages && c.messages.length > 0);
  state.chats = validChats;
  localStorage.setItem('agrideepai_local_chats', JSON.stringify(validChats));
  if (state.activeChatId && validChats.some(c => c.id === state.activeChatId)) {
    localStorage.setItem('agrideepai_local_current', state.activeChatId);
  } else {
    localStorage.removeItem('agrideepai_local_current');
  }
  log(`Saved ${validChats.length} local chats`, 'debug');
}

// --- Cloud conversations ---
async function loadCloudConversations() {
  if (!state.currentUser) return;
  log('Loading cloud conversations', 'info');
  try {
    const res = await apiFetch('/api/chat/conversations');
    state.chats = await res.json();
    state.chats = state.chats.filter(c => c.messages && c.messages.length > 0);
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
    }
  } catch (err) {
    log(`Load cloud conversations error: ${err.message}`, 'error');
  }
}

async function loadCloudMessages(chatId) {
  if (!state.currentUser) return;
  log(`Loading messages for chat ${chatId}`, 'debug');
  try {
    const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
    state.messages = await res.json();
    renderMessages();
    renderChatList();
  } catch (err) {
    log(`Load cloud messages error: ${err.message}`, 'error');
  }
}

// --- Render chat list ---
function renderChatList() {
  chatList.innerHTML = '';
  if (!state.chats.length) {
    chatList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem 0;font-size:0.9rem;">No chats yet</div>';
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
    const moreBtn = document.createElement('button');
    moreBtn.innerHTML = `<i data-lucide="more-horizontal" style="width:16px;height:16px;"></i>`;
    moreBtn.title = 'More options';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openChatMenu(e, chat.id);
    });
    actions.appendChild(moreBtn);
    div.appendChild(actions);
    div.addEventListener('click', () => selectChat(chat.id));
    chatList.appendChild(div);
  });
  window.refreshIcons();
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
      header.innerHTML = '<img src="/logo.png" alt="agrideepai" /> agrideepai';
      msgDiv.appendChild(header);
    }

    // Editing state for user messages
    if (state.editingMessageId === msg.id && msg.role === 'user') {
      const editArea = document.createElement('div');
      editArea.style.cssText = 'width:100%;';
      const textarea = document.createElement('textarea');
      textarea.value = state.editingContent;
      textarea.style.cssText =
        'width:100%;padding:0.4rem;border-radius:var(--radius-sm);background:var(--background);color:var(--text);border:1px solid var(--border);resize:vertical;font-family:inherit;font-size:0.95rem;';
      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.3rem;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.className = 'btn-primary';
      saveBtn.style.cssText = 'padding:0.2rem 0.8rem;width:auto;';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText =
        'padding:0.2rem 0.8rem;background:transparent;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);cursor:pointer;';
      cancelBtn.addEventListener('click', () => {
        state.editingMessageId = null;
        renderMessages();
      });
      saveBtn.addEventListener('click', async () => {
        const newContent = textarea.value.trim();
        if (!newContent) return;
        await saveEditedMessage(msg.id, newContent);
      });
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveBtn.click();
        }
        if (e.key === 'Escape') {
          cancelBtn.click();
        }
      });
      btnGroup.appendChild(saveBtn);
      btnGroup.appendChild(cancelBtn);
      editArea.appendChild(textarea);
      editArea.appendChild(btnGroup);
      msgDiv.appendChild(editArea);
      setTimeout(() => textarea.focus(), 50);
    } else {
      const contentSpan = document.createElement('span');
      contentSpan.textContent = msg.content;
      msgDiv.appendChild(contentSpan);
    }

    // Sources / files
    if (msg.files && msg.files.length > 0) {
      const fileDiv = document.createElement('div');
      fileDiv.style.cssText = 'font-size:0.8rem;margin-top:0.3rem;opacity:0.7;';
      msg.files.forEach(f => {
        if (f.sources) {
          const sourcesDiv = document.createElement('div');
          sourcesDiv.className = 'sources';
          sourcesDiv.innerHTML =
            '<strong>Sources:</strong><ul style="list-style:none;padding-left:0.5rem;margin:0.2rem 0;">' +
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

    // Actions (only if not editing)
    if (state.editingMessageId !== msg.id) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions';

      if (msg.role === 'user') {
        // Copy
        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = `<i data-lucide="copy" style="width:16px;height:16px;"></i>`;
        copyBtn.title = 'Copy';
        copyBtn.addEventListener('click', () => copyMessage(msg));
        actionsDiv.appendChild(copyBtn);

        // Edit
        const editBtn = document.createElement('button');
        editBtn.innerHTML = `<i data-lucide="pencil" style="width:16px;height:16px;"></i>`;
        editBtn.title = 'Edit';
        editBtn.addEventListener('click', () => startEditing(msg));
        actionsDiv.appendChild(editBtn);
      }

      if (msg.role === 'assistant') {
        // Copy
        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = `<i data-lucide="copy" style="width:16px;height:16px;"></i>`;
        copyBtn.title = 'Copy';
        copyBtn.addEventListener('click', () => copyMessage(msg));
        actionsDiv.appendChild(copyBtn);

        // Like
        const likeBtn = document.createElement('button');
        const isLiked = state.likedMessages.has(msg.id);
        likeBtn.innerHTML = `<i data-lucide="thumbs-up" style="width:16px;height:16px;"></i>`;
        likeBtn.title = isLiked ? 'Liked' : 'Like';
        if (isLiked) likeBtn.classList.add('liked');
        likeBtn.addEventListener('click', () => toggleLike(msg));
        actionsDiv.appendChild(likeBtn);

        // Dislike
        const dislikeBtn = document.createElement('button');
        const isDisliked = state.dislikedMessages.has(msg.id);
        dislikeBtn.innerHTML = `<i data-lucide="thumbs-down" style="width:16px;height:16px;"></i>`;
        dislikeBtn.title = isDisliked ? 'Disliked' : 'Dislike';
        if (isDisliked) dislikeBtn.classList.add('disliked');
        dislikeBtn.addEventListener('click', () => toggleDislike(msg));
        actionsDiv.appendChild(dislikeBtn);

        // Regenerate
        const regenBtn = document.createElement('button');
        regenBtn.innerHTML = `<i data-lucide="rotate-ccw" style="width:16px;height:16px;"></i>`;
        regenBtn.title = 'Regenerate';
        regenBtn.addEventListener('click', () => regenerateMessage(index));
        actionsDiv.appendChild(regenBtn);

        // Share (assistant message can be shared)
        const shareBtn = document.createElement('button');
        shareBtn.innerHTML = `<i data-lucide="share-2" style="width:16px;height:16px;"></i>`;
        shareBtn.title = 'Share';
        shareBtn.addEventListener('click', () => shareChat(msg.id));
        actionsDiv.appendChild(shareBtn);
      }

      msgDiv.appendChild(actionsDiv);
    }

    row.appendChild(msgDiv);
    messageList.appendChild(row);
  });
  window.refreshIcons();
  const container = document.getElementById('chatContainer');
  if (isNearBottom(container)) container.scrollTop = container.scrollHeight;
}

function isNearBottom(container, threshold = 150) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// --- Toast notification ---
function showToast(message, isError = false) {
  const existing = document.querySelector('.agrideep-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'agrideep-toast';
  toast.textContent = message;
  const bg = isError ? '#e85d5d' : '#2f8f46';
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: bg,
    color: '#fff',
    padding: '0.5rem 1.2rem',
    borderRadius: '10px',
    fontSize: '0.9rem',
    fontWeight: '500',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    zIndex: '9999',
    opacity: '0',
    transition: 'opacity 0.3s, transform 0.3s',
    transform: 'translateX(-50%) translateY(10px)',
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
  log(`Toast: ${message}`, isError ? 'error' : 'info');
}

// --- Copy message ---
async function copyMessage(msg) {
  log('Copying message', 'debug');
  try {
    await navigator.clipboard.writeText(msg.content);
    showToast('Copied!');
  } catch {
    showToast('Unable to copy', true);
  }
}

// --- Like / Dislike ---
function toggleLike(msg) {
  if (state.likedMessages.has(msg.id)) {
    state.likedMessages.delete(msg.id);
  } else {
    state.likedMessages.add(msg.id);
    state.dislikedMessages.delete(msg.id);
  }
  renderMessages();
}
function toggleDislike(msg) {
  if (state.dislikedMessages.has(msg.id)) {
    state.dislikedMessages.delete(msg.id);
  } else {
    state.dislikedMessages.add(msg.id);
    state.likedMessages.delete(msg.id);
  }
  renderMessages();
}

// --- Edit message ---
function startEditing(msg) {
  if (msg.role !== 'user') return;
  state.editingMessageId = msg.id;
  state.editingContent = msg.content;
  renderMessages();
}

async function saveEditedMessage(messageId, newContent) {
  if (!newContent.trim()) return;
  log(`Saving edited message ${messageId}`, 'debug');
  try {
    if (state.currentUser) {
      await apiFetch(`/api/chat/messages/${messageId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: newContent, truncate: true }),
      });
    }
    const msg = state.messages.find(m => m.id === messageId);
    if (msg) msg.content = newContent;
    const idx = state.messages.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      state.messages = state.messages.slice(0, idx + 1);
    }
    state.editingMessageId = null;
    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (chat) {
      chat.messages = state.messages;
      if (!state.currentUser) saveLocalConversations();
    }
    renderMessages();
    showToast('Message updated. Send a new message to continue.');
  } catch (err) {
    log(`Edit error: ${err.message}`, 'error');
    showToast('Failed to edit: ' + err.message, true);
  }
}

// --- Regenerate ---
async function regenerateMessage(index) {
  const msg = state.messages[index];
  if (!msg || msg.role !== 'assistant') return;
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;
  log(`Regenerating message at index ${index}`, 'debug');

  if (!state.currentUser) {
    state.messages = state.messages.slice(0, index);
    const lastUser = state.messages[state.messages.length - 1];
    if (lastUser && lastUser.role === 'user') {
      chat.messages = state.messages;
      if (!state.currentUser) saveLocalConversations();
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
    log(`Regenerate error: ${err.message}`, 'error');
    showToast('Regenerate failed: ' + err.message, true);
  }
}

// --- Guest send helper (for regeneration) ---
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
    if (!state.currentUser) saveLocalConversations();
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
    if (!state.currentUser) saveLocalConversations();
    renderMessages();
    renderChatList();
  } catch (err) {
    if (err.name !== 'AbortError') {
      log(`Guest send error: ${err.message}`, 'error');
      showToast('Error: ' + err.message, true);
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        state.messages.pop();
        chat.messages = state.messages;
        if (!state.currentUser) saveLocalConversations();
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

// --- Share chat (generate public link) ---
async function shareChat(messageId) {
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    showToast('No chat to share', true);
    return;
  }
  if (!state.currentUser) {
    showToast('Please sign in to share chats', true);
    return;
  }
  try {
    const res = await apiFetch(`/api/chat/share/${chat.id}`, { method: 'POST' });
    const data = await res.json();
    shareLinkDisplay.textContent = data.url;
    shareModal.classList.remove('hidden');
    copyShareLink.onclick = () => {
      navigator.clipboard.writeText(data.url).then(() => showToast('Link copied!'));
    };
  } catch (err) {
    log(`Share error: ${err.message}`, 'error');
    showToast('Failed to generate share link: ' + err.message, true);
  }
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
  if (!state.currentUser) saveLocalConversations();
  renderChatList();
  return chat;
}

async function createChat(title = 'New Chat') {
  if (state.currentUser) {
    try {
      const res = await apiFetch('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      const chat = await res.json();
      state.chats.unshift(chat);
      renderChatList();
      return chat;
    } catch (err) {
      log(`Create chat error: ${err.message}`, 'error');
      showToast('Failed to create chat', true);
      return null;
    }
  } else {
    return createLocalChat(title);
  }
}

async function selectChat(id) {
  log(`Selecting chat ${id}`, 'debug');
  state.activeChatId = id;
  if (state.currentUser) {
    await loadCloudMessages(id);
    renderChatList();
  } else {
    const chat = state.chats.find(c => c.id === id);
    if (chat) {
      state.messages = chat.messages || [];
      renderMessages();
      renderChatList();
      saveLocalConversations();
    }
  }
  if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
  chatMenu.classList.add('hidden');
}

async function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  log(`Deleting chat ${id}`, 'info');
  if (state.currentUser) {
    try {
      await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      state.chats = state.chats.filter(c => c.id !== id);
      if (state.activeChatId === id) {
        state.activeChatId = null;
        state.messages = [];
        renderMessages();
      }
      renderChatList();
    } catch (err) {
      log(`Delete error: ${err.message}`, 'error');
      showToast('Failed to delete', true);
    }
  } else {
    state.chats = state.chats.filter(c => c.id !== id);
    if (state.activeChatId === id) {
      state.activeChatId = null;
      state.messages = [];
      renderMessages();
    }
    saveLocalConversations();
    renderChatList();
  }
  chatMenu.classList.add('hidden');
}

async function renameChat(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  const newTitle = prompt('New title:', chat.title);
  if (!newTitle || !newTitle.trim()) return;
  log(`Renaming chat ${id} to "${newTitle}"`, 'info');
  if (state.currentUser) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const updated = await res.json();
      const idx = state.chats.findIndex(c => c.id === id);
      if (idx !== -1) state.chats[idx] = updated;
      renderChatList();
    } catch (err) {
      log(`Rename error: ${err.message}`, 'error');
      showToast('Failed to rename', true);
    }
  } else {
    chat.title = newTitle.trim();
    chat.updatedAt = new Date().toISOString();
    saveLocalConversations();
    renderChatList();
  }
  chatMenu.classList.add('hidden');
}

async function togglePin(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  log(`Toggling pin for chat ${id}`, 'debug');
  if (state.currentUser) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ pinned: !chat.pinned }),
      });
      const updated = await res.json();
      const idx = state.chats.findIndex(c => c.id === id);
      if (idx !== -1) state.chats[idx] = updated;
      renderChatList();
    } catch (err) {
      log(`Pin error: ${err.message}`, 'error');
      showToast('Failed to update pin', true);
    }
  } else {
    chat.pinned = !chat.pinned;
    chat.updatedAt = new Date().toISOString();
    saveLocalConversations();
    renderChatList();
  }
  chatMenu.classList.add('hidden');
}

// --- Context menu for chat items ---
function openChatMenu(e, chatId) {
  e.preventDefault();
  state.contextMenuTarget = chatId;
  const rect = e.target.getBoundingClientRect();
  const menuWidth = 180;
  let left = Math.min(rect.left, window.innerWidth - menuWidth - 10);
  let top = rect.bottom + 5;
  if (top + 200 > window.innerHeight) {
    top = rect.top - 200;
  }
  chatMenu.style.left = left + 'px';
  chatMenu.style.top = top + 'px';
  chatMenu.classList.remove('hidden');

  const buttons = chatMenu.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.onclick = null;
    const action = btn.dataset.action;
    if (action === 'pin') {
      btn.onclick = () => togglePin(chatId);
    } else if (action === 'share') {
      btn.onclick = () => {
        const chat = state.chats.find(c => c.id === chatId);
        if (chat) {
          shareChat(chat.id);
        }
        chatMenu.classList.add('hidden');
      };
    } else if (action === 'rename') {
      btn.onclick = () => renameChat(chatId);
    } else if (action === 'delete') {
      btn.onclick = () => deleteChat(chatId);
    }
  });
  window.refreshIcons();
}

// Close context menu on outside click
document.addEventListener('click', (e) => {
  if (!chatMenu.contains(e.target) && !e.target.closest('.chat-item .actions')) {
    chatMenu.classList.add('hidden');
  }
});

// --- New Chat (no empty chat) ---
function handleNewChat() {
  log('New Chat clicked – clearing view without creating chat', 'info');
  state.activeChatId = null;
  state.messages = [];
  state.editingMessageId = null;
  renderMessages();
  renderChatList();
  messageInput.focus();
  if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
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
  const has = messageInput.value.trim().length > 0 || state.attachments.length > 0;
  sendBtn.disabled = !has;
  sendBtn.style.opacity = has ? '1' : '0.35';
}

function renderAttachments() {
  attachmentPreview.innerHTML = '';
  state.attachments.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.innerHTML = `
      <i data-lucide="file-text" style="width:16px;height:16px;"></i>
      <span>${file.name} (${(file.size / 1024).toFixed(0)}KB)</span>
      <button data-index="${idx}" aria-label="Remove attachment">
        <i data-lucide="x" style="width:14px;height:14px;"></i>
      </button>
    `;
    chip.querySelector('button').addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      state.attachments.splice(idx, 1);
      renderAttachments();
      updateSendButton();
    });
    attachmentPreview.appendChild(chip);
  });
  window.refreshIcons();
}

// --- Send message (chat created on first message) ---
async function sendMessage() {
  const text = messageInput.value.trim();
  const hasText = text.length > 0;
  const hasAttachments = state.attachments.length > 0;
  if (!hasText && !hasAttachments) return;
  if (state.isGenerating) return;

  let chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    const title = text.substring(0, 42) + (text.length > 42 ? '…' : '');
    log(`Creating new chat with title: "${title}"`, 'info');
    const newChat = {
      id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      title: title || 'New conversation',
      messages: [],
      pinned: false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    state.chats.unshift(newChat);
    state.activeChatId = newChat.id;
    if (!state.currentUser) saveLocalConversations();
    renderChatList();   // <-- critical: update sidebar
    chat = newChat;
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
  chat.messages = state.messages;
  if (!state.currentUser) saveLocalConversations();
  renderMessages();

  messageInput.value = '';
  const atts = [...state.attachments];
  state.attachments = [];
  renderAttachments();
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
  chat.messages = state.messages;
  if (!state.currentUser) saveLocalConversations();
  renderMessages();

  state.isGenerating = true;
  sendBtn.classList.add('generating');
  sendBtn.disabled = false;
  state.abortController = new AbortController();

  try {
    let response;
    if (state.currentUser) {
      const formData = new FormData();
      formData.append('message', text || '');
      formData.append('search', 'true');
      atts.forEach(f => formData.append('file', f));
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
                chat.messages = state.messages;
                if (!state.currentUser) saveLocalConversations();
                renderMessages();
              }
            } else if (parsed.sources) {
              const last = state.messages[state.messages.length - 1];
              if (last && last.role === 'assistant') {
                if (!last.files) last.files = [];
                last.files.push({ sources: parsed.sources });
                chat.messages = state.messages;
                if (!state.currentUser) saveLocalConversations();
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
    log('Message sent successfully', 'info');
  } catch (err) {
    if (err.name === 'AbortError') {
      log('Generation stopped by user', 'info');
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant') {
        last.status = 'stopped';
        chat.messages = state.messages;
        if (!state.currentUser) saveLocalConversations();
        renderMessages();
      }
    } else {
      log(`Send error: ${err.message}`, 'error');
      showToast('Error: ' + err.message, true);
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        state.messages.pop();
        chat.messages = state.messages;
        if (!state.currentUser) saveLocalConversations();
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
    log('Stop generation requested', 'info');
    state.abortController.abort();
    state.abortController = null;
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    messageInput.disabled = false;
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
modalClose.forEach(btn => btn.addEventListener('click', closeAuthModal));
authModal.addEventListener('click', (e) => {
  if (e.target === authModal) closeAuthModal();
});

// ======================== UPDATED AUTH FORM WITH CONFIRMATION & STATUS ========================

function renderAuthForm(mode) {
  const isLogin = mode === 'login';
  authModalBody.innerHTML = `
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div id="authError" class="error-msg" style="display:none;"></div>
    <div id="authStatus" class="status-msg" style="display:none;"></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com" />
    <label>Password</label>
    <input type="password" id="authPassword" placeholder="••••••••" />
    ${!isLogin ? `
      <label>Confirm Password</label>
      <input type="password" id="authConfirmPassword" placeholder="Confirm password" />
    ` : ''}
    ${!isLogin ? `<label>Full Name (optional)</label><input type="text" id="authFullName" placeholder="Your name" />` : ''}
    <button class="btn-primary" id="authSubmitBtn" disabled>${isLogin ? 'Sign In' : 'Sign Up'}</button>
    <div class="toggle-link" id="authToggle">${isLogin ? 'Create an account' : 'Already have an account? Sign in'}</div>
    ${!isLogin ? `<div id="verifySection" style="display:none; margin-top:1rem;">
      <p>We sent a verification code to your email. Enter it below:</p>
      <input type="text" id="verifyCode" placeholder="6-digit code" />
      <button class="btn-primary" id="verifyBtn">Verify</button>
      <button id="resendVerifyBtn" style="background:none;border:none;color:var(--accent);cursor:pointer;margin-top:0.5rem;">Resend code</button>
    </div>` : ''}
  `;

  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleLink = document.getElementById('authToggle');
  const errorDiv = document.getElementById('authError');
  const statusDiv = document.getElementById('authStatus');

  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmInput = document.getElementById('authConfirmPassword');

  function checkFields() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    let valid = email && password;
    if (!isLogin) {
      const confirm = confirmInput ? confirmInput.value : '';
      valid = valid && confirm && password === confirm;
    }
    submitBtn.disabled = !valid;
  }
  emailInput.addEventListener('input', checkFields);
  passwordInput.addEventListener('input', checkFields);
  if (confirmInput) confirmInput.addEventListener('input', checkFields);
  checkFields();

  toggleLink.addEventListener('click', () => {
    renderAuthForm(isLogin ? 'signup' : 'login');
  });

  submitBtn.addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const confirm = document.getElementById('authConfirmPassword')?.value || '';
    errorDiv.style.display = 'none';
    statusDiv.style.display = 'none';
    if (!email || !password) {
      errorDiv.textContent = 'Email and password required.';
      errorDiv.style.display = 'block';
      return;
    }
    if (!isLogin && password !== confirm) {
      errorDiv.textContent = 'Passwords do not match.';
      errorDiv.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    statusDiv.textContent = isLogin ? 'Signing in...' : 'Creating account...';
    statusDiv.style.display = 'block';
    try {
      if (isLogin) {
        const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        closeAuthModal();
        showToast('Signed in successfully!');
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
        statusDiv.textContent = 'Verification code sent. Please check your email.';
        statusDiv.style.display = 'block';
        const userId = data.user.id;
        document.getElementById('verifyBtn').addEventListener('click', async () => {
          const code = document.getElementById('verifyCode').value.trim();
          if (!code) {
            errorDiv.textContent = 'Enter the code';
            errorDiv.style.display = 'block';
            return;
          }
          statusDiv.textContent = 'Verifying email...';
          statusDiv.style.display = 'block';
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
            errorDiv.textContent = result.error || 'Verification failed';
            errorDiv.style.display = 'block';
            statusDiv.style.display = 'none';
          }
        });
        document.getElementById('resendVerifyBtn').addEventListener('click', async () => {
          statusDiv.textContent = 'Sending new code...';
          statusDiv.style.display = 'block';
          const res = await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          if (res.ok) {
            showToast('New code sent');
            statusDiv.textContent = 'New code sent. Check your email.';
          } else {
            const err = await res.json();
            showToast(err.error || 'Failed to resend', true);
          }
        });
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Authentication failed';
      errorDiv.style.display = 'block';
      statusDiv.style.display = 'none';
    } finally {
      submitBtn.disabled = false;
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
      <p style="margin-bottom:1rem;color:var(--text-muted);">Email: ${state.currentUser.email}</p>
      <div id="settingsError" class="error-msg" style="display:none;"></div>
      <div id="settingsStatus" class="status-msg" style="display:none;"></div>
      <h3>Change Password</h3>
      <label>Current Password</label>
      <input type="password" id="currentPassword" placeholder="Current password" />
      <label>New Password</label>
      <input type="password" id="newPassword" placeholder="New password (min 8 chars, letters & numbers)" />
      <button class="btn-primary" id="changePasswordBtn">Change Password</button>
      <hr />
      <h3>Change Email</h3>
      <label>New Email</label>
      <input type="email" id="newEmail" placeholder="New email" />
      <button class="btn-primary" id="changeEmailBtn">Change Email</button>
      <hr />
      <h3 style="color:var(--danger);">Delete Account</h3>
      <p style="color:var(--danger);font-size:0.85rem;">This action is permanent and cannot be undone.</p>
      <button class="btn-primary" id="deleteAccountBtn" style="background:var(--danger);">Delete Account</button>
      <hr />
      <button class="btn-primary" id="logoutBtn" style="background:transparent;border:1px solid var(--border);color:var(--text);">Log Out</button>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#settingsClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const errorDiv = modal.querySelector('#settingsError');
  const statusDiv = modal.querySelector('#settingsStatus');

  modal.querySelector('#changePasswordBtn').addEventListener('click', async () => {
    const currentPassword = modal.querySelector('#currentPassword').value;
    const newPassword = modal.querySelector('#newPassword').value;
    if (!currentPassword || !newPassword) {
      errorDiv.textContent = 'Both fields required.';
      errorDiv.style.display = 'block';
      return;
    }
    errorDiv.style.display = 'none';
    statusDiv.textContent = 'Verifying password...';
    statusDiv.style.display = 'block';
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast('Password changed successfully');
      statusDiv.textContent = '';
      modal.querySelector('#currentPassword').value = '';
      modal.querySelector('#newPassword').value = '';
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
    } finally {
      statusDiv.style.display = 'none';
    }
  });

  modal.querySelector('#changeEmailBtn').addEventListener('click', async () => {
    const newEmail = modal.querySelector('#newEmail').value.trim();
    if (!newEmail) {
      errorDiv.textContent = 'New email required.';
      errorDiv.style.display = 'block';
      return;
    }
    errorDiv.style.display = 'none';
    statusDiv.textContent = 'Changing email...';
    statusDiv.style.display = 'block';
    try {
      await apiFetch('/api/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail }),
      });
      showToast('Email change requested. Please verify the new email.');
      modal.querySelector('#newEmail').value = '';
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
    } finally {
      statusDiv.style.display = 'none';
    }
  });

  modal.querySelector('#deleteAccountBtn').addEventListener('click', async () => {
    if (!confirm('Permanently delete your account? This cannot be undone!')) return;
    if (!confirm('All your conversations and data will be lost. Continue?')) return;
    errorDiv.style.display = 'none';
    statusDiv.textContent = 'Deleting account...';
    statusDiv.style.display = 'block';
    try {
      await apiFetch('/api/auth/delete-account', { method: 'DELETE' });
      showToast('Account deleted');
      await state.supabase.auth.signOut();
      closeModal();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
    } finally {
      statusDiv.style.display = 'none';
    }
  });

  modal.querySelector('#logoutBtn').addEventListener('click', async () => {
    await state.supabase.auth.signOut();
    closeModal();
    showToast('Logged out');
  });
}

// --- Attachment button ---
attachBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,.txt,.doc,.docx';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files);
    const maxSize = 10 * 1024 * 1024;
    if (files.some(f => f.size > maxSize)) {
      showToast('Files must be smaller than 10MB.', true);
      return;
    }
    state.attachments.push(...files);
    renderAttachments();
    updateSendButton();
  };
  input.click();
});

// --- Sidebar toggle ---
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  sidebarToggle.querySelector('[data-lucide="panel-left-close"]').style.display = isCollapsed ? 'none' : 'inline';
  sidebarToggle.querySelector('[data-lucide="panel-left-open"]').style.display = isCollapsed ? 'inline' : 'none';
  log(`Sidebar ${isCollapsed ? 'collapsed' : 'expanded'}`, 'info');
});

openSidebarBtn.addEventListener('click', () => {
  sidebar.classList.toggle('mobile-open');
});

// Close sidebar on backdrop click (mobile)
document.addEventListener('click', (e) => {
  if (window.innerWidth < 768) {
    const isOpen = sidebar.classList.contains('mobile-open');
    if (isOpen && !sidebar.contains(e.target) && e.target !== openSidebarBtn) {
      sidebar.classList.remove('mobile-open');
    }
  }
});

// --- Other listeners ---
newChatBtn.addEventListener('click', handleNewChat);

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
    if (!state.isGenerating) sendMessage();
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

// Share modal close
document.getElementById('shareModalClose').addEventListener('click', () => {
  shareModal.classList.add('hidden');
});
shareModal.addEventListener('click', (e) => {
  if (e.target === shareModal) shareModal.classList.add('hidden');
});

// --- Init ---
initSupabase();
updateSendButton();
