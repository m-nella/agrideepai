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

// --- Always dark – no theme toggle ---

// --- Supabase init ---
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
        loadConversations(); // load cloud chats
      } else {
        currentUser = null;
        updateAuthUI();
        // Switch to local storage
        loadLocalConversations();
      }
    });
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
      updateAuthUI();
      await loadConversations();
    } else {
      updateAuthUI();
      loadLocalConversations();
    }
  } catch (err) {
    console.error('Supabase init error:', err);
    // Fallback to local
    loadLocalConversations();
  }
}

// --- Auth UI ---
function updateAuthUI() {
  if (currentUser) {
    authSidebarBtn.textContent = '👤 ' + (currentUser.email?.split('@')[0] || 'User');
    authSidebarBtn.onclick = () => openSettingsModal();
  } else {
    authSidebarBtn.textContent = 'Sign In';
    authSidebarBtn.onclick = () => openAuthModal('login');
  }
}

// --- LocalStorage helpers ---
function loadLocalConversations() {
  const stored = localStorage.getItem('agrideep_local_conversations');
  conversations = stored ? JSON.parse(stored) : [];
  const currentId = localStorage.getItem('agrideep_local_current');
  if (currentId) {
    const exists = conversations.find(c => c.id === currentId);
    currentChatId = exists ? currentId : null;
  }
  renderChatList();
  if (currentChatId) {
    const chat = conversations.find(c => c.id === currentChatId);
    if (chat) {
      messages = chat.messages || [];
      renderMessages(chat);
      chatTitle.textContent = chat.title || 'New Chat';
    }
  } else {
    messages = [];
    renderMessages(null);
    chatTitle.textContent = 'AgriDeepAI';
  }
}

function saveLocalConversations() {
  localStorage.setItem('agrideep_local_conversations', JSON.stringify(conversations));
  if (currentChatId) {
    localStorage.setItem('agrideep_local_current', currentChatId);
  } else {
    localStorage.removeItem('agrideep_local_current');
  }
}

// --- Load cloud conversations ---
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
      messages = [];
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

// --- API helper (for authenticated requests) ---
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

// --- Render chat list ---
function renderChatList() {
  chatList.innerHTML = '';
  if (!conversations.length) {
    chatList.innerHTML = '<div style="text-align:center;color:#777;padding:1rem;">No chats yet</div>';
    return;
  }
  const sorted = [...conversations].sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updated_at || b.updatedAt) - new Date(a.updated_at || a.updatedAt);
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
    // Pin
    const pinBtn = document.createElement('button');
    pinBtn.textContent = chat.pinned ? '📌' : '📍';
    pinBtn.title = chat.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePin(chat.id); });
    actions.appendChild(pinBtn);
    // Rename
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameChat(chat.id); });
    actions.appendChild(renameBtn);
    // Delete
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
    // Files / Sources
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

// --- Edit & Regenerate (simplified for guest) ---
async function editUserMessage(index) {
  const msg = messages[index];
  if (!msg || msg.role !== 'user') return;
  const newContent = prompt('Edit your message:', msg.content);
  if (newContent === null || newContent.trim() === '') return;
  const trimmed = newContent.trim();
  if (currentUser) {
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
      alert('Failed to edit: ' + err.message);
    }
  } else {
    // Guest: update locally
    messages[index].content = trimmed;
    messages = messages.slice(0, index + 1);
    const chat = conversations.find(c => c.id === currentChatId);
    if (chat) {
      chat.messages = messages;
      saveLocalConversations();
      renderMessages(chat);
    }
    alert('Message updated. Please send a new message.');
  }
}

async function regenerateMessage(index) {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant') return;
  const chat = conversations.find(c => c.id === currentChatId);
  if (!chat) return;
  // For guest, we can't regenerate via API without history; we'll just clear from this index and re-send last user message.
  if (!currentUser) {
    // Remove from index onward
    messages = messages.slice(0, index);
    chat.messages = messages;
    saveLocalConversations();
    renderMessages(chat);
    // Resend the last user message
    const lastUser = messages[messages.length - 1];
    if (lastUser && lastUser.role === 'user') {
      // We'll use the guest send flow
      await sendGuestMessage(lastUser.content, chat);
    }
    return;
  }
  // Cloud regeneration
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

// --- Chat CRUD (works for both guest & cloud) ---
function createLocalChat(title = 'New Chat') {
  const chat = {
    id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    title: title,
    messages: [],
    pinned: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  conversations.unshift(chat);
  saveLocalConversations();
  renderChatList();
  return chat;
}

async function createChat(title = 'New Chat') {
  if (currentUser) {
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
      alert('Failed to create chat');
      return null;
    }
  } else {
    return createLocalChat(title);
  }
}

async function selectChat(id) {
  currentChatId = id;
  if (currentUser) {
    await loadMessages(id);
    renderChatList();
  } else {
    const chat = conversations.find(c => c.id === id);
    if (chat) {
      messages = chat.messages || [];
      renderMessages(chat);
      chatTitle.textContent = chat.title || 'New Chat';
      renderChatList();
      saveLocalConversations();
    }
  }
  if (window.innerWidth < 768) sidebar.classList.remove('open');
}

async function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  if (currentUser) {
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
  } else {
    conversations = conversations.filter(c => c.id !== id);
    if (currentChatId === id) {
      currentChatId = null;
      messages = [];
      renderMessages(null);
      chatTitle.textContent = 'AgriDeepAI';
    }
    saveLocalConversations();
    renderChatList();
  }
}

async function renameChat(id) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  const newTitle = prompt('New title:', chat.title);
  if (newTitle && newTitle.trim()) {
    if (currentUser) {
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
    } else {
      chat.title = newTitle.trim();
      chat.updatedAt = new Date().toISOString();
      saveLocalConversations();
      renderChatList();
      if (currentChatId === id) chatTitle.textContent = chat.title;
    }
  }
}

async function togglePin(id) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  if (currentUser) {
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
  } else {
    chat.pinned = !chat.pinned;
    chat.updatedAt = new Date().toISOString();
    saveLocalConversations();
    renderChatList();
  }
}

// --- File preview ---
function showFilePreview() {
  const oldPreview = document.getElementById('filePreviewContainer');
  if (oldPreview) oldPreview.remove();
  if (selectedFiles.length === 0) return;
  const container = document.createElement('div');
  container.id = 'filePreviewContainer';
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;padding:0.25rem 0.5rem;';
  selectedFiles.forEach((file, idx) => {
    const pill = document.createElement('span');
    pill.style.cssText = 'background:#3a3f40;padding:0.2rem 0.6rem;border-radius:1rem;font-size:0.85rem;display:flex;align-items:center;gap:0.3rem;color:#e8e6e1;';
    pill.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-weight:bold;color:#aaa;';
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(idx, 1);
      showFilePreview();
    });
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
  composer.parentNode.insertBefore(container, composer);
}

// --- Send message (guest or authenticated) ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && selectedFiles.length === 0) return;
  if (isGenerating) return;
  let chat = conversations.find(c => c.id === currentChatId);
  if (!chat) {
    chat = await createChat(text.substring(0, 30) + (text.length > 30 ? '...' : '') || 'New Chat');
    if (!chat) return;
    currentChatId = chat.id;
    messages = [];
    chatTitle.textContent = chat.title;
    if (!currentUser) {
      // For guest, we need to update the chat's messages
      chat.messages = messages;
    }
  }

  // Build FormData (always send search=true)
  const formData = new FormData();
  formData.append('message', text || '');
  formData.append('search', 'true'); // always on
  selectedFiles.forEach(file => {
    formData.append('file', file);
  });

  // Optimistic user message
  const tempUserMsg = {
    id: Date.now().toString(),
    role: 'user',
    content: text || '[File attached]',
    files: selectedFiles.map(f => ({ filename: f.name, mime_type: f.type, size: f.size })),
    created_at: new Date().toISOString()
  };
  messages.push(tempUserMsg);
  if (!currentUser) {
    chat.messages = messages;
    saveLocalConversations();
  }
  renderMessages(chat);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  messageInput.disabled = true;
  selectedFiles = [];
  showFilePreview();

  isGenerating = true;
  sendBtn.classList.add('generating');
  sendBtn.disabled = true;
  abortController = new AbortController();

  try {
    let response;
    if (currentUser) {
      // Authenticated – use cloud endpoint
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
        signal: abortController.signal
      });
    } else {
      // Guest – use guest endpoint
      const payload = { messages: messages.map(m => ({ role: m.role, content: m.content })) };
      // For guest, we don't have conversation id; we'll send the whole history.
      response = await fetch('/api/chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal
      });
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';
    const tempAssistantId = Date.now().toString() + '-assistant';
    messages.push({ id: tempAssistantId, role: 'assistant', content: '', created_at: new Date().toISOString() });
    if (!currentUser) {
      chat.messages = messages;
      saveLocalConversations();
    }
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
              // Add sources to the assistant message (will be saved later)
              const last = messages[messages.length - 1];
              if (last.role === 'assistant') {
                if (!last.files) last.files = [];
                last.files.push({ sources: parsed.sources });
              }
            }
          } catch (e) {}
        }
      }
    }
    // Save final state
    if (currentUser) {
      await loadMessages(chat.id);
      await loadConversations();
    } else {
      chat.messages = messages;
      saveLocalConversations();
      renderMessages(chat);
      renderChatList();
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped – remove empty assistant if any
      if (messages.length > 0 && messages[messages.length-1].role === 'assistant' && messages[messages.length-1].content === '') {
        messages.pop();
        if (!currentUser) {
          chat.messages = messages;
          saveLocalConversations();
        }
        renderMessages(chat);
      }
    } else {
      console.error(err);
      alert('Error: ' + err.message);
      // Remove placeholder assistant
      if (messages.length > 0 && messages[messages.length-1].role === 'assistant' && messages[messages.length-1].content === '') {
        messages.pop();
        if (!currentUser) {
          chat.messages = messages;
          saveLocalConversations();
        }
        renderMessages(chat);
      }
    }
  } finally {
    isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    messageInput.disabled = false;
    abortController = null;
    // Update send button visibility
    updateSendButton();
  }
}

// --- Guest send helper (for regeneration) ---
async function sendGuestMessage(text, chat) {
  // Similar to sendMessage but without adding a new user message (already in history)
  // We'll just call the guest endpoint with the current messages.
  const payload = { messages: messages.map(m => ({ role: m.role, content: m.content })) };
  isGenerating = true;
  sendBtn.classList.add('generating');
  sendBtn.disabled = true;
  abortController = new AbortController();
  try {
    const response = await fetch('/api/chat/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal
    });
    if (!response.ok) throw new Error('AI request failed');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';
    messages.push({ id: Date.now().toString() + '-assistant', role: 'assistant', content: '', created_at: new Date().toISOString() });
    chat.messages = messages;
    saveLocalConversations();
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
            }
          } catch (e) {}
        }
      }
    }
    chat.messages = messages;
    saveLocalConversations();
    renderMessages(chat);
    renderChatList();
  } catch (err) {
    if (err.name !== 'AbortError') {
      alert('Error: ' + err.message);
      if (messages.length > 0 && messages[messages.length-1].role === 'assistant' && messages[messages.length-1].content === '') {
        messages.pop();
        chat.messages = messages;
        saveLocalConversations();
        renderMessages(chat);
      }
    }
  } finally {
    isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    abortController = null;
    updateSendButton();
  }
}

// --- Stop generation ---
function stopGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
    isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    messageInput.disabled = false;
    updateSendButton();
  }
}

// --- Update send button visibility ---
function updateSendButton() {
  const hasContent = messageInput.value.trim() !== '' || selectedFiles.length > 0;
  sendBtn.style.opacity = hasContent ? '1' : '0.35';
}

// --- Event listeners ---
newChatBtn.addEventListener('click', async () => {
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
    selectedFiles = selectedFiles.concat(files);
    showFilePreview();
    updateSendButton();
  };
  input.click();
});

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
      <button id="resendVerifyBtn" style="background:none;border:none;color:#66bb6a;cursor:pointer;margin-top:0.5rem;">Resend code</button>
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

// --- Settings Modal (for logged in users) ---
function openSettingsModal() {
  if (!currentUser) return;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'settingsModal';
  modal.innerHTML = `
    <div class="modal-content">
      <span class="modal-close" id="settingsClose">&times;</span>
      <h2>Account Settings</h2>
      <p style="margin-bottom:1rem;color:#aaa;">Email: ${currentUser.email}</p>
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
      <h3 style="color:#ef5350;">Delete Account</h3>
      <p style="color:#ef5350;font-size:0.9rem;">This action is permanent and cannot be undone.</p>
      <button class="btn-primary" id="deleteAccountBtn" style="background:#d32f2f;">Delete Account</button>
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
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      alert(data.message || 'Password changed');
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
      const res = await apiFetch('/api/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail })
      });
      const data = await res.json();
      alert(data.message || 'Email change requested. Please verify the new email.');
      modal.querySelector('#settingsError').style.display = 'none';
      modal.querySelector('#newEmail').value = '';
    } catch (err) {
      modal.querySelector('#settingsError').textContent = err.message;
      modal.querySelector('#settingsError').style.display = 'block';
    }
  });

  modal.querySelector('#deleteAccountBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to permanently delete your account? This cannot be undone!')) return;
    if (!confirm('All your conversations and data will be lost. Continue?')) return;
    try {
      const res = await apiFetch('/api/auth/delete-account', { method: 'DELETE' });
      const data = await res.json();
      alert(data.message || 'Account deleted');
      await supabase.auth.signOut();
      closeModal();
    } catch (err) {
      modal.querySelector('#settingsError').textContent = err.message;
      modal.querySelector('#settingsError').style.display = 'block';
    }
  });
}

// --- Init ---
initSupabase();
// Initial send button state
updateSendButton();
