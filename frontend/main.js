// --- Global state ---
let currentChatId = null;
let conversations = [];
let messages = [];
let isGenerating = false;
let abortController = null;
let supabase = null;
let currentUser = null;
let currentProfile = null;

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

// --- Supabase initialization ---
async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    // Listen for auth changes
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        currentUser = session.user;
        updateAuthUI();
        loadConversations();
      } else {
        currentUser = null;
        updateAuthUI();
        // Clear local state
        conversations = [];
        currentChatId = null;
        renderChatList();
        renderMessages(null);
        chatTitle.textContent = 'AgriDeepAI';
      }
    });
    // Check existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
      updateAuthUI();
      await loadConversations();
    } else {
      updateAuthUI();
    }
  } catch (err) {
    console.error('Failed to init Supabase:', err);
  }
}

// --- Auth UI ---
function updateAuthUI() {
  const btnText = currentUser ? '👤 ' + (currentUser.email?.split('@')[0] || 'User') : 'Sign In';
  authTopBtn.textContent = btnText;
  authSidebarBtn.textContent = currentUser ? 'Logout' : 'Sign In';
  if (currentUser) {
    authTopBtn.onclick = () => { /* open profile? or logout? */ };
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
        // Sign up
        const fullName = document.getElementById('authFullName')?.value.trim() || email.split('@')[0];
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        });
        if (error) throw error;
        // Show verification section
        document.getElementById('verifySection').style.display = 'block';
        submitBtn.disabled = true;
        // Store userId for verification
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

// --- API helpers (with auth token) ---
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

// --- Load conversations ---
async function loadConversations() {
  if (!currentUser) return;
  try {
    const res = await apiFetch('/api/chat/conversations');
    conversations = await res.json();
    renderChatList();
    // If no currentChatId, select first or show welcome
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

// --- Load messages for a conversation ---
async function loadMessages(chatId) {
  if (!currentUser) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
    messages = await res.json();
    const chat = conversations.find(c => c.id === chatId);
    if (chat) chatTitle.textContent = chat.title || 'New Chat';
    renderMessages(chat);
    // Update chat list highlight
    renderChatList();
  } catch (err) {
    console.error(err);
  }
}

// --- Render chat list ---
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

// --- Render messages ---
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
    div.textContent = msg.content;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(msg.content).then(() => alert('Copied!'));
    });
    actionsDiv.appendChild(copyBtn);
    if (msg.role === 'assistant') {
      const regenBtn = document.createElement('button');
      regenBtn.textContent = '🔄';
      regenBtn.title = 'Regenerate';
      regenBtn.addEventListener('click', () => regenerateMessage(index));
      actionsDiv.appendChild(regenBtn);
    }
    div.appendChild(actionsDiv);
    messageList.appendChild(div);
  });
  messageList.scrollTop = messageList.scrollHeight;
}

// --- Chat CRUD (with API) ---
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

// --- Send message ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isGenerating) return;
  if (!currentUser) {
    alert('Please sign in to chat and save conversations.');
    openAuthModal('login');
    return;
  }
  let chat = conversations.find(c => c.id === currentChatId);
  if (!chat) {
    chat = await createChat(text.substring(0, 30) + (text.length > 30 ? '...' : ''));
    if (!chat) return;
    currentChatId = chat.id;
    messages = [];
    chatTitle.textContent = chat.title;
  }
  // Add user message locally (optimistic)
  const tempUserMsg = { id: Date.now().toString(), role: 'user', content: text, created_at: new Date().toISOString() };
  messages.push(tempUserMsg);
  renderMessages(chat);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  messageInput.disabled = true;

  isGenerating = true;
  sendBtn.textContent = '⏹';
  abortController = new AbortController();

  try {
    // We'll use fetch with streaming
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: text }),
      signal: abortController.signal
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI request failed');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';
    // Add placeholder assistant message
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
              // Update the last assistant message
              const last = messages[messages.length - 1];
              if (last.role === 'assistant') {
                last.content = assistantMsg;
                renderMessages(chat);
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    // After stream ends, we need to reload messages to get proper IDs from DB
    await loadMessages(chat.id);
    // Update conversation list (updated_at)
    await loadConversations();
  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped – remove placeholder assistant if empty
      if (messages.length > 0 && messages[messages.length-1].role === 'assistant' && messages[messages.length-1].content === '') {
        messages.pop();
        renderMessages(chat);
      }
    } else {
      console.error(err);
      alert('Error: ' + err.message);
      // Remove placeholder assistant if exists
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

// --- Stop generation ---
function stopGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
    isGenerating = false;
    sendBtn.textContent = '➤';
    messageInput.disabled = false;
  }
}

// --- Regenerate ---
async function regenerateMessage(index) {
  const chat = conversations.find(c => c.id === currentChatId);
  if (!chat) return;
  // We need to remove all messages from this index onward
  // and re-send the last user message.
  const newMessages = messages.slice(0, index);
  // Update local messages
  messages = newMessages;
  renderMessages(chat);
  // Now call sendMessage with the last user message, but we need to ensure we don't duplicate.
  // We'll call the API directly with the history.
  const lastUserMsg = newMessages[newMessages.length - 1];
  if (lastUserMsg && lastUserMsg.role === 'user') {
    // We need to send the conversation history up to that user message.
    // We'll use the same send logic but with a different payload.
    // Instead of re-using sendMessage, we'll implement a helper.
    await regenerateWithHistory(chat.id, newMessages);
  }
}

async function regenerateWithHistory(chatId, history) {
  // history is array of messages (without the assistant response we want to regenerate)
  // We'll send the history to the backend, which will generate a new assistant message.
  // But our backend expects a single 'message' field. We'll need to modify the endpoint to accept history.
  // For simplicity, we'll send the last user message and rely on the backend to fetch conversation history.
  // Actually, our backend already uses the conversation history from DB. So we just need to tell it to regenerate.
  // We can add a flag 'regenerate: true' to the request.
  // But to keep it simple, we'll delete all messages after the index and then re-send the last user message.
  // Since we already truncated messages locally, we can just call sendMessage() with the last user content.
  // However, that would add a new user message. Instead, we'll call the API with the current conversation ID and the last user message content.
  // Our backend will save the user message again, which is not ideal.
  // Better: we'll implement a regenerate endpoint later. For now, we'll just reload the conversation and start over.
  alert('Regenerate feature will be fully implemented in Phase 4 (not yet). For now, please start a new chat.');
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

attachBtn.addEventListener('click', () => alert('File uploads coming in Phase 5'));

// --- Init ---
initSupabase();
