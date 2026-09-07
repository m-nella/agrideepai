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
    authSidebarBtn.textContent = '👤 ' + (state.currentUser.email?.split('@')[0] || 'User');
    authSidebarBtn.onclick = () => openSettingsModal();
  } else {
    authSidebarBtn.textContent = 'Sign In';
    authSidebarBtn.onclick = () => openAuthModal('login');
  }
}

// --- API helper (authenticated) ---
async function apiFetch(endpoint, options = {}) {
  const session = await state.supabase.auth.getSession();
  const token = session.data.session?.access_token;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };
  const res = await fetch(endpoint, { ...options, headers });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Request failed');
  }
  return res;
}

// --- Local storage helpers ---
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

// --- Cloud conversation loading ---
async function loadCloudConversations() {
  if (!state.currentUser) return;
  try {
    const res = await apiFetch('/api/chat/conversations');
    state.chats = await res.json();
    renderChatList();
    if (state.activeChatId) {
      const exists = state.chats.find(c => c.id === state.activeChatId);
      if (!exists) state.activeChatId = null;
    }
    if (state.activeChatId) {
      await loadCloudMessages(state.activeChatId);
    } else {
      state.messages = [];
      renderMessages();
      chatTitle.textContent = 'AgriDeepAI';
    }
  } catch (err) {
    console.error(err);
  }
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
  } catch (err) {
    console.error(err);
  }
}

// --- Render chat list ---
function renderChatList() {
  chatList.innerHTML = '';
  if (!state.chats.length) {
    chatList.innerHTML = '<div style="text-align:center;color:#777;padding:1rem;">No chats yet</div>';
    return;
  }
  const sorted = [...state.chats].sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updated_at || b.updatedAt) - new Date(a.updated_at || a.updatedAt);
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
    pinBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePin(chat.id); });
    actions.appendChild(pinBtn);
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameChat(chat.id); });
    actions.appendChild(renameBtn);
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id); });
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
      header.innerHTML = `<img src="/logo.png" alt="AgriDeepAI" /> AgriDeepAI`;
      msgDiv.appendChild(header);
    }
    const contentSpan = document.createElement('span');
    contentSpan.textContent = msg.content;
    msgDiv.appendChild(contentSpan);
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
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(msg.content).then(() => alert('Copied!'));
    });
    actionsDiv.appendChild(copyBtn);
    if (msg.role === 'user') {
      const editBtn = document.createElement('button');
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit message';
      editBtn.addEventListener('click', () => editUserMessage(index));
      actionsDiv.appendChild(editBtn);
    }
    if (msg.role === 'assistant') {
      const regenBtn = document.createElement('button');
      regenBtn.textContent = '🔄';
      regenBtn.title = 'Regenerate response';
      regenBtn.addEventListener('click', () => regenerateMessage(index));
      actionsDiv.appendChild(regenBtn);
    }
    msgDiv.appendChild(actionsDiv);
    row.appendChild(msgDiv);
    messageList.appendChild(row);
  });
  const container = document.getElementById('chatContainer');
  if (isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

function isNearBottom(container, threshold = 150) {
  return (container.scrollHeight - container.scrollTop - container.clientHeight) < threshold;
}

// --- Chat CRUD (guest + cloud) ---
function createLocalChat(title = 'New Chat') {
  const chat = {
    id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    title: title,
    messages: [],
    pinned: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  state.chats.unshift(chat);
  saveLocalConversations();
  renderChatList();
  return chat;
}

async function createChat(title = 'New Chat') {
  if (state.currentUser) {
    try {
      const res = await apiFetch('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ title })
      });
      const chat = await res.json();
      state.chats.unshift(chat);
      renderChatList();
      return chat;
    } catch (err) {
      alert('Failed to create chat');
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
    } catch (err) {
      alert('Failed to delete');
    }
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
  if (newTitle && newTitle.trim()) {
    if (state.currentUser) {
      try {
        const res = await apiFetch(`/api/chat/conversations/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: newTitle.trim() })
        });
        const updated = await res.json();
        const idx = state.chats.findIndex(c => c.id === id);
        if (idx !== -1) state.chats[idx] = updated;
        renderChatList();
        if (state.activeChatId === id) chatTitle.textContent = updated.title;
      } catch (err) {
        alert('Failed to rename');
      }
    } else {
      chat.title = newTitle.trim();
      chat.updatedAt = new Date().toISOString();
      saveLocalConversations();
      renderChatList();
      if (state.activeChatId === id) chatTitle.textContent = chat.title;
    }
  }
}

async function togglePin(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  if (state.currentUser) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ pinned: !chat.pinned })
      });
      const updated = await res.json();
      const idx = state.chats.findIndex(c => c.id === id);
      if (idx !== -1) state.chats[idx] = updated;
      renderChatList();
    } catch (err) {
      alert('Failed to update pin');
    }
  } else {
    chat.pinned = !chat.pinned;
    chat.updatedAt = new Date().toISOString();
    saveLocalConversations();
    renderChatList();
  }
}

// --- Composer resize ---
function resizeComposer() {
  messageInput.style.height = '0px';
  const maxHeight = 120;
  const scrollHeight = messageInput.scrollHeight;
  messageInput.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  messageInput.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function updateSendButton() {
  const hasContent = messageInput.value.trim() !== '' || state.attachments.length > 0;
  sendBtn.style.opacity = hasContent ? '1' : '0.35';
}

function showFilePreview() {
  const oldPreview = document.getElementById('filePreviewContainer');
  if (oldPreview) oldPreview.remove();
  if (state.attachments.length === 0) return;
  const container = document.createElement('div');
  container.id = 'filePreviewContainer';
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;padding:0.25rem 0.5rem;';
  state.attachments.forEach((file, idx) => {
    const pill = document.createElement('span');
    pill.style.cssText = 'background:#3a3f40;padding:0.2rem 0.6rem;border-radius:1rem;font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;color:#e8e6e1;';
    pill.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-weight:bold;color:#aaa;';
    removeBtn.addEventListener('click', () => {
      state.attachments.splice(idx, 1);
      showFilePreview();
      updateSendButton();
    });
    pill.appendChild(removeBtn);
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
    chat = await createChat(text.substring(0, 30) + (text.length > 30 ? '...' : '') || 'New Chat');
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
    created_at: new Date().toISOString()
  };
  state.messages.push(userMsg);
  if (!state.currentUser) {
    chat.messages = state.messages;
    saveLocalConversations();
  }
  renderMessages();

  messageInput.value = '';
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
    created_at: new Date().toISOString()
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
    state.attachments.forEach(f => formData.append('file', f));

    if (state.currentUser) {
      const session = await state.supabase.auth.getSession();
      const token = session.data.session?.access_token;
      response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
        signal: state.abortController.signal
      });
    } else {
      const payload = {
        messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
      };
      response = await fetch('/api/chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: state.abortController.signal
      });
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.role !== 'assistant') {
      state.messages.push(assistantMsg);
      if (!state.currentUser) {
        chat.messages = state.messages;
        saveLocalConversations();
      }
    }

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
              fullContent += parsed.text;
              const last = state.messages[state.messages.length - 1];
              if (last.role === 'assistant') {
                last.content = fullContent;
                if (!state.currentUser) {
                  chat.messages = state.messages;
                  saveLocalConversations();
                }
                renderMessages();
              }
            } else if (parsed.sources) {
              const last = state.messages[state.messages.length - 1];
              if (last.role === 'assistant') {
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
      alert('Error: ' + err.message);
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

// --- Edit & Regenerate (same as before) ---
async function editUserMessage(index) { /* ... keep existing ... */ }
async function regenerateMessage(index) { /* ... keep existing ... */ }
async function sendGuestMessage(text, chat) { /* ... keep existing ... */ }

// (For brevity, we skip copying full edit/regenerate functions, but they are identical to previous working code.)

// --- Auth Modal, Settings Modal (same as before) ---
// (We'll assume they are present in your current main.js; if not, copy from previous version.)

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

chips.forEach(chip => {
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
    const oversized = files.some(f => f.size > maxSize);
    if (oversized) {
      alert('Files must be smaller than 10MB.');
      return;
    }
    state.attachments = state.attachments.concat(files);
    showFilePreview();
    updateSendButton();
  };
  input.click();
});

// --- Init ---
initSupabase();
updateSendButton();
