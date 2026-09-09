// ============================================================
// AGRIDEEPAI – Full Frontend (Final)
// ============================================================

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
  editingValue: '',
  messageVersions: {},
  likedMessages: new Set(),
  dislikedMessages: new Set(),
  contextMenuTarget: null,
  isShareView: false,
  shareMessages: [],
};

// --- Custom Modal helpers ---
function showCustomModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'customModal';
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close" id="customModalClose">&times;</button>
        <h2>${title}</h2>
        <p style="margin: 1rem 0; color: var(--text-muted);">${message}</p>
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
          <button class="btn-primary ${isDanger ? 'btn-danger' : ''}" id="customModalConfirm" style="flex:1;">${confirmText}</button>
          <button class="btn-primary" id="customModalCancel" style="flex:1; background: transparent; border: 1px solid var(--border); color: var(--text);">${cancelText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => {
      modal.remove();
      resolve(false);
    };

    modal.querySelector('#customModalClose').addEventListener('click', closeModal);
    modal.querySelector('#customModalCancel').addEventListener('click', closeModal);
    modal.querySelector('#customModalConfirm').addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    });
  });
}

function showCustomPrompt(title, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'customPromptModal';
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close" id="customPromptClose">&times;</button>
        <h2>${title}</h2>
        <input type="text" id="customPromptInput" value="${defaultValue}" style="width:100%; margin-top: 0.5rem;" />
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
          <button class="btn-primary" id="customPromptConfirm" style="flex:1;">Save</button>
          <button class="btn-primary" id="customPromptCancel" style="flex:1; background: transparent; border: 1px solid var(--border); color: var(--text);">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('#customPromptInput');
    input.focus();
    input.select();

    const closeModal = () => {
      modal.remove();
      resolve(null);
    };

    modal.querySelector('#customPromptClose').addEventListener('click', closeModal);
    modal.querySelector('#customPromptCancel').addEventListener('click', closeModal);
    modal.querySelector('#customPromptConfirm').addEventListener('click', () => {
      const val = input.value.trim();
      modal.remove();
      resolve(val || null);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(null);
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        modal.remove();
        resolve(val || null);
      }
      if (e.key === 'Escape') {
        modal.remove();
        resolve(null);
      }
    });
  });
}

// --- Clean content ---
function cleanContent(content) {
  if (!content) return content;
  const lines = content.split('\n');
  let result = [];
  let skip = false;
  for (const line of lines) {
    if (/^sources:/i.test(line.trim())) {
      skip = true;
      continue;
    }
    if (skip && line.trim() === '') {
      skip = false;
      continue;
    }
    if (!skip) {
      result.push(line);
    }
  }
  return result.join('\n').trim();
}

// --- Supabase init ---
async function initSupabase() {
  log('Initializing Supabase...', 'info');
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
        // Guest: clear memory state and do NOT load from localStorage
        state.chats = [];
        state.messages = [];
        state.activeChatId = null;
        renderChatList();
        renderMessages();
      }
    });

    const { data: { session } } = await state.supabase.auth.getSession();
    if (session) {
      state.currentUser = session.user;
      updateAuthUI();
      await loadCloudConversations();
    } else {
      updateAuthUI();
      // Guest: start with empty state (no localStorage)
      state.chats = [];
      state.messages = [];
      state.activeChatId = null;
      renderChatList();
      renderMessages();
    }
  } catch (err) {
    log(`Supabase init error: ${err.message}`, 'error');
    // On error, also clear everything for guest
    state.chats = [];
    state.messages = [];
    state.activeChatId = null;
    renderChatList();
    renderMessages();
  }
}

// --- Auth UI ---
function updateAuthUI() {
  if (state.currentUser) {
    const displayName = state.currentUser.email?.split('@')[0] || 'User';
    authSidebarBtn.innerHTML = `<i data-lucide="user"></i><span>${displayName}</span>`;
    authSidebarBtn.onclick = () => openAccountModal();
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

// --- Local storage (deprecated for guest) ---
function loadLocalConversations() {
  log('Loading local conversations (deprecated for guest)', 'debug');
}

function saveLocalConversations() {
  log('Saving local conversations (only for authenticated)', 'debug');
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
    }
  } catch (err) {
    log(`Load cloud conversations error: ${err.message}`, 'error');
  }
}

async function loadCloudMessages(chatId) {
  if (!state.currentUser) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
    state.messages = await res.json();
    rebuildVersions();
    renderMessages();
    renderChatList();
  } catch (err) {
    log(`Load cloud messages error: ${err.message}`, 'error');
  }
}

function rebuildVersions() {
  state.messageVersions = {};
  state.messages.forEach(msg => {
    if (msg.role === 'assistant' && msg.versions && msg.versions.length > 0) {
      state.messageVersions[msg.id] = {
        versions: msg.versions,
        currentIndex: msg.currentVersionIndex || 0
      };
      if (msg.versions.length > 0) {
        msg.content = msg.versions[msg.currentVersionIndex || 0] || '';
      }
    }
  });
}

// --- Render chat list ---
function renderChatList() {
  chatList.innerHTML = '';
  const pinned = state.chats.filter(c => c.pinned);
  const unpinned = state.chats.filter(c => !c.pinned);

  if (pinned.length > 0) {
    const pinContainer = document.createElement('div');
    pinContainer.className = 'pinned-section';
    pinContainer.style.cssText = 'border-bottom: 1px solid var(--border); margin-bottom: 0.5rem; padding-bottom: 0.5rem;';
    const pinLabel = document.createElement('div');
    pinLabel.style.cssText = 'font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; padding: 0.2rem 0.6rem;';
    pinLabel.textContent = 'Pinned';
    pinContainer.appendChild(pinLabel);
    pinned.forEach(chat => appendChatItem(pinContainer, chat));
    chatList.appendChild(pinContainer);
  }

  if (unpinned.length > 0) {
    unpinned.forEach(chat => appendChatItem(chatList, chat));
  }

  if (state.chats.length === 0) {
    chatList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem 0;font-size:0.9rem;">No chats yet</div>';
  }
  window.refreshIcons();
}

function appendChatItem(container, chat) {
  const div = document.createElement('div');
  div.className = `chat-item${chat.id === state.activeChatId ? ' active' : ''}`;
  div.dataset.id = chat.id;
  const titleSpan = document.createElement('span');
  titleSpan.className = 'title';
  titleSpan.textContent = chat.title || 'New Chat';
  if (chat.pinned) {
    const pinIcon = document.createElement('i');
    pinIcon.setAttribute('data-lucide', 'pin');
    pinIcon.style.width = '14px';
    pinIcon.style.height = '14px';
    pinIcon.style.marginRight = '4px';
    pinIcon.style.color = 'var(--accent)';
    titleSpan.prepend(pinIcon);
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
  container.appendChild(div);
}

// --- Render messages (supports normal & share view) ---
function renderMessages() {
  messageList.innerHTML = '';

  // --- Share view ---
  if (state.isShareView) {
    if (!state.shareMessages || state.shareMessages.length === 0) {
      messageList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No messages in this share.</p>';
      return;
    }
    state.shareMessages.forEach((msg) => {
      const row = document.createElement('div');
      row.className = `message-row ${msg.role}`;
      if (msg.role === 'assistant') {
        const header = document.createElement('div');
        header.className = 'assistant-header-row';
        header.innerHTML = '<img src="/logo.png" alt="agrideepai" class="assistant-avatar" /> <span class="assistant-name">agrideepai</span>';
        row.appendChild(header);
      }
      const msgDiv = document.createElement('div');
      msgDiv.className = `message ${msg.role}`;
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      let html = marked.parse(cleanContent(msg.content) || '');
      html = html.replace(/<hr\s*\/?>/g, '');
      contentDiv.innerHTML = html;
      msgDiv.appendChild(contentDiv);
      row.appendChild(msgDiv);
      messageList.appendChild(row);
    });
    welcomeScreen.style.display = 'none';
    messageList.style.display = 'flex';
    return;
  }

  // --- Normal chat ---
  if (!state.messages.length) {
    welcomeScreen.style.display = 'flex';
    messageList.style.display = 'none';
    return;
  }
  welcomeScreen.style.display = 'none';
  messageList.style.display = 'flex';

  const lastIndex = state.messages.length - 1;

  state.messages.forEach((msg, index) => {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;

    if (msg.role === 'assistant') {
      const header = document.createElement('div');
      header.className = 'assistant-header-row';
      header.innerHTML = '<img src="/logo.png" alt="agrideepai" class="assistant-avatar" /> <span class="assistant-name">agrideepai</span>';
      row.appendChild(header);
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${msg.role}`;

    if (state.editingMessageId === msg.id && msg.role === 'user') {
      const editArea = document.createElement('div');
      editArea.style.cssText = 'width:100%;';
      const textarea = document.createElement('textarea');
      textarea.value = state.editingValue;
      textarea.style.cssText =
        'width:100%;padding:0.4rem;border-radius:var(--radius-sm);background:var(--background);color:var(--text);border:1px solid var(--border);resize:vertical;font-family:inherit;font-size:0.95rem;';
      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.3rem;';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText =
        'padding:0.2rem 0.8rem;background:transparent;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);cursor:pointer;';
      cancelBtn.addEventListener('click', () => {
        state.editingMessageId = null;
        renderMessages();
      });
      const sendEditBtn = document.createElement('button');
      sendEditBtn.textContent = 'Send';
      sendEditBtn.className = 'btn-primary';
      sendEditBtn.style.cssText = 'padding:0.2rem 0.8rem;width:auto;';
      sendEditBtn.addEventListener('click', async () => {
        const newContent = textarea.value.trim();
        if (!newContent) return;
        msg.content = newContent;
        const idx = state.messages.indexOf(msg);
        state.messages = state.messages.slice(0, idx + 1);
        state.editingMessageId = null;
        const chat = state.chats.find(c => c.id === state.activeChatId);
        if (chat) {
          chat.messages = state.messages;
          if (!state.currentUser) saveLocalConversations();
        }
        renderMessages();
        await sendEditedUserMessage();
      });
      btnGroup.appendChild(cancelBtn);
      btnGroup.appendChild(sendEditBtn);
      editArea.appendChild(textarea);
      editArea.appendChild(btnGroup);
      msgDiv.appendChild(editArea);
      setTimeout(() => textarea.focus(), 50);
    } else {
      if (msg.role === 'assistant') {
        const isLastMessage = (index === lastIndex);
        const isThinking = isLastMessage && state.isGenerating && msg.content === '';

        if (isThinking) {
          const thinkingDiv = document.createElement('div');
          thinkingDiv.className = 'thinking-indicator';
          thinkingDiv.style.cssText = 'display:flex;align-items:center;gap:0.5rem;color:var(--text-muted);padding:0.2rem 0;';
          thinkingDiv.innerHTML = `
            <div class="spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
            <span>Thinking...</span>
          `;
          msgDiv.appendChild(thinkingDiv);
        } else if (msg.content) {
          const cleaned = cleanContent(msg.content);
          const contentDiv = document.createElement('div');
          contentDiv.className = 'message-content';
          let html = marked.parse(cleaned || '');
          html = html.replace(/<hr\s*\/?>/g, '');
          contentDiv.innerHTML = html;
          msgDiv.appendChild(contentDiv);

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

          if (state.messageVersions[msg.id]) {
            const vData = state.messageVersions[msg.id];
            if (vData.versions.length > 1) {
              const versionControls = document.createElement('div');
              versionControls.className = 'version-controls';
              const prevBtn = document.createElement('button');
              prevBtn.innerHTML = `<i data-lucide="chevron-left" style="width:16px;height:16px;"></i>`;
              prevBtn.title = 'Previous version';
              prevBtn.disabled = vData.currentIndex === 0;
              prevBtn.addEventListener('click', () => {
                if (vData.currentIndex > 0) {
                  vData.currentIndex--;
                  msg.content = vData.versions[vData.currentIndex];
                  const chat = state.chats.find(c => c.id === state.activeChatId);
                  if (chat) {
                    chat.messages = state.messages;
                    if (!state.currentUser) saveLocalConversations();
                  }
                  renderMessages();
                }
              });
              versionControls.appendChild(prevBtn);

              const label = document.createElement('span');
              label.textContent = `${vData.currentIndex + 1} / ${vData.versions.length}`;
              versionControls.appendChild(label);

              const nextBtn = document.createElement('button');
              nextBtn.innerHTML = `<i data-lucide="chevron-right" style="width:16px;height:16px;"></i>`;
              nextBtn.title = 'Next version';
              nextBtn.disabled = vData.currentIndex === vData.versions.length - 1;
              nextBtn.addEventListener('click', () => {
                if (vData.currentIndex < vData.versions.length - 1) {
                  vData.currentIndex++;
                  msg.content = vData.versions[vData.currentIndex];
                  const chat = state.chats.find(c => c.id === state.activeChatId);
                  if (chat) {
                    chat.messages = state.messages;
                    if (!state.currentUser) saveLocalConversations();
                  }
                  renderMessages();
                }
              });
              versionControls.appendChild(nextBtn);
              msgDiv.appendChild(versionControls);
              window.refreshIcons();
            }
          }
        }
      } else {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = msg.content;
        msgDiv.appendChild(contentDiv);
      }

      const showActions = (msg.role === 'user') ||
                          (msg.role === 'assistant' && msg.content && !(state.isGenerating && index === lastIndex && msg.content === ''));

      if (state.editingMessageId !== msg.id && showActions) {
        const actionsRow = document.createElement('div');
        actionsRow.className = 'message-actions-row';

        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = `<i data-lucide="copy" style="width:16px;height:16px;"></i>`;
        copyBtn.title = 'Copy';
        copyBtn.className = 'icon-button-sm';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyMessage(msg);
        });
        actionsRow.appendChild(copyBtn);

        if (msg.role === 'user') {
          const editBtn = document.createElement('button');
          editBtn.innerHTML = `<i data-lucide="pencil" style="width:16px;height:16px;"></i>`;
          editBtn.title = 'Edit';
          editBtn.className = 'icon-button-sm';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEditing(msg);
          });
          actionsRow.appendChild(editBtn);
        }

        if (msg.role === 'assistant') {
          // Like button – toggle colour
          const likeBtn = document.createElement('button');
          const isLiked = state.likedMessages.has(msg.id);
          likeBtn.innerHTML = `<i data-lucide="thumbs-up" style="width:16px;height:16px;"></i>`;
          likeBtn.title = isLiked ? 'Liked' : 'Like';
          if (isLiked) likeBtn.classList.add('liked');
          likeBtn.className = 'icon-button-sm';
          likeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(msg);
          });
          actionsRow.appendChild(likeBtn);

          // Dislike button
          const dislikeBtn = document.createElement('button');
          const isDisliked = state.dislikedMessages.has(msg.id);
          dislikeBtn.innerHTML = `<i data-lucide="thumbs-down" style="width:16px;height:16px;"></i>`;
          dislikeBtn.title = isDisliked ? 'Disliked' : 'Dislike';
          if (isDisliked) dislikeBtn.classList.add('disliked');
          dislikeBtn.className = 'icon-button-sm';
          dislikeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDislike(msg);
          });
          actionsRow.appendChild(dislikeBtn);

          const regenBtn = document.createElement('button');
          regenBtn.innerHTML = `<i data-lucide="rotate-ccw" style="width:16px;height:16px;"></i>`;
          regenBtn.title = 'Regenerate';
          regenBtn.className = 'icon-button-sm';
          regenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            regenerateMessage(index);
          });
          actionsRow.appendChild(regenBtn);

          // Share button – shares this single message
          const shareBtn = document.createElement('button');
          shareBtn.innerHTML = `<i data-lucide="share-2" style="width:16px;height:16px;"></i>`;
          shareBtn.title = 'Share this message';
          shareBtn.className = 'icon-button-sm';
          shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Share only this message
            shareConversation([{ role: msg.role, content: msg.content }]);
          });
          actionsRow.appendChild(shareBtn);
        }

        row.appendChild(msgDiv);
        row.appendChild(actionsRow);
        messageList.appendChild(row);
      } else {
        row.appendChild(msgDiv);
        messageList.appendChild(row);
      }
    }
  });

  window.refreshIcons();
  const container = document.getElementById('chatContainer');
  if (state.shouldScrollToBottom || isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
    state.shouldScrollToBottom = false;
  }
}

function isNearBottom(container, threshold = 150) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// --- Toast ---
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

// --- Copy ---
async function copyMessage(msg) {
  try {
    await navigator.clipboard.writeText(msg.content);
    showToast('Copied!');
  } catch {
    showToast('Unable to copy', true);
  }
}

// --- Like / Dislike toggle ---
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

// --- Start editing ---
function startEditing(msg) {
  if (msg.role !== 'user') return;
  state.editingMessageId = msg.id;
  state.editingValue = msg.content;
  renderMessages();
}

// --- Send after editing ---
async function sendEditedUserMessage() {
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;

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

  state.isGenerating = true;
  state.shouldScrollToBottom = true;
  renderMessages();
  updateSendButton();
  state.abortController = new AbortController();

  try {
    const payload = {
      messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
    };
    const response = await fetch('/api/chat/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: state.abortController.signal,
    });

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
            }
          } catch (e) {}
        }
      }
    }

    const last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant') {
      if (!state.messageVersions[last.id]) {
        state.messageVersions[last.id] = { versions: [], currentIndex: 0 };
      }
      const vData = state.messageVersions[last.id];
      if (vData.versions.length === 0 || vData.versions[vData.versions.length - 1] !== last.content) {
        vData.versions.push(last.content);
        vData.currentIndex = vData.versions.length - 1;
      }
      chat.messages = state.messages;
      if (!state.currentUser) saveLocalConversations();
      renderMessages();
    }

    if (state.currentUser) {
      await loadCloudMessages(chat.id);
      await loadCloudConversations();
    } else {
      chat.messages = state.messages;
      // Do NOT save to localStorage for guests
      renderMessages();
      renderChatList();
    }

  } catch (err) {
    if (err.name !== 'AbortError') {
      log(`Send edited error: ${err.message}`, 'error');
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

// --- Regenerate ---
async function regenerateMessage(index) {
  const msg = state.messages[index];
  if (!msg || msg.role !== 'assistant') return;
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;
  log(`Regenerating message at index ${index}`, 'debug');

  const contextMessages = state.messages.slice(0, index);
  if (contextMessages.length === 0 || contextMessages[contextMessages.length - 1].role !== 'user') {
    showToast('Cannot regenerate: no user message before this response', true);
    return;
  }

  if (!state.messageVersions[msg.id]) {
    state.messageVersions[msg.id] = { versions: [], currentIndex: 0 };
  }
  const vData = state.messageVersions[msg.id];
  vData.versions.push('');
  vData.currentIndex = vData.versions.length - 1;
  msg.content = '';
  chat.messages = state.messages;
  if (!state.currentUser) saveLocalConversations();

  state.isGenerating = true;
  state.shouldScrollToBottom = true;
  renderMessages();
  updateSendButton();
  state.abortController = new AbortController();

  try {
    const payload = {
      messages: contextMessages.map(m => ({ role: m.role, content: m.content })),
    };
    const response = await fetch('/api/chat/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: state.abortController.signal,
    });

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
              vData.versions[vData.versions.length - 1] = full;
              msg.content = full;
              chat.messages = state.messages;
              if (!state.currentUser) saveLocalConversations();
              renderMessages();
            }
          } catch (e) {}
        }
      }
    }

    if (vData.versions.length > 0) {
      vData.versions[vData.versions.length - 1] = full;
      msg.content = full;
      chat.messages = state.messages;
      if (!state.currentUser) saveLocalConversations();
      renderMessages();
    }

    if (state.currentUser) {
      await loadCloudMessages(chat.id);
      await loadCloudConversations();
    }

  } catch (err) {
    if (err.name !== 'AbortError') {
      log(`Regenerate error: ${err.message}`, 'error');
      showToast('Regenerate failed: ' + err.message, true);
      if (vData.versions.length > 0 && vData.versions[vData.versions.length - 1] === '') {
        vData.versions.pop();
        if (vData.versions.length > 0) {
          vData.currentIndex = vData.versions.length - 1;
          msg.content = vData.versions[vData.currentIndex];
        } else {
          msg.content = '';
        }
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

// --- Share Conversation (supports chat or single message) ---
async function shareConversation(messagesToShare = null) {
  // If messagesToShare is null, share the whole chat (default behaviour)
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat && !messagesToShare) {
    showToast('No chat to share', true);
    return;
  }

  // Determine what to share
  let messages;
  if (messagesToShare) {
    // Share only the provided messages (e.g., a single message)
    messages = messagesToShare;
  } else {
    // Share the whole conversation
    messages = state.messages.map(m => ({ role: m.role, content: m.content }));
  }

  if (!messages || messages.length === 0) {
    showToast('Nothing to share', true);
    return;
  }

  try {
    let response;
    if (state.currentUser && !messagesToShare) {
      // Authenticated user sharing a whole chat – use the existing endpoint
      response = await apiFetch(`/api/chat/share/${chat.id}`, { method: 'POST' });
    } else {
      // Guest or sharing a single message – use the guest share endpoint
      response = await fetch('/api/share/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
    }
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to generate share link');
    }
    const data = await response.json();
    shareLinkDisplay.textContent = data.url;
    shareModal.classList.remove('hidden');
    copyShareLink.onclick = () => {
      navigator.clipboard.writeText(data.url).then(() => {
        showToast('Link copied!');
      });
    };
  } catch (err) {
    log(`Share error: ${err.message}`, 'error');
    showToast('Failed to generate share link: ' + err.message, true);
  }
}

// --- Chat CRUD (guest chats are in-memory only) ---
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
  // Do NOT save to localStorage for guests
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

// --- Select, delete, rename, pin ---
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
      rebuildVersions();
      renderMessages();
      renderChatList();
    }
  }
  if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
  chatMenu.classList.add('hidden');
}

async function deleteChat(id) {
  const confirmed = await showCustomModal(
    'Delete Chat',
    'Are you sure you want to delete this chat? This action cannot be undone.',
    'Delete',
    'Cancel',
    true
  );
  if (!confirmed) return;

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
    renderChatList();
  }
  chatMenu.classList.add('hidden');
}

async function renameChat(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  const newTitle = await showCustomPrompt('Rename Chat', chat.title);
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
    renderChatList();
  }
  chatMenu.classList.add('hidden');
}

// --- Context menu ---
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
      const chat = state.chats.find(c => c.id === chatId);
      btn.textContent = chat?.pinned ? 'Unpin' : 'Pin';
      btn.innerHTML = `<i data-lucide="${chat?.pinned ? 'pin-off' : 'pin'}"></i> ${chat?.pinned ? 'Unpin' : 'Pin'}`;
      btn.onclick = () => {
        chatMenu.classList.add('hidden');
        togglePin(chatId);
      };
    } else if (action === 'share') {
      btn.onclick = () => {
        chatMenu.classList.add('hidden');
        shareConversation(); // share whole chat
      };
    } else if (action === 'rename') {
      btn.onclick = () => {
        chatMenu.classList.add('hidden');
        renameChat(chatId);
      };
    } else if (action === 'delete') {
      btn.onclick = () => {
        chatMenu.classList.add('hidden');
        deleteChat(chatId);
      };
    }
  });
  window.refreshIcons();
}

document.addEventListener('click', (e) => {
  if (!chatMenu.contains(e.target) && !e.target.closest('.chat-item .actions')) {
    chatMenu.classList.add('hidden');
  }
});

// --- New Chat ---
function handleNewChat() {
  log('New Chat clicked', 'info');
  const emptyChat = state.chats.find(chat => chat.messages.length === 0);
  if (emptyChat) {
    selectChat(emptyChat.id);
    log('Selected existing empty chat', 'debug');
    return;
  }
  createChat('New Chat').then(chat => {
    if (chat) {
      state.activeChatId = chat.id;
      state.messages = [];
      state.editingMessageId = null;
      state.messageVersions = {};
      renderMessages();
      renderChatList();
      messageInput.focus();
      if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
    }
  });
}

// --- Composer ---
function resizeComposer() {
  messageInput.style.height = '0px';
  const maxHeight = 120;
  const sh = messageInput.scrollHeight;
  messageInput.style.height = Math.min(sh, maxHeight) + 'px';
  messageInput.style.overflowY = sh > maxHeight ? 'auto' : 'hidden';
}

function updateSendButton() {
  const hasContent = messageInput.value.trim().length > 0 || state.attachments.length > 0;
  const sendIcon = sendBtn.querySelector('.send-icon');
  const stopIcon = sendBtn.querySelector('.stop-icon');

  if (!state.isGenerating) {
    if (sendIcon) sendIcon.style.display = 'inline';
    if (stopIcon) stopIcon.style.display = 'none';
    sendBtn.disabled = !hasContent;
    sendBtn.style.opacity = hasContent ? '1' : '0.3';
    sendBtn.classList.remove('generating');
  } else {
    if (sendIcon) sendIcon.style.display = 'none';
    if (stopIcon) stopIcon.style.display = 'inline';
    sendBtn.disabled = false;
    sendBtn.style.opacity = '1';
    sendBtn.classList.add('generating');
  }
}

// --- Attachment preview with thumbnails ---
function renderAttachments() {
  attachmentPreview.innerHTML = '';
  state.attachments.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (file.type && file.type.startsWith('image/')) {
      // Image thumbnail
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.cssText = 'width:40px; height:40px; object-fit:cover; border-radius:4px;';
      chip.appendChild(img);
    } else {
      // Document icon
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'file-text');
      icon.style.width = '24px';
      icon.style.height = '24px';
      chip.appendChild(icon);
    }
    const nameSpan = document.createElement('span');
    nameSpan.textContent = file.name;
    nameSpan.style.cssText = 'font-size:0.8rem; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    chip.appendChild(nameSpan);
    const removeBtn = document.createElement('button');
    removeBtn.innerHTML = `<i data-lucide="x" style="width:14px;height:14px;"></i>`;
    removeBtn.dataset.index = idx;
    removeBtn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      state.attachments.splice(idx, 1);
      renderAttachments();
      updateSendButton();
    });
    chip.appendChild(removeBtn);
    attachmentPreview.appendChild(chip);
  });
  window.refreshIcons();
}

// --- Send message (main) ---
async function sendMessage() {
  const text = messageInput.value.trim();
  const hasText = text.length > 0;
  const hasAttachments = state.attachments.length > 0;
  if (!hasText && !hasAttachments) return;
  if (state.isGenerating) return;

  let chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    const title = text.substring(0, 42) + (text.length > 42 ? '…' : '') || 'New Chat';
    log(`Creating new chat with title: "${title}"`, 'info');
    const newChat = {
      id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      title,
      messages: [],
      pinned: false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    state.chats.unshift(newChat);
    state.activeChatId = newChat.id;
    if (!state.currentUser) {
      // Guest: no save
      renderChatList();
    } else {
      // Logged in: create cloud chat instead
      // We'll redirect: call createChat and then use that chat
      // But we are in the middle of sending, so we'll handle it differently.
      // Simpler: if logged in, we should have called createChat earlier.
      // We'll just proceed with local chat but also create cloud? Better to always use createChat.
      // We'll check again: if logged in, we'll call createChat and return.
      if (state.currentUser) {
        // Cancel this flow and use createChat
        showToast('Creating cloud chat...', false);
        const cloudChat = await createChat(title);
        if (cloudChat) {
          state.activeChatId = cloudChat.id;
          state.messages = [];
          renderChatList();
          renderMessages();
          // Re-run sendMessage after chat creation
          sendMessage();
        }
        return;
      }
    }
    chat = newChat;
  }

  // If logged in and chat is local, convert to cloud? Not needed if we used createChat.
  // We'll assume we have a valid chat.

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

  state.isGenerating = true;
  state.shouldScrollToBottom = true;
  renderMessages();
  updateSendButton();

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
            }
          } catch (e) {}
        }
      }
    }

    const last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant') {
      if (!state.messageVersions[last.id]) {
        state.messageVersions[last.id] = { versions: [], currentIndex: 0 };
      }
      const vData = state.messageVersions[last.id];
      if (vData.versions.length === 0 || vData.versions[vData.versions.length - 1] !== last.content) {
        vData.versions.push(last.content);
        vData.currentIndex = vData.versions.length - 1;
      }
      chat.messages = state.messages;
      if (!state.currentUser) saveLocalConversations();
      renderMessages();
    }

    if (state.currentUser) {
      await loadCloudMessages(chat.id);
      await loadCloudConversations();
    } else {
      chat.messages = state.messages;
      // Do NOT save to localStorage for guests
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

// ---------- Helper: password toggle ----------
function createPasswordField(id, placeholder) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative; width:100%;';
  const input = document.createElement('input');
  input.type = 'password';
  input.id = id;
  input.placeholder = placeholder;
  input.style.cssText = 'width:100%; padding-right: 40px;';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.innerHTML = `<i data-lucide="eye" style="width:18px; height:18px;"></i>`;
  toggle.style.cssText = 'position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-muted); cursor:pointer;';
  toggle.onclick = () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggle.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}" style="width:18px; height:18px;"></i>`;
    window.refreshIcons();
  };
  wrapper.appendChild(input);
  wrapper.appendChild(toggle);
  return wrapper;
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

// --- Render Auth Form (with password toggles) ---
function renderAuthForm(mode) {
  const isLogin = mode === 'login';
  authModalBody.innerHTML = `
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div id="authError" class="error-msg" style="display:none;"></div>
    <div id="authStatus" class="status-msg" style="display:none;"></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com" />
    <label>Password</label>
    <div id="authPasswordWrapper"></div>
    ${!isLogin ? `
      <label>Confirm Password</label>
      <div id="authConfirmPasswordWrapper"></div>
    ` : ''}
    ${!isLogin ? `<label>Full Name (optional)</label><input type="text" id="authFullName" placeholder="Your name" />` : ''}
    <button class="btn-primary" id="authSubmitBtn" disabled>${isLogin ? 'Sign In' : 'Sign Up'}</button>
    <div class="toggle-link" id="authToggle">${isLogin ? 'Create an account' : 'Already have an account? Sign in'}</div>
    ${!isLogin ? `<div id="verifySection" style="display:none; margin-top:1rem;">
      <p>We sent a verification code to your email. Enter it below:</p>
      <input type="text" id="verifyCode" placeholder="6-digit code" />
      <button class="btn-primary" id="verifyBtn">Verify & Create Account</button>
      <button id="resendVerifyBtn" style="background:none;border:none;color:var(--accent);cursor:pointer;margin-top:0.5rem;">Resend code</button>
    </div>` : ''}
  `;

  // Insert password fields with toggle
  const pwWrapper = document.getElementById('authPasswordWrapper');
  pwWrapper.appendChild(createPasswordField('authPassword', '••••••••'));
  if (!isLogin) {
    const confirmWrapper = document.getElementById('authConfirmPasswordWrapper');
    confirmWrapper.appendChild(createPasswordField('authConfirmPassword', 'Confirm password'));
  }
  window.refreshIcons();

  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleLink = document.getElementById('authToggle');
  const errorDiv = document.getElementById('authError');
  const statusDiv = document.getElementById('authStatus');

  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmInput = document.getElementById('authConfirmPassword');
  const verifySection = document.getElementById('verifySection');

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

  // Signup flow: step 1 - send intent
  submitBtn.addEventListener('click', async () => {
    if (!isLogin) {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const confirm = confirmInput ? confirmInput.value : '';
      if (!email || !password) {
        errorDiv.textContent = 'Email and password required.';
        errorDiv.style.display = 'block';
        return;
      }
      if (password !== confirm) {
        errorDiv.textContent = 'Passwords do not match.';
        errorDiv.style.display = 'block';
        return;
      }
      const fullName = document.getElementById('authFullName')?.value.trim() || email.split('@')[0];
      errorDiv.style.display = 'none';
      statusDiv.textContent = 'Sending code...';
      statusDiv.style.display = 'block';
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, fullName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send code.');
        verifySection.style.display = 'block';
        statusDiv.textContent = 'Verification code sent. Check your email.';
        const verifyBtn = document.getElementById('verifyBtn');
        const resendBtn = document.getElementById('resendVerifyBtn');
        const codeInput = document.getElementById('verifyCode');

        verifyBtn.onclick = async () => {
          const code = codeInput.value.trim();
          if (!code) {
            errorDiv.textContent = 'Enter the code.';
            errorDiv.style.display = 'block';
            return;
          }
          errorDiv.style.display = 'none';
          statusDiv.textContent = 'Verifying and creating account...';
          statusDiv.style.display = 'block';
          try {
            const confirmRes = await fetch('/api/auth/confirm-signup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, code }),
            });
            const confirmData = await confirmRes.json();
            if (!confirmRes.ok) throw new Error(confirmData.error || 'Verification failed.');
            state.currentUser = confirmData.user;
            updateAuthUI();
            closeAuthModal();
            showToast('Account created and verified! You are now signed in.');
            await loadCloudConversations();
          } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
            statusDiv.style.display = 'none';
          }
        };

        resendBtn.onclick = async () => {
          statusDiv.textContent = 'Resending code...';
          statusDiv.style.display = 'block';
          try {
            const res = await fetch('/api/auth/resend-verification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
            });
            if (!res.ok) throw new Error('Failed to resend.');
            showToast('New code sent.');
            statusDiv.textContent = 'New code sent. Check your email.';
          } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
          } finally {
            statusDiv.style.display = 'none';
          }
        };
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
        statusDiv.style.display = 'none';
      } finally {
        submitBtn.disabled = false;
      }
    } else {
      // Login flow
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) {
        errorDiv.textContent = 'Email and password required.';
        errorDiv.style.display = 'block';
        return;
      }
      errorDiv.style.display = 'none';
      statusDiv.textContent = 'Signing in...';
      statusDiv.style.display = 'block';
      submitBtn.disabled = true;
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        if (data.requires2fa) {
          // Show 2FA input
          statusDiv.textContent = 'Please enter your 2FA code';
          // Replace the form with 2FA input
          const twofaHtml = `
            <h2>Two-Factor Authentication</h2>
            <p style="margin-bottom:1rem;">Enter the code from your authenticator app.</p>
            <label>Code</label>
            <input type="text" id="twofaCode" placeholder="6-digit code" />
            <button class="btn-primary" id="twofaSubmitBtn">Verify</button>
            <div id="twofaError" class="error-msg" style="display:none;"></div>
          `;
          authModalBody.innerHTML = twofaHtml;
          window.refreshIcons();
          document.getElementById('twofaSubmitBtn').addEventListener('click', async () => {
            const code = document.getElementById('twofaCode').value.trim();
            if (!code) {
              document.getElementById('twofaError').textContent = 'Enter the code.';
              document.getElementById('twofaError').style.display = 'block';
              return;
            }
            try {
              const verifyRes = await fetch('/api/auth/2fa/validate-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tempToken: data.tempToken, code }),
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok) throw new Error(verifyData.error || 'Invalid code');
              state.currentUser = verifyData.user;
              updateAuthUI();
              closeAuthModal();
              showToast('Signed in successfully!');
              await loadCloudConversations();
            } catch (err) {
              document.getElementById('twofaError').textContent = err.message;
              document.getElementById('twofaError').style.display = 'block';
            }
          });
          return;
        }
        // Normal login
        state.currentUser = data.user;
        updateAuthUI();
        closeAuthModal();
        showToast('Signed in successfully!');
        await loadCloudConversations();
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
        statusDiv.style.display = 'none';
      } finally {
        submitBtn.disabled = false;
      }
    }
  });
}

// --- Account Modal (tabs: Profile, Account, Security, Sessions, Logout) ---
async function openAccountModal() {
  if (!state.currentUser) return;

  let profile = {};
  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    profile = data.profile || {};
  } catch (e) {}

  const modal = document.createElement('div');
  modal.className = 'modal account-modal';
  modal.id = 'accountModal';
  modal.innerHTML = `
    <div class="modal-content account-modal-content">
      <button class="modal-close" id="accountModalClose">&times;</button>
      <div class="account-modal-layout">
        <div class="account-tabs">
          <div class="account-tab active" data-tab="profile"><i data-lucide="user"></i> Profile</div>
          <div class="account-tab" data-tab="account"><i data-lucide="settings"></i> Account</div>
          <div class="account-tab" data-tab="security"><i data-lucide="shield"></i> Security</div>
          <div class="account-tab" data-tab="sessions"><i data-lucide="monitor"></i> Sessions</div>
          <div class="account-tab logout-tab" data-tab="logout"><i data-lucide="log-out"></i> Log out</div>
        </div>
        <div class="account-content" id="accountContent"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#accountModalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const tabs = modal.querySelectorAll('.account-tab');
  const contentArea = modal.querySelector('#accountContent');

  function renderTab(tabId) {
    tabs.forEach(t => t.classList.remove('active'));
    const activeTab = modal.querySelector(`[data-tab="${tabId}"]`);
    if (activeTab) activeTab.classList.add('active');

    if (tabId === 'logout') {
      contentArea.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:1rem;">
          <h2>Log out</h2>
          <p>Are you sure you want to sign out?</p>
          <button class="btn-primary" id="logoutConfirmBtn" style="background:var(--danger);">Log out</button>
          <button class="btn-primary" id="logoutCancelBtn" style="background:transparent;border:1px solid var(--border);color:var(--text);">Cancel</button>
        </div>
      `;
      contentArea.querySelector('#logoutConfirmBtn').addEventListener('click', async () => {
        await state.supabase.auth.signOut();
        closeModal();
        showToast('Logged out');
        // Reset guest state
        state.chats = [];
        state.messages = [];
        state.activeChatId = null;
        renderChatList();
        renderMessages();
      });
      contentArea.querySelector('#logoutCancelBtn').addEventListener('click', () => {
        renderTab('profile');
      });
      return;
    }

    let html = '';
    if (tabId === 'profile') {
      html = `
        <h2>Profile</h2>
        <div class="profile-info">
          <p><strong>Name:</strong> ${profile.full_name || state.currentUser.email}</p>
          <p><strong>Email:</strong> ${state.currentUser.email}</p>
          <p><strong>Member since:</strong> ${new Date(state.currentUser.created_at).toLocaleDateString()}</p>
        </div>
      `;
    } else if (tabId === 'account') {
      html = `
        <h2>Account Settings</h2>
        <div class="account-section">
          <label>Email</label>
          <input type="email" id="changeEmailInput" value="${state.currentUser.email}" />
          <button class="btn-primary" id="changeEmailBtn">Change Email</button>
          <div id="emailVerification" style="display:none; margin-top:0.5rem;">
            <label>Verification code</label>
            <input type="text" id="emailCodeInput" placeholder="6-digit code" />
            <button class="btn-primary" id="emailVerifyBtn">Verify & Change</button>
          </div>
          <hr />
          <label>Current Password</label>
          <div id="currentPasswordWrapper"></div>
          <label>New Password</label>
          <div id="newPasswordWrapper"></div>
          <button class="btn-primary" id="changePasswordBtn">Change Password</button>
          <div id="passwordVerification" style="display:none; margin-top:0.5rem;">
            <label>Verification code</label>
            <input type="text" id="passwordCodeInput" placeholder="6-digit code" />
            <button class="btn-primary" id="passwordVerifyBtn">Verify & Change</button>
          </div>
        </div>
      `;
    } else if (tabId === 'security') {
      const twofaEnabled = profile.two_factor_enabled || false;
      html = `
        <h2>Security</h2>
        <div class="security-section">
          <h3>Two-Factor Authentication</h3>
          <p>${twofaEnabled ? '2FA is currently enabled.' : '2FA is disabled.'}</p>
          <div id="twofaSetupArea">
            ${twofaEnabled ? `
              <button class="btn-primary btn-danger" id="disable2faBtn">Disable 2FA</button>
            ` : `
              <button class="btn-primary" id="enable2faBtn">Enable 2FA</button>
              <div id="twofaSetup" style="display:none; margin-top:1rem;">
                <div class="twofa-setup">
                  <p>Scan this QR code with your authenticator app (e.g., Google Authenticator).</p>
                  <div id="qrCodeContainer"></div>
                  <label>Enter the 6-digit code:</label>
                  <input type="text" id="twofaSetupCode" placeholder="123456" />
                  <button class="btn-primary" id="twofaSetupVerifyBtn">Verify & Enable</button>
                </div>
              </div>
            `}
          </div>
        </div>
      `;
    } else if (tabId === 'sessions') {
      html = `
        <h2>Active Sessions</h2>
        <div class="sessions-list">
          <p>You are logged in on this device.</p>
          <p style="font-size:0.8rem;color:var(--text-muted);">No other sessions detected.</p>
        </div>
      `;
    }
    contentArea.innerHTML = html;
    window.refreshIcons();

    // Attach event listeners for the tab
    if (tabId === 'account') {
      const currentPwWrapper = document.getElementById('currentPasswordWrapper');
      if (currentPwWrapper) {
        currentPwWrapper.appendChild(createPasswordField('currentPasswordInput', 'Current password'));
      }
      const newPwWrapper = document.getElementById('newPasswordWrapper');
      if (newPwWrapper) {
        newPwWrapper.appendChild(createPasswordField('newPasswordInput', 'New password'));
      }
      window.refreshIcons();

      const changeEmailBtn = document.getElementById('changeEmailBtn');
      const changePasswordBtn = document.getElementById('changePasswordBtn');

      changeEmailBtn.addEventListener('click', async () => {
        const newEmail = document.getElementById('changeEmailInput').value.trim();
        if (!newEmail || newEmail === state.currentUser.email) {
          showToast('Please enter a different email.', true);
          return;
        }
        try {
          await apiFetch('/api/auth/send-verification-code', {
            method: 'POST',
            body: JSON.stringify({ action: 'change-email' }),
          });
          showToast('Verification code sent to your email.');
          document.getElementById('emailVerification').style.display = 'block';
          document.getElementById('emailVerifyBtn').addEventListener('click', async () => {
            const code = document.getElementById('emailCodeInput').value.trim();
            if (!code) { showToast('Enter code.', true); return; }
            try {
              await apiFetch('/api/auth/verify-code', {
                method: 'POST',
                body: JSON.stringify({ code, action: 'change-email' }),
              });
              await apiFetch('/api/auth/change-email', {
                method: 'POST',
                body: JSON.stringify({ newEmail, code }),
              });
              showToast('Email changed! Please verify the new email.');
              closeModal();
            } catch (err) {
              showToast(err.message, true);
            }
          });
        } catch (err) {
          showToast(err.message, true);
        }
      });

      changePasswordBtn.addEventListener('click', async () => {
        const current = document.getElementById('currentPasswordInput').value;
        const newPw = document.getElementById('newPasswordInput').value;
        if (!current || !newPw) {
          showToast('Please fill in both password fields.', true);
          return;
        }
        if (newPw.length < 8) {
          showToast('New password must be at least 8 characters.', true);
          return;
        }
        try {
          await apiFetch('/api/auth/send-verification-code', {
            method: 'POST',
            body: JSON.stringify({ action: 'change-password' }),
          });
          showToast('Verification code sent to your email.');
          document.getElementById('passwordVerification').style.display = 'block';
          document.getElementById('passwordVerifyBtn').addEventListener('click', async () => {
            const code = document.getElementById('passwordCodeInput').value.trim();
            if (!code) { showToast('Enter code.', true); return; }
            try {
              await apiFetch('/api/auth/verify-code', {
                method: 'POST',
                body: JSON.stringify({ code, action: 'change-password' }),
              });
              await apiFetch('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: current, newPassword: newPw, code }),
              });
              showToast('Password changed successfully.');
              closeModal();
            } catch (err) {
              showToast(err.message, true);
            }
          });
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    if (tabId === 'security') {
      const enableBtn = document.getElementById('enable2faBtn');
      const disableBtn = document.getElementById('disable2faBtn');
      if (enableBtn) {
        enableBtn.addEventListener('click', async () => {
          try {
            const res = await apiFetch('/api/auth/2fa/enable', { method: 'POST' });
            const data = await res.json();
            // Show QR code
            const qrContainer = document.getElementById('qrCodeContainer');
            if (qrContainer) {
              qrContainer.innerHTML = `<img src="${data.qrCodeDataUrl}" alt="QR Code" class="qr-code" />`;
            }
            document.getElementById('twofaSetup').style.display = 'block';
            document.getElementById('twofaSetupVerifyBtn').addEventListener('click', async () => {
              const code = document.getElementById('twofaSetupCode').value.trim();
              if (!code) { showToast('Enter the code.', true); return; }
              try {
                const verifyRes = await apiFetch('/api/auth/2fa/verify', {
                  method: 'POST',
                  body: JSON.stringify({ code }),
                });
                await verifyRes.json();
                showToast('2FA enabled successfully.');
                closeModal();
                // Reopen to refresh security tab
                openAccountModal();
              } catch (err) {
                showToast(err.message, true);
              }
            });
          } catch (err) {
            showToast(err.message, true);
          }
        });
      }
      if (disableBtn) {
        disableBtn.addEventListener('click', async () => {
          try {
            await apiFetch('/api/auth/2fa/disable', { method: 'POST' });
            showToast('2FA disabled.');
            closeModal();
            openAccountModal();
          } catch (err) {
            showToast(err.message, true);
          }
        });
      }
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      renderTab(tabId);
    });
  });

  renderTab('profile');
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
    const prompt = chip.dataset.prompt;
    messageInput.value = prompt;
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

// --- Share view detection ---
async function checkShareView() {
  const path = window.location.pathname;
  if (path.startsWith('/share/')) {
    const token = path.split('/share/')[1];
    if (token) {
      state.isShareView = true;
      sidebar.style.display = 'none';
      document.getElementById('composerArea').style.display = 'none';
      document.getElementById('topBar').style.display = 'none';
      try {
        const res = await fetch(`/api/share/${token}`);
        if (!res.ok) throw new Error('Share not found');
        const data = await res.json();
        state.shareMessages = data.messages || [];
        renderMessages();
        document.title = 'Shared Chat - AgriDeepAI';
      } catch (err) {
        log(`Share view error: ${err.message}`, 'error');
        messageList.innerHTML = `<p style="color:var(--danger);text-align:center;padding:2rem;">Error loading share: ${err.message}</p>`;
      }
      return true;
    }
  }
  return false;
}

// --- Init ---
(async function init() {
  const isShare = await checkShareView();
  if (!isShare) {
    await initSupabase();
    updateSendButton();
  }
})();
