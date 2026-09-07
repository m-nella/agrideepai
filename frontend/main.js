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

// --- State ---
let conversations = JSON.parse(localStorage.getItem('agrideep_conversations')) || [];
let currentChatId = localStorage.getItem('agrideep_current_chat') || null;
let isDark = localStorage.getItem('agrideep_theme') === 'dark';
let isGenerating = false;
let abortController = null;

// --- Helpers ---
function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

function saveConversations() {
  localStorage.setItem('agrideep_conversations', JSON.stringify(conversations));
}

function getCurrentChat() {
  return conversations.find(c => c.id === currentChatId) || null;
}

function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = '';
  if (conversations.length === 0) {
    chatList.innerHTML = '<div style="text-align:center;color:#999;padding:1rem;">No chats yet</div>';
    return;
  }
  // Sort: pinned first, then by updatedAt descending
  const sorted = [...conversations].sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
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
    // Pin/Unpin
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

function renderMessages(chat) {
  messageList.innerHTML = '';
  if (!chat || chat.messages.length === 0) {
    welcomeScreen.style.display = 'flex';
    messageList.style.display = 'none';
    chatTitle.textContent = 'AgriDeepAI';
    return;
  }
  welcomeScreen.style.display = 'none';
  messageList.style.display = 'flex';
  chat.messages.forEach((msg, index) => {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    div.textContent = msg.content;
    // Actions for each message
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'msg-actions';
    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(msg.content).then(() => alert('Copied!'));
    });
    actionsDiv.appendChild(copyBtn);
    // Regenerate (only for assistant messages)
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

// --- Chat CRUD ---
function createChat(title = 'New Chat') {
  const chat = {
    id: generateId(),
    title: title,
    messages: [],
    pinned: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  conversations.push(chat);
  saveConversations();
  renderChatList();
  return chat;
}

function selectChat(id) {
  currentChatId = id;
  localStorage.setItem('agrideep_current_chat', id);
  const chat = getCurrentChat();
  if (chat) {
    chatTitle.textContent = chat.title || 'New Chat';
    renderMessages(chat);
  }
  renderChatList();
  // Close sidebar on mobile
  if (window.innerWidth < 768) sidebar.classList.remove('open');
}

function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  conversations = conversations.filter(c => c.id !== id);
  saveConversations();
  if (currentChatId === id) {
    currentChatId = null;
    localStorage.removeItem('agrideep_current_chat');
    chatTitle.textContent = 'AgriDeepAI';
    renderMessages(null);
  }
  renderChatList();
}

function renameChat(id) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  const newTitle = prompt('New title:', chat.title);
  if (newTitle !== null && newTitle.trim()) {
    chat.title = newTitle.trim();
    chat.updatedAt = new Date().toISOString();
    saveConversations();
    renderChatList();
    if (currentChatId === id) chatTitle.textContent = chat.title;
  }
}

function togglePin(id) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  chat.pinned = !chat.pinned;
  chat.updatedAt = new Date().toISOString();
  saveConversations();
  renderChatList();
}

function updateChatMessages(id, messages) {
  const chat = conversations.find(c => c.id === id);
  if (!chat) return;
  chat.messages = messages;
  chat.updatedAt = new Date().toISOString();
  saveConversations();
  renderMessages(chat);
}

// --- Sending message ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isGenerating) return;
  let chat = getCurrentChat();
  if (!chat) {
    chat = createChat(text.substring(0, 30) + (text.length > 30 ? '...' : ''));
    currentChatId = chat.id;
    localStorage.setItem('agrideep_current_chat', chat.id);
    chatTitle.textContent = chat.title;
  }
  // Add user message
  chat.messages.push({ role: 'user', content: text });
  updateChatMessages(chat.id, chat.messages);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  messageInput.disabled = true;

  // Prepare payload: all messages
  const payload = { messages: chat.messages.map(m => ({ role: m.role, content: m.content })) };

  isGenerating = true;
  sendBtn.textContent = '⏹';
  abortController = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    chat.messages.push({ role: 'assistant', content: '' });
    updateChatMessages(chat.id, chat.messages);

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
              // Update the last assistant message in chat
              const last = chat.messages[chat.messages.length - 1];
              if (last.role === 'assistant') {
                last.content = assistantMsg;
                updateChatMessages(chat.id, chat.messages);
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    // Ensure final save
    updateChatMessages(chat.id, chat.messages);
    // Auto-title if first message
    if (chat.messages.length === 2 && chat.title === 'New Chat') {
      const userMsg = chat.messages[0].content;
      const newTitle = userMsg.substring(0, 40) + (userMsg.length > 40 ? '...' : '');
      chat.title = newTitle;
      saveConversations();
      chatTitle.textContent = newTitle;
      renderChatList();
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped
      // Remove the placeholder assistant message if empty
      if (chat.messages.length > 0 && chat.messages[chat.messages.length-1].role === 'assistant' && chat.messages[chat.messages.length-1].content === '') {
        chat.messages.pop();
        updateChatMessages(chat.id, chat.messages);
      }
    } else {
      console.error(err);
      alert('Error: ' + err.message);
      // Remove placeholder assistant if exists
      if (chat.messages.length > 0 && chat.messages[chat.messages.length-1].role === 'assistant' && chat.messages[chat.messages.length-1].content === '') {
        chat.messages.pop();
        updateChatMessages(chat.id, chat.messages);
      }
    }
  } finally {
    isGenerating = false;
    sendBtn.textContent = '➤';
    messageInput.disabled = false;
    abortController = null;
  }
}

// --- Regenerate ---
async function regenerateMessage(index) {
  const chat = getCurrentChat();
  if (!chat) return;
  // We need to remove the assistant message at 'index' and all subsequent messages
  // (since regeneration replaces from that point onward)
  const newMessages = chat.messages.slice(0, index);
  // Update chat with truncated messages
  chat.messages = newMessages;
  updateChatMessages(chat.id, newMessages);
  // Now re-send the last user message (which is now the last in newMessages)
  const lastMsg = newMessages[newMessages.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    // We'll simulate sending by calling sendMessage but we need to set input?
    // Instead we can directly call the API with the current history.
    // But for simplicity, we'll just set the input to the last user content and call sendMessage?
    // That would add a new user message, which we don't want.
    // Better: send the same payload to /api/chat without adding a new user message.
    // Let's implement a dedicated regenerate function.
    // We'll reuse the send logic but with the current history.
    // This is a bit hacky but works.
    // We'll just set messageInput to the last user content and call sendMessage, but that would duplicate.
    // Instead, we'll create a new function.
    // For brevity, we'll implement by re-using sendMessage but we need to prevent duplicate user message.
    // So we'll store the last user message and then call the API directly.
    // I'll implement a quick helper.
    await regenerateWithHistory(chat.id, newMessages);
  }
}

async function regenerateWithHistory(chatId, history) {
  const chat = conversations.find(c => c.id === chatId);
  if (!chat) return;
  // history is array of messages up to the last user message.
  // We'll send that to AI.
  const payload = { messages: history.map(m => ({ role: m.role, content: m.content })) };
  isGenerating = true;
  sendBtn.textContent = '⏹';
  abortController = new AbortController();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal
    });
    if (!response.ok) throw new Error('Regenerate failed');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';
    // Add placeholder assistant
    chat.messages.push({ role: 'assistant', content: '' });
    updateChatMessages(chat.id, chat.messages);

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
              const last = chat.messages[chat.messages.length - 1];
              if (last.role === 'assistant') {
                last.content = assistantMsg;
                updateChatMessages(chat.id, chat.messages);
              }
            }
          } catch (e) {}
        }
      }
    }
    updateChatMessages(chat.id, chat.messages);
  } catch (err) {
    if (err.name !== 'AbortError') {
      alert('Regenerate error: ' + err.message);
      // Remove placeholder
      if (chat.messages.length > 0 && chat.messages[chat.messages.length-1].role === 'assistant' && chat.messages[chat.messages.length-1].content === '') {
        chat.messages.pop();
        updateChatMessages(chat.id, chat.messages);
      }
    }
  } finally {
    isGenerating = false;
    sendBtn.textContent = '➤';
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

// --- Event listeners ---
newChatBtn.addEventListener('click', () => {
  const chat = createChat('New Chat');
  selectChat(chat.id);
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

// Suggestion chips
chips.forEach(chip => {
  chip.addEventListener('click', () => {
    messageInput.value = chip.dataset.prompt;
    sendMessage();
  });
});

// Theme
function setTheme(dark) {
  isDark = dark;
  document.body.classList.toggle('dark', dark);
  localStorage.setItem('agrideep_theme', dark ? 'dark' : 'light');
  const icon = dark ? '☀️' : '🌓';
  themeTopBtn.textContent = icon;
  themeSidebarBtn.textContent = icon;
}
themeTopBtn.addEventListener('click', () => setTheme(!isDark));
themeSidebarBtn.addEventListener('click', () => setTheme(!isDark));

// Auth placeholder
authTopBtn.addEventListener('click', () => alert('Authentication coming in Phase 3'));
authSidebarBtn.addEventListener('click', () => alert('Authentication coming in Phase 3'));

attachBtn.addEventListener('click', () => alert('File uploads coming in Phase 5'));

// --- Init ---
// Restore dark mode
if (isDark) {
  document.body.classList.add('dark');
  themeTopBtn.textContent = '☀️';
  themeSidebarBtn.textContent = '☀️';
}
// Restore current chat
if (currentChatId) {
  const chat = getCurrentChat();
  if (chat) {
    chatTitle.textContent = chat.title || 'New Chat';
    renderMessages(chat);
  } else {
    currentChatId = null;
    localStorage.removeItem('agrideep_current_chat');
    renderMessages(null);
  }
} else {
  renderMessages(null);
}
renderChatList();

// Handle window resize for sidebar
window.addEventListener('resize', () => {
  if (window.innerWidth >= 768) sidebar.classList.remove('open');
});
