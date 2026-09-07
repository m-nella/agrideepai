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
const chatTitle = document.getElementById('chatTitle');
const authModal = document.getElementById('authModal');
const authModalBody = document.getElementById('authModalBody');
const modalClose = document.querySelector('.modal-close');
const composer = document.getElementById('composer');
const attachmentPreview = document.getElementById('attachmentPreview');

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
  isTemporary: true, // true until first message is sent
};

// --- Supabase init ---
// (same as before, but with loadLocalConversations adapted)

// --- Local storage helpers ---
function loadLocalConversations() {
  const stored = localStorage.getItem('agrideep_local_chats');
  state.chats = stored ? JSON.parse(stored) : [];
  // Remove any empty chats (safety)
  state.chats = state.chats.filter(c => c.messages && c.messages.length > 0);
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
    chatTitle.textContent = 'agrideepai';
  }
  state.isTemporary = false; // existing chats are real
}

function saveLocalConversations() {
  // Filter out empty chats before saving
  const validChats = state.chats.filter(c => c.messages && c.messages.length > 0);
  state.chats = validChats;
  localStorage.setItem('agrideepai_local_chats', JSON.stringify(validChats));
  if (state.activeChatId && validChats.some(c => c.id === state.activeChatId)) {
    localStorage.setItem('agrideepai_local_current', state.activeChatId);
  } else {
    localStorage.removeItem('agrideepai_local_current');
  }
}

// --- New Chat ---
function handleNewChat() {
  // Clear active chat but do NOT create an empty chat
  state.activeChatId = null;
  state.messages = [];
  state.isTemporary = true;
  state.attachments = [];
  attachmentPreview.innerHTML = '';
  renderMessages();
  chatTitle.textContent = 'agrideepai';
  renderChatList();
  messageInput.focus();
  // If on mobile, close sidebar
  if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
}

// --- Send Message (with chat creation on first real message) ---
async function sendMessage() {
  const text = messageInput.value.trim();
  const hasText = text.length > 0;
  const hasAttachments = state.attachments.length > 0;
  if (!hasText && !hasAttachments) return;
  if (state.isGenerating) return;

  let chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    // Create chat only now
    const title = text.substring(0, 42) + (text.length > 42 ? '…' : '');
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
    state.isTemporary = false;
    saveLocalConversations();
    renderChatList();
    chatTitle.textContent = newChat.title;
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
  chat.messages = state.messages; // keep sync
  saveLocalConversations();
  renderMessages();

  messageInput.value = '';
  const atts = [...state.attachments];
  state.attachments = [];
  attachmentPreview.innerHTML = '';
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
  saveLocalConversations();
  renderMessages();

  state.isGenerating = true;
  sendBtn.classList.add('generating');
  sendBtn.disabled = false;
  state.abortController = new AbortController();

  try {
    // Build form data or JSON
    const formData = new FormData();
    formData.append('message', text || '');
    formData.append('search', 'true');
    atts.forEach(f => formData.append('file', f));

    // Use guest or authenticated endpoint
    const endpoint = state.currentUser
      ? `/api/chat/conversations/${chat.id}/messages`
      : '/api/chat/guest';
    const options = {
      method: 'POST',
      body: formData,
      signal: state.abortController.signal,
    };
    if (state.currentUser) {
      const session = await state.supabase.auth.getSession();
      options.headers = { Authorization: `Bearer ${session.data.session?.access_token}` };
    } else {
      // For guest, we need to send the whole history as JSON
      // But we already use formData, so we adapt: we can send JSON instead
      // Let's switch to JSON for guest
      const payload = {
        messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      };
      const response = await fetch('/api/chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: state.abortController.signal,
      });
      await handleResponse(response);
      return;
    }
    const response = await fetch(endpoint, options);
    await handleResponse(response);
  } catch (err) {
    // error handling
  } finally {
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    messageInput.disabled = false;
    state.abortController = null;
    updateSendButton();
  }

  async function handleResponse(response) {
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
                saveLocalConversations();
                renderMessages();
              }
            } else if (parsed.sources) {
              const last = state.messages[state.messages.length - 1];
              if (last && last.role === 'assistant') {
                if (!last.files) last.files = [];
                last.files.push({ sources: parsed.sources });
                chat.messages = state.messages;
                saveLocalConversations();
                renderMessages();
              }
            }
          } catch (e) {}
        }
      }
    }
    // After stream, if authenticated, reload from cloud
    if (state.currentUser) {
      await loadCloudMessages(chat.id);
      await loadCloudConversations();
    } else {
      chat.messages = state.messages;
      saveLocalConversations();
      renderMessages();
      renderChatList();
    }
  }
}

// --- Other functions (copy, edit, regenerate, etc.) remain similar, but ensure they respect no-empty-chat ---

// --- Update send button ---
function updateSendButton() {
  const has = messageInput.value.trim().length > 0 || state.attachments.length > 0;
  sendBtn.disabled = !has;
  sendBtn.style.opacity = has ? '1' : '0.35';
}

// --- Attachment handling ---
attachBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,.txt,.doc,.docx';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files);
    const maxSize = 10 * 1024 * 1024;
    if (files.some(f => f.size > maxSize)) {
      alert('Files must be smaller than 10MB.');
      return;
    }
    state.attachments.push(...files);
    renderAttachments();
    updateSendButton();
  };
  input.click();
});

function renderAttachments() {
  attachmentPreview.innerHTML = '';
  state.attachments.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.innerHTML = `
      <i data-lucide="file-text" style="width:16px;height:16px;"></i>
      <span>${file.name} (${(file.size/1024).toFixed(0)}KB)</span>
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

// --- Event listeners ---
newChatBtn.addEventListener('click', handleNewChat);
openSidebarBtn.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  // Update icon
  const isCollapsed = sidebar.classList.contains('collapsed');
  sidebarToggle.querySelector('[data-lucide="panel-left-close"]').style.display = isCollapsed ? 'none' : 'inline';
  sidebarToggle.querySelector('[data-lucide="panel-left-open"]').style.display = isCollapsed ? 'inline' : 'none';
});
// ... rest of event listeners same as before

// --- Init ---
loadLocalConversations();
updateSendButton();
// Listen to input for send button enable
messageInput.addEventListener('input', updateSendButton);
