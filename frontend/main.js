// --- Global state ---
let currentChatId = null;
let conversations = [];
let messages = [];
let isGenerating = false;
let abortController = null;
let supabase = null;
let currentUser = null;
let currentProfile = null;
let selectedFiles = [];
let searchEnabled = false; // new toggle

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
const themeTopBtn = document.getElementById('themeTopBtn');
const themeSidebarBtn = document.getElementById('themeSidebarBtn');
const authTopBtn = document.getElementById('authTopBtn');
const authSidebarBtn = document.getElementById('authSidebarBtn');
const attachBtn = document.getElementById('attachBtn');
const chips = document.querySelectorAll('.chip');
const chatTitle = document.getElementById('chatTitle');
const authModal = document.getElementById('authModal');
const authModalBody = document.getElementById('authModalBody');
const modalClose = document.querySelector('.modal-close');
const composer = document.getElementById('composer');

// --- Theme ---
let isDark = localStorage.getItem('agrideep_theme') === 'dark';
function setTheme(dark) {
  isDark = dark;
  document.body.classList.toggle('dark', dark);
  localStorage.setItem('agrideep_theme', dark ? 'dark' : 'light');
  const icon = dark ? '☀️' : '🌓';
  themeTopBtn.textContent = icon;
  themeSidebarBtn.textContent = icon;
}
if (isDark) { document.body.classList.add('dark'); themeTopBtn.textContent = '☀️'; themeSidebarBtn.textContent = '☀️'; }
themeTopBtn.addEventListener('click', () => setTheme(!isDark));
themeSidebarBtn.addEventListener('click', () => setTheme(!isDark));

// --- Add search toggle button to composer ---
function addSearchToggle() {
  const existing = document.getElementById('searchToggle');
  if (existing) return;
  const toggle = document.createElement('button');
  toggle.id = 'searchToggle';
  toggle.textContent = '🌐';
  toggle.title = 'Toggle web search';
  toggle.style.cssText = 'background:transparent;border:none;font-size:1.2rem;cursor:pointer;padding:0.2rem 0.4rem;';
  toggle.addEventListener('click', () => {
    searchEnabled = !searchEnabled;
    toggle.style.opacity = searchEnabled ? '1' : '0.4';
    toggle.style.filter = searchEnabled ? 'none' : 'grayscale(1)';
  });
  toggle.style.opacity = '0.4';
  toggle.style.filter = 'grayscale(1)';
  // Insert before attachBtn
  const attachBtnEl = document.getElementById('attachBtn');
  attachBtnEl.parentNode.insertBefore(toggle, attachBtnEl);
}

// --- Supabase initialization ---
async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        currentUser = session.user;
        updateAuthUI();
        loadConversations();
      } else {
        currentUser = null;
        updateAuthUI();
        conversations = [];
        currentChatId = null;
        renderChatList();
        renderMessages(null);
        chatTitle.textContent = 'AgriDeepAI';
      }
    });
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
      updateAuthUI();
      await loadConversations();
    } else {
      updateAuthUI();
    }
    addSearchToggle();
  } catch (err) {
    console.error('Failed to init Supabase:', err);
  }
}

// --- Auth UI (unchanged) ---
function updateAuthUI() {
  const btnText = currentUser ? '👤 ' + (currentUser.email?.split('@')[0] || 'User') : 'Sign In';
  authTopBtn.textContent = btnText;
  authSidebarBtn.textContent = currentUser ? 'Logout' : 'Sign In';
  if (currentUser) {
    authTopBtn.onclick = () => {};
    authSidebarBtn.onclick = async () => {
      await supabase.auth.signOut();
      currentUser = null;
      updateAuthUI();
      conversations = [];
      currentChatId = null;
      renderChatList();
      renderMessages(null);
      chatTitle.textContent = 'AgriDeepAI';
    };
  } else {
    authTopBtn.onclick = () => openAuthModal('login');
    authSidebarBtn.onclick = () => openAuthModal('login');
  }
}

// --- Auth Modal (unchanged) ---
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
      <button id="resendVerifyBtn" style="background:none;border:none;color:#2e7d32;cursor:pointer;margin-top:0.5rem;">Resend code</button>
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        closeAuthModal();
      } else {
        const fullName = document.getElementById('authFullName')?.value.trim() || email.split('@')[0];
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        });
        if (error) throw error;
        document.getElementById('verifySection').style.display = 'block';
        submitBtn.disabled = true;
        const userId = data.user.id;
        document.getElementById('verifyBtn').addEventListener('click', async () => {
          const code = document.getElementById('verifyCode').value.trim();
          if (!code) { alert('Enter the code'); return; }
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, code })
          });
          const result = await res.json();
          if (res.ok) {
            alert('Email verified! You can now sign in.');
            closeAuthModal();
            renderAuthForm('login');
          } else {
            alert(result.error || 'Verification failed');
          }
        });
        document.getElementById('resendVerifyBtn').addEventListener('click', async () => {
          await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          alert('New code sent');
        });
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Authentication failed';
      errorDiv.style.display = 'block';
    }
  });
}

// --- API helpers (unchanged) ---
async function apiFetch(endpoint, options = {}) {
  const session = await supabase.auth.getSession();
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

// --- Load conversations (unchanged) ---
async function loadConversations() {
  if (!currentUser) return;
  try {
    const res = await apiFetch('/api/chat/conversations');
    conversations = await res.json();
    renderChatList();
    if (currentChatId) {
      const exists = conversations.find(c => c.id === currentChatId);
      if (!exists) currentChatId = null;
    }
    if (currentChatId) {
      await loadMessages(currentChatId);
    } else {
      renderMessages(null);
      chatTitle.textContent = 'AgriDeepAI';
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadMessages(chatId) {
  if (!currentUser) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
    messages = await res.json();
    const chat = conversations.find(c => c.id === chatId);
    if (chat) chatTitle.textContent = chat.title || 'New Chat';
    renderMessages(chat);
    renderChatList();
  } catch (err) {
    console.error(err);
  }
}

// --- Render chat list (unchanged) ---
function renderChatList() {
  chatList.innerHTML = '';
  if (!conversations.length) {
    chatList.innerHTML = '<div style="text-align:center;color:#999;padding:1rem;">No chats yet</div>';
    return;
  }
  const sorted = [...conversations].sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
  sorted.forEach(chat => {
    const div = document.createElement('div');
    div.className = `chat-item${chat.id === currentChatId ? ' active' : ''}`;
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

// --- Render messages (with sources) ---
function renderMessages(chat) {
  messageList.innerHTML = '';
  if (!chat || !messages.length) {
    welcomeScreen.style.display = 'flex';
    messageList.style.display = 'none';
    return;
  }
  welcomeScreen.style.display = 'none';
  messageList.style.display = 'flex';
  messages.forEach((msg, index) => {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    const contentSpan = document.createElement('span');
    contentSpan.textContent = msg.content;
    div.appendChild(contentSpan);
    // Show files if any
    if (msg.files && msg.files.length > 0) {
      const fileDiv = document.createElement('div');
      fileDiv.style.cssText = 'font-size:0.8rem;margin-top:0.3rem;opacity:0.7;';
      msg.files.forEach(f => {
        if (f.sources) {
          // Display sources
          const sourcesDiv = document.createElement('div');
          sourcesDiv.style.marginTop = '0.5rem';
          sourcesDiv.innerHTML = '<strong>Sources:</strong><ul style="list-style:none;padding-left:0.5rem;margin:0.2rem 0;">' +
            f.sources.map(s => `<li style="margin:0.1rem 0;"><a href="${s.url}" target="_blank" style="color:#2e7d32;text-decoration:underline;">${s.title || s.url}</a></li>`).join('') +
            '</ul>';
          div.appendChild(sourcesDiv);
        } else if (f.public_url) {
          const link = document.createElement('a');
          link.href = f.public_url;
          link.target = '_blank';
          link.textContent = '📎 ' + (f.filename || 'File');
          fileDiv.appendChild(link);
          fileDiv.appendChild(document.createTextNode(' '));
        }
      });
      if (fileDiv.children.length > 0) div.appendChild(fileDiv);
    }
    // Actions
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
    div.appendChild(actionsDiv);
    messageList.appendChild(div);
  });
  messageList.scrollTop = messageList.scrollHeight;
}

// --- Edit and Regenerate (same as Phase 5) ---
async function editUserMessage(index) {
  const msg = messages[index];
  if (!msg || msg.role !== 'user') return;
  const newContent = prompt('Edit your message:', msg.content);
  if (newContent === null || newContent.trim() === '') return;
  const trimmed = newContent.trim();
  try {
    const res = await apiFetch(`/api/chat/messages/${msg.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content: trimmed, truncate: true })
    });
    const updatedMsg = await res.json();
    messages[index].content = trimmed;
    messages = messages.slice(0, index + 1);
    alert('Message updated. Please send a new message to get a new response.');
  } catch (err) {
    alert('Failed to edit message: ' + err.message);
  }
}

async function regenerateMessage(index) {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant') return;
  const chat = conversations.find(c => c.id === currentChatId);
  if (!chat) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${chat.id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ messageIndex: index })
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    messages = messages.slice(0, index);
    messages.push({ id: Date.now().toString() + '-temp', role: 'assistant', content: '' });
    renderMessages(chat);
    let assistantContent = '';
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
              assistantContent += parsed.text;
              const last = messages[messages.length - 1];
              if (last.role === 'assistant') {
                last.content = assistantContent;
                renderMessages(chat);
              }
            }
          } catch (e) {}
        }
      }
    }
    await loadMessages(chat.id);
    await loadConversations();
  } catch (err) {
    alert('Regenerate failed: ' + err.message);
  }
}

// --- Chat CRUD (unchanged) ---
async function createChat(title = 'New Chat') {
  if (!currentUser) { alert('Please sign in to create chats'); return null; }
  try {
    const res = await apiFetch('/api/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title })
    });
    const chat = await res.json();
    conversations.unshift(chat);
    renderChatList();
    return chat;
  } catch (err) {
    console.error(err);
    alert('Failed to create chat');
    return null;
  }
}

async function selectChat(id) {
  currentChatId = id;
  await loadMessages(id);
  renderChatList();
  if (window.innerWidth < 768) sidebar.classList.remove('open');
}

async function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  try {
    await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
    conversations = conversations.filter(c => c.id !== id);
    if (currentChatId === id) {
      currentChatId = null;
      messages = [];
      renderMessages(null);
      chatTitle.textContent = 'AgriDeepAI';
    }
    renderChatList();
  } catch (err) {
    alert('Failed to delete');
  }
}

async function renameChat(id) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  const newTitle = prompt('New title:', chat.title);
  if (newTitle && newTitle.trim()) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle.trim() })
      });
      const updated = await res.json();
      const idx = conversations.findIndex(c => c.id === id);
      if (idx !== -1) conversations[idx] = updated;
      renderChatList();
      if (currentChatId === id) chatTitle.textContent = updated.title;
    } catch (err) {
      alert('Failed to rename');
    }
  }
}

async function togglePin(id) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ pinned: !chat.pinned })
    });
    const updated = await res.json();
    const idx = conversations.findIndex(c => c.id === id);
    if (idx !== -1) conversations[idx] = updated;
    renderChatList();
  } catch (err) {
    alert('Failed to update pin');
  }
}

// --- File preview (unchanged) ---
function showFilePreview() {
  const oldPreview = document.getElementById('filePreviewContainer');
  if (oldPreview) oldPreview.remove();
  if (selectedFiles.length === 0) return;
  const container = document.createElement('div');
  container.id = 'filePreviewContainer';
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;padding:0.25rem 0.5rem;';
  selectedFiles.forEach((file, idx) => {
    const pill = document.createElement('span');
    pill.style.cssText = 'background:#e0e0e0;padding:0.2rem 0.6rem;border-radius:1rem;font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;';
    pill.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-weight:bold;';
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(idx, 1);
      showFilePreview();
    });
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
  composer.parentNode.insertBefore(container, composer);
}

// --- Send message with search flag ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && selectedFiles.length === 0) return;
  if (isGenerating) return;
  if (!currentUser) {
    alert('Please sign in to chat and save conversations.');
    openAuthModal('login');
    return;
  }
  let chat = conversations.find(c => c.id === currentChatId);
  if (!chat) {
    chat = await createChat(text.substring(0, 30) + (text.length > 30 ? '...' : '') || 'New Chat');
    if (!chat) return;
    currentChatId = chat.id;
    messages = [];
    chatTitle.textContent = chat.title;
  }

  // Build FormData
  const formData = new FormData();
  formData.append('message', text || '');
  formData.append('search', searchEnabled ? 'true' : 'false');
  selectedFiles.forEach(file => {
    formData.append('file', file);
  });

  // Optimistic: add user message with file info
  const tempUserMsg = {
    id: Date.now().toString(),
    role: 'user',
    content: text || '[File attached]',
    files: selectedFiles.map(f => ({ filename: f.name, mime_type: f.type, size: f.size })),
    created_at: new Date().toISOString()
  };
  messages.push(tempUserMsg);
  renderMessages(chat);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  messageInput.disabled = true;
  selectedFiles = [];
  showFilePreview();

  isGenerating = true;
  sendBtn.textContent = '⏹';
  abortController = new AbortController();

  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData,
      signal: abortController.signal
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI request failed');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';
    let sources = null;
    // Add placeholder assistant
    const tempAssistantId = Date.now().toString() + '-assistant';
    messages.push({ id: tempAssistantId, role: 'assistant', content: '', created_at: new Date().toISOString() });
    renderMessages(chat);

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
              assistantMsg += parsed.text;
              const last = messages[messages.length - 1];
              if (last.role === 'assistant') {
                last.content = assistantMsg;
                renderMessages(chat);
              }
            } else if (parsed.sources) {
              sources = parsed.sources;
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    // After streaming, reload to get the saved message with sources
    await loadMessages(chat.id);
    await loadConversations();
  } catch (err) {
    if (err.name === 'AbortError') {
      if (messages.length > 0 && messages[messages.length-1].role === 'assistant' && messages[messages.length-1].content === '') {
        messages.pop();
        renderMessages(chat);
      }
    } else {
      console.error(err);
      alert('Error: ' + err.message);
      if (messages.length > 0 && messages[messages.length-1].role === 'assistant' && messages[messages.length-1].content === '') {
        messages.pop();
        renderMessages(chat);
      }
    }
  } finally {
    isGenerating = false;
    sendBtn.textContent = '➤';
    messageInput.disabled = false;
    abortController = null;
  }
}

// --- Stop generation (unchanged) ---
function stopGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
    isGenerating = false;
    sendBtn.textContent = '➤';
    messageInput.disabled = false;
  }
}

// --- Event listeners ---
newChatBtn.addEventListener('click', async () => {
  if (!currentUser) { openAuthModal('login'); return; }
  const chat = await createChat('New Chat');
  if (chat) selectChat(chat.id);
});

openSidebarBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

sendBtn.addEventListener('click', () => {
  if (isGenerating) {
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
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    messageInput.value = chip.dataset.prompt;
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
    selectedFiles = selectedFiles.concat(files);
    showFilePreview();
  };
  input.click();
});

// --- Init ---
initSupabase();
