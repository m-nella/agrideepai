// ============================================================
// AGRIDEEPAI — Full Frontend (Final)
// ============================================================

const log = (msg, type = 'info') => console.log(`[FRONTEND] [${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}`);

// CRITICAL: apply share-view class IMMEDIATELY
if (window.location.pathname.startsWith('/share/')) {
  document.body.classList.add('share-view');
  // Force-hide anything left over
  document.documentElement.style.background = '#171b20';
}

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

const MAX_ATTACHMENTS = 5;

let state = {
  activeChatId: null, chats: [], messages: [],
  isGenerating: false, abortController: null,
  supabase: null, currentUser: null,
  attachments: [], editingMessageId: null, editingValue: '',
  messageVersions: {}, likedMessages: new Set(), dislikedMessages: new Set(),
  contextMenuTarget: null, isShareView: false, shareMessages: [], copyTimeout: null,
};

// ============ LIGHTBOX ============
function openLightbox(src, isImage = true) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:2rem;cursor:zoom-out;';
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'position:absolute;top:1rem;right:1rem;background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:2rem;cursor:pointer;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
  closeBtn.onclick = (e) => { e.stopPropagation(); overlay.remove(); };
  overlay.appendChild(closeBtn);
  if (isImage) {
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
    overlay.appendChild(img);
  } else {
    const link = document.createElement('a');
    link.href = src; link.target = '_blank';
    link.style.cssText = 'color:#fff;font-size:1.2rem;text-decoration:underline;';
    link.textContent = 'Open file in new tab';
    overlay.appendChild(link);
  }
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ============ MODALS ============
function showCustomModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close" id="customModalClose">&times;</button>
        <h2>${title}</h2>
        <p style="margin:1rem 0;color:var(--text-muted);">${message}</p>
        <div style="display:flex;gap:.5rem;margin-top:1rem;">
          <button class="btn-primary ${isDanger ? 'btn-danger' : ''}" id="customModalConfirm" style="flex:1;">${confirmText}</button>
          <button class="btn-primary" id="customModalCancel" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);">${cancelText}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); resolve(false); };
    modal.querySelector('#customModalClose').onclick = close;
    modal.querySelector('#customModalCancel').onclick = close;
    modal.querySelector('#customModalConfirm').onclick = () => { modal.remove(); resolve(true); };
    modal.onclick = (e) => { if (e.target === modal) close(); };
  });
}

function showCustomPrompt(title, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close" id="customPromptClose">&times;</button>
        <h2>${title}</h2>
        <input type="text" id="customPromptInput" value="${defaultValue}" style="width:100%;margin-top:.5rem;" />
        <div style="display:flex;gap:.5rem;margin-top:1rem;">
          <button class="btn-primary" id="customPromptConfirm" style="flex:1;">Save</button>
          <button class="btn-primary" id="customPromptCancel" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#customPromptInput');
    input.focus(); input.select();
    const close = () => { modal.remove(); resolve(null); };
    modal.querySelector('#customPromptClose').onclick = close;
    modal.querySelector('#customPromptCancel').onclick = close;
    modal.querySelector('#customPromptConfirm').onclick = () => { const v = input.value.trim(); modal.remove(); resolve(v || null); };
    modal.onclick = (e) => { if (e.target === modal) close(); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { const v = input.value.trim(); modal.remove(); resolve(v || null); }
      if (e.key === 'Escape') close();
    };
  });
}

// ============ CLEAN CONTENT ============
function cleanContent(content) {
  if (!content) return content;
  const lines = content.split('\n');
  const out = []; let skip = false;
  for (const line of lines) {
    if (/^sources:/i.test(line.trim())) { skip = true; continue; }
    if (skip && line.trim() === '') { skip = false; continue; }
    if (!skip) out.push(line);
  }
  return out.join('\n').trim();
}

// ============ SUPABASE INIT (with persistence) ============
async function initSupabase() {
  log('Initializing Supabase...', 'info');
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    state.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: window.localStorage,
        storageKey: 'agrideepai-auth-v1',
      },
    });

    state.supabase.auth.onAuthStateChange(async (event, session) => {
      log(`Auth state change: ${event}`, 'debug');
      if (event === 'TOKEN_REFRESHED' && session) {
        state.currentUser = session.user;
        return;
      }
      if (session?.user) {
        state.currentUser = session.user;
        updateAuthUI();
        await loadCloudConversations();
      } else {
        state.currentUser = null;
        state.chats = []; state.messages = []; state.activeChatId = null;
        updateAuthUI();
        renderChatList(); renderMessages();
      }
    });

    // Wait for initial session
    const { data: { session } } = await state.supabase.auth.getSession();
    if (session?.user) {
      state.currentUser = session.user;
      updateAuthUI();
      await loadCloudConversations();
    } else {
      // Try refreshing in case token expired
      const { data: refreshed } = await state.supabase.auth.refreshSession();
      if (refreshed.session?.user) {
        state.currentUser = refreshed.session.user;
        updateAuthUI();
        await loadCloudConversations();
      } else {
        updateAuthUI();
        renderChatList(); renderMessages();
      }
    }
  } catch (err) {
    log(`Supabase init error: ${err.message}`, 'error');
    state.chats = []; state.messages = []; state.activeChatId = null;
    renderChatList(); renderMessages();
  }
}

function updateAuthUI() {
  if (state.currentUser) {
    const name = state.currentUser.email?.split('@')[0] || 'User';
    authSidebarBtn.innerHTML = `<i data-lucide="user"></i><span>${name}</span>`;
    authSidebarBtn.onclick = () => openAccountModal();
  } else {
    authSidebarBtn.innerHTML = `<i data-lucide="log-in"></i><span>Sign In</span>`;
    authSidebarBtn.onclick = () => openAuthModal('login');
  }
  window.refreshIcons();
}

// ============ ROBUST API FETCH WITH AUTO-REFRESH ============
async function apiFetch(endpoint, options = {}) {
  if (!state.supabase) throw new Error('Not initialized');

  let session = (await state.supabase.auth.getSession()).data.session;
  if (!session) {
    try {
      const { data } = await state.supabase.auth.refreshSession();
      session = data.session;
    } catch (e) {}
  }
  if (!session?.access_token) throw new Error('Not authenticated');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    ...options.headers,
  };

  let res = await fetch(endpoint, { ...options, headers });

  // If 401, try refreshing and retrying once
  if (res.status === 401) {
    log('Got 401, attempting refresh', 'warn');
    const { data } = await state.supabase.auth.refreshSession();
    if (data.session?.access_token) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${data.session.access_token}` };
      res = await fetch(endpoint, { ...options, headers: retryHeaders });
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res;
}

// ============ CLOUD CONVERSATIONS ============
async function loadCloudConversations() {
  if (!state.currentUser) return;
  try {
    const res = await apiFetch('/api/chat/conversations');
    state.chats = await res.json();
    renderChatList();
    if (state.activeChatId && !state.chats.some(c => c.id === state.activeChatId)) state.activeChatId = null;
    if (state.activeChatId) await loadCloudMessages(state.activeChatId);
    else { state.messages = []; renderMessages(); }
  } catch (err) { log(`Load cloud conversations error: ${err.message}`, 'error'); }
}

async function loadCloudMessages(chatId) {
  if (!state.currentUser) return;
  try {
    const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
    state.messages = await res.json();
    rebuildVersions();
    renderMessages(); renderChatList();
  } catch (err) { log(`Load cloud messages error: ${err.message}`, 'error'); }
}

function rebuildVersions() {
  state.messageVersions = {};
  state.messages.forEach(msg => {
    if (msg.versions && msg.versions.length > 0) {
      state.messageVersions[msg.id] = { versions: msg.versions, currentIndex: msg.currentVersionIndex || 0 };
      msg.content = msg.versions[msg.currentVersionIndex || 0] || '';
    }
  });
}

// ============ RENDER CHAT LIST ============
function renderChatList() {
  chatList.innerHTML = '';
  const pinned = state.chats.filter(c => c.pinned);
  const unpinned = state.chats.filter(c => !c.pinned);
  if (pinned.length > 0) {
    const c = document.createElement('div');
    c.className = 'pinned-section';
    const lbl = document.createElement('div');
    lbl.className = 'pinned-label';
    lbl.textContent = 'Pinned';
    c.appendChild(lbl);
    pinned.forEach(ch => appendChatItem(c, ch));
    chatList.appendChild(c);
  }
  unpinned.forEach(ch => appendChatItem(chatList, ch));
  if (state.chats.length === 0) {
    chatList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem 0;font-size:.9rem;">No chats yet</div>';
  }
  window.refreshIcons();
}

function appendChatItem(container, chat) {
  const div = document.createElement('div');
  div.className = `chat-item${chat.id === state.activeChatId ? ' active' : ''}`;
  div.dataset.id = chat.id;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = chat.title || 'New Chat';
  if (chat.pinned) {
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'pin');
    icon.style.cssText = 'width:14px;height:14px;margin-right:4px;color:var(--accent);';
    title.prepend(icon);
  }
  div.appendChild(title);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const more = document.createElement('button');
  more.innerHTML = `<i data-lucide="more-horizontal" style="width:16px;height:16px;"></i>`;
  more.title = 'More options';
  more.onclick = (e) => { e.stopPropagation(); openChatMenu(e, chat.id); };
  actions.appendChild(more);
  div.appendChild(actions);
  div.onclick = () => selectChat(chat.id);
  container.appendChild(div);
}

// ============ RENDER MESSAGES ============
function renderMessages() {
  messageList.innerHTML = '';

  if (state.isShareView) {
    if (!state.shareMessages?.length) {
      messageList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No messages in this share.</p>';
      return;
    }
    state.shareMessages.forEach(msg => {
      const row = document.createElement('div');
      row.className = `message-row ${msg.role}`;
      if (msg.role === 'assistant') {
        const h = document.createElement('div');
        h.className = 'assistant-header-row';
        h.innerHTML = '<img src="/logo.png" alt="agrideepai" class="assistant-avatar" /> <span class="assistant-name">agrideepai</span>';
        row.appendChild(h);
      }
      const div = document.createElement('div');
      div.className = `message ${msg.role}`;
      const c = document.createElement('div');
      c.className = 'message-content';
      let html = marked.parse(cleanContent(msg.content) || '');
      html = html.replace(/<hr\s*\/?>/g, '');
      c.innerHTML = html;
      div.appendChild(c);
      row.appendChild(div);
      messageList.appendChild(row);
    });
    welcomeScreen.style.display = 'none';
    messageList.style.display = 'flex';
    return;
  }

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
      const h = document.createElement('div');
      h.className = 'assistant-header-row';
      h.innerHTML = '<img src="/logo.png" alt="agrideepai" class="assistant-avatar" /> <span class="assistant-name">agrideepai</span>';
      row.appendChild(h);
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${msg.role}`;

    // EDITING MODE
    if (state.editingMessageId === msg.id && msg.role === 'user') {
      const area = document.createElement('div');
      area.style.width = '100%';

      if (msg.files?.length) {
        const atts = document.createElement('div');
        atts.className = 'attachments-above';
        msg.files.forEach(f => {
          const w = document.createElement('div');
          w.className = 'user-message-attachment';
          if (f.mime_type?.startsWith('image/') && f.public_url) {
            const img = document.createElement('img');
            img.src = f.public_url; img.alt = f.filename;
            img.onclick = () => openLightbox(f.public_url, true);
            w.appendChild(img);
          } else if (f.public_url) {
            const ic = document.createElement('div');
            ic.className = 'file-icon';
            ic.innerHTML = `<i data-lucide="file-text" style="width:24px;height:24px;"></i>`;
            ic.onclick = () => openLightbox(f.public_url, false);
            w.appendChild(ic);
          }
          atts.appendChild(w);
        });
        area.appendChild(atts);
        window.refreshIcons();
      }

      const ta = document.createElement('textarea');
      ta.value = state.editingValue;
      ta.style.cssText = 'width:100%;padding:.5rem;border-radius:10px;background:var(--background);color:var(--text);border:1px solid var(--border);resize:vertical;font-family:inherit;font-size:.95rem;';

      const g = document.createElement('div');
      g.style.cssText = 'display:flex;gap:.5rem;margin-top:.5rem;justify-content:flex-end;';

      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.style.cssText = 'padding:.5rem 1.1rem;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--text);cursor:pointer;font-weight:500;font-size:.9rem;';
      cancel.onclick = () => { state.editingMessageId = null; renderMessages(); };

      const send = document.createElement('button');
      send.textContent = 'Send';
      send.style.cssText = 'padding:.5rem 1.4rem;background:var(--accent);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer;box-shadow:0 2px 8px rgba(47,143,70,.35);';
      send.onclick = async () => {
        const newContent = ta.value.trim();
        if (!newContent) return;
        if (!state.messageVersions[msg.id]) state.messageVersions[msg.id] = { versions: [msg.content], currentIndex: 0 };
        const v = state.messageVersions[msg.id];
        if (v.versions[v.versions.length - 1] !== newContent) { v.versions.push(newContent); v.currentIndex = v.versions.length - 1; }
        else v.currentIndex = v.versions.length - 1;
        msg.content = newContent;
        const i = state.messages.indexOf(msg);
        state.messages = state.messages.slice(0, i + 1);
        state.editingMessageId = null;
        const chat = state.chats.find(c => c.id === state.activeChatId);
        if (chat) chat.messages = state.messages;
        renderMessages();
        await sendEditedUserMessage();
      };

      g.appendChild(cancel); g.appendChild(send);
      area.appendChild(ta); area.appendChild(g);
      msgDiv.appendChild(area);
      row.appendChild(msgDiv);
      messageList.appendChild(row);
      setTimeout(() => ta.focus(), 50);
      return;
    }

    // NORMAL DISPLAY
    if (msg.role === 'assistant') {
      const isLast = index === lastIndex;
      const thinking = isLast && state.isGenerating && msg.content === '';
      if (thinking) {
        const t = document.createElement('div');
        t.className = 'thinking-indicator';
        t.innerHTML = `<div class="spinner"></div><span>Thinking...</span>`;
        msgDiv.appendChild(t);
      } else if (msg.content) {
        const c = document.createElement('div');
        c.className = 'message-content';
        let html = marked.parse(cleanContent(msg.content) || '');
        html = html.replace(/<hr\s*\/?>/g, '');
        c.innerHTML = html;
        msgDiv.appendChild(c);
      }
    } else {
      if (msg.files?.length) {
        const atts = document.createElement('div');
        atts.className = 'attachments-above';
        msg.files.forEach(f => {
          const w = document.createElement('div');
          w.className = 'user-message-attachment';
          if (f.mime_type?.startsWith('image/') && f.public_url) {
            const img = document.createElement('img');
            img.src = f.public_url; img.alt = f.filename;
            img.onclick = () => openLightbox(f.public_url, true);
            w.appendChild(img);
          } else if (f.public_url) {
            const ic = document.createElement('div');
            ic.className = 'file-icon';
            ic.innerHTML = `<i data-lucide="file-text" style="width:24px;height:24px;"></i>`;
            ic.onclick = () => openLightbox(f.public_url, false);
            w.appendChild(ic);
          }
          atts.appendChild(w);
        });
        msgDiv.appendChild(atts);
        window.refreshIcons();
      }
      const c = document.createElement('div');
      c.className = 'message-content';
      c.textContent = msg.content;
      msgDiv.appendChild(c);
    }

    const showActions = (msg.role === 'user') ||
      (msg.role === 'assistant' && msg.content && !(state.isGenerating && index === lastIndex && msg.content === ''));

    if (state.editingMessageId !== msg.id && showActions) {
      const ar = document.createElement('div');
      ar.className = 'message-actions-row';

      const copy = document.createElement('button');
      copy.className = 'icon-button-sm';
      copy.innerHTML = `<i data-lucide="copy" style="width:16px;height:16px;"></i>`;
      copy.title = 'Copy';
      copy.onclick = async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(msg.content);
        copy.classList.add('copied');
        showToast('Copied!');
        if (state.copyTimeout) clearTimeout(state.copyTimeout);
        state.copyTimeout = setTimeout(() => copy.classList.remove('copied'), 1500);
      };
      ar.appendChild(copy);

      if (msg.role === 'user') {
        const edit = document.createElement('button');
        edit.className = 'icon-button-sm';
        edit.innerHTML = `<i data-lucide="pencil" style="width:16px;height:16px;"></i>`;
        edit.title = 'Edit';
        edit.onclick = (e) => { e.stopPropagation(); startEditing(msg); };
        ar.appendChild(edit);

        if (state.messageVersions[msg.id]?.versions.length > 1) {
          const v = state.messageVersions[msg.id];
          const vc = document.createElement('div');
          vc.className = 'version-controls';
          const prev = document.createElement('button');
          prev.innerHTML = `<i data-lucide="chevron-left" style="width:16px;height:16px;"></i>`;
          prev.disabled = v.currentIndex === 0;
          prev.onclick = () => { if (v.currentIndex > 0) { v.currentIndex--; msg.content = v.versions[v.currentIndex]; renderMessages(); } };
          vc.appendChild(prev);
          const lbl = document.createElement('span');
          lbl.textContent = `${v.currentIndex + 1} / ${v.versions.length}`;
          vc.appendChild(lbl);
          const next = document.createElement('button');
          next.innerHTML = `<i data-lucide="chevron-right" style="width:16px;height:16px;"></i>`;
          next.disabled = v.currentIndex === v.versions.length - 1;
          next.onclick = () => { if (v.currentIndex < v.versions.length - 1) { v.currentIndex++; msg.content = v.versions[v.currentIndex]; renderMessages(); } };
          vc.appendChild(next);
          ar.appendChild(vc);
        }
      }

      if (msg.role === 'assistant') {
        const like = document.createElement('button');
        like.className = 'icon-button-sm';
        if (state.likedMessages.has(msg.id)) like.classList.add('liked');
        like.innerHTML = `<i data-lucide="thumbs-up" style="width:16px;height:16px;"></i>`;
        like.title = 'Like';
        like.onclick = (e) => { e.stopPropagation(); toggleLike(msg); };
        ar.appendChild(like);

        const dislike = document.createElement('button');
        dislike.className = 'icon-button-sm';
        if (state.dislikedMessages.has(msg.id)) dislike.classList.add('disliked');
        dislike.innerHTML = `<i data-lucide="thumbs-down" style="width:16px;height:16px;"></i>`;
        dislike.title = 'Dislike';
        dislike.onclick = (e) => { e.stopPropagation(); toggleDislike(msg); };
        ar.appendChild(dislike);

        const regen = document.createElement('button');
        regen.className = 'icon-button-sm';
        regen.innerHTML = `<i data-lucide="rotate-ccw" style="width:16px;height:16px;"></i>`;
        regen.title = 'Regenerate';
        regen.onclick = (e) => { e.stopPropagation(); regenerateMessage(index); };
        ar.appendChild(regen);

        const share = document.createElement('button');
        share.className = 'icon-button-sm';
        share.innerHTML = `<i data-lucide="share-2" style="width:16px;height:16px;"></i>`;
        share.title = 'Share this message';
        share.onclick = (e) => { e.stopPropagation(); shareConversation([{ role: msg.role, content: msg.content }]); };
        ar.appendChild(share);
      }

      row.appendChild(msgDiv);
      row.appendChild(ar);
      messageList.appendChild(row);
    } else {
      row.appendChild(msgDiv);
      messageList.appendChild(row);
    }
  });

  window.refreshIcons();
  const container = document.getElementById('chatContainer');
  if (container && (state.shouldScrollToBottom || isNearBottom(container))) {
    container.scrollTop = container.scrollHeight;
    state.shouldScrollToBottom = false;
  }
}

function isNearBottom(container, threshold = 150) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// ============ TOAST ============
function showToast(message, isError = false) {
  document.querySelector('.agrideep-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'agrideep-toast';
  toast.textContent = message;
  const bg = isError ? '#e85d5d' : '#2f8f46';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '80px', left: '50%',
    background: bg, color: '#fff', padding: '.5rem 1.2rem', borderRadius: '10px',
    fontSize: '.9rem', fontWeight: '500', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    zIndex: '9999', opacity: '0', transition: 'opacity .3s, transform .3s',
    transform: 'translateX(-50%) translateY(10px)', maxWidth: '90vw',
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ============ LIKE / DISLIKE ============
function toggleLike(msg) {
  if (state.likedMessages.has(msg.id)) state.likedMessages.delete(msg.id);
  else { state.likedMessages.add(msg.id); state.dislikedMessages.delete(msg.id); }
  renderMessages();
}
function toggleDislike(msg) {
  if (state.dislikedMessages.has(msg.id)) state.dislikedMessages.delete(msg.id);
  else { state.dislikedMessages.add(msg.id); state.likedMessages.delete(msg.id); }
  renderMessages();
}

function startEditing(msg) {
  if (msg.role !== 'user') return;
  state.editingMessageId = msg.id;
  state.editingValue = msg.content;
  renderMessages();
}

// ============ SEND AFTER EDIT ============
async function sendEditedUserMessage() {
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;
  const assist = { id: 'assist_' + Date.now().toString(36), role: 'assistant', content: '', files: [], created_at: new Date().toISOString() };
  state.messages.push(assist);
  chat.messages = state.messages;
  state.isGenerating = true; state.shouldScrollToBottom = true;
  renderMessages(); updateSendButton();
  state.abortController = new AbortController();
  try {
    const payload = { messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })) };
    const response = await fetch('/api/chat/guest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: state.abortController.signal,
    });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'AI failed'); }
    await consumeStream(response, chat);
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
  } finally {
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    state.abortController = null;
    updateSendButton();
  }
}

// ============ REGENERATE ============
async function regenerateMessage(index) {
  const msg = state.messages[index];
  if (!msg || msg.role !== 'assistant') return;
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;
  const ctx = state.messages.slice(0, index);
  if (!ctx.length || ctx[ctx.length - 1].role !== 'user') { showToast('Cannot regenerate', true); return; }
  if (!state.messageVersions[msg.id]) state.messageVersions[msg.id] = { versions: [], currentIndex: 0 };
  const v = state.messageVersions[msg.id];
  v.versions.push(''); v.currentIndex = v.versions.length - 1; msg.content = '';
  state.isGenerating = true; state.shouldScrollToBottom = true;
  renderMessages(); updateSendButton();
  state.abortController = new AbortController();
  try {
    const payload = { messages: ctx.map(m => ({ role: m.role, content: m.content })) };
    const response = await fetch('/api/chat/guest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: state.abortController.signal,
    });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'AI failed'); }
    await consumeStream(response, chat, v);
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Regenerate failed: ' + err.message, true);
      if (v.versions.length && v.versions[v.versions.length - 1] === '') { v.versions.pop(); msg.content = v.versions[v.currentIndex] || ''; renderMessages(); }
    }
  } finally {
    state.isGenerating = false;
    sendBtn.classList.remove('generating');
    sendBtn.disabled = false;
    state.abortController = null;
    updateSendButton();
  }
}

// ============ STREAM CONSUMER ============
async function consumeStream(response, chat, versionData = null) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {
          full += parsed.text;
          const last = state.messages[state.messages.length - 1];
          if (last && last.role === 'assistant') { last.content = full; chat.messages = state.messages; renderMessages(); }
          if (versionData) { versionData.versions[versionData.versions.length - 1] = full; }
        }
      } catch (e) {}
    }
  }
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant') {
    if (!state.messageVersions[last.id]) state.messageVersions[last.id] = { versions: [], currentIndex: 0 };
    const v = state.messageVersions[last.id];
    if (v.versions.length === 0 || v.versions[v.versions.length - 1] !== last.content) { v.versions.push(last.content); v.currentIndex = v.versions.length - 1; }
    renderMessages();
  }
  if (state.currentUser) { await loadCloudMessages(chat.id); await loadCloudConversations(); }
  else renderChatList();
}

// ============ SHARE ============
async function shareConversation(messagesToShare = null) {
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat && !messagesToShare) { showToast('No chat to share', true); return; }
  let messages = messagesToShare || state.messages.map(m => ({ role: m.role, content: m.content }));
  if (!messages.length) { showToast('Nothing to share', true); return; }
  try {
    let response;
    if (state.currentUser && !messagesToShare) {
      response = await apiFetch(`/api/chat/share/${chat.id}`, { method: 'POST' });
    } else {
      response = await fetch('/api/share/guest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
    }
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
    const data = await response.json();
    shareLinkDisplay.textContent = data.url;
    shareModal.classList.remove('hidden');
    copyShareLink.onclick = () => navigator.clipboard.writeText(data.url).then(() => showToast('Link copied!'));
  } catch (err) { showToast('Failed to generate share link: ' + err.message, true); }
}

// ============ CHAT CRUD ============
function createLocalChat(title = 'New Chat') {
  const chat = { id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5), title, messages: [], pinned: false, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  state.chats.unshift(chat);
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
    } catch (err) { showToast('Failed to create chat: ' + err.message, true); return null; }
  }
  return createLocalChat(title);
}
async function selectChat(id) {
  state.activeChatId = id;
  if (state.currentUser && !id.startsWith('local_')) {
    await loadCloudMessages(id);
    renderChatList();
  } else {
    const chat = state.chats.find(c => c.id === id);
    if (chat) { state.messages = chat.messages || []; rebuildVersions(); renderMessages(); renderChatList(); }
  }
  if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
  chatMenu.classList.add('hidden');
}
async function deleteChat(id) {
  const ok = await showCustomModal('Delete Chat', 'Are you sure? This cannot be undone.', 'Delete', 'Cancel', true);
  if (!ok) return;
  if (state.currentUser && !id.startsWith('local_')) {
    try { await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' }); } catch (err) { showToast('Failed: ' + err.message, true); return; }
  }
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.activeChatId === id) { state.activeChatId = null; state.messages = []; renderMessages(); }
  renderChatList(); chatMenu.classList.add('hidden');
}
async function renameChat(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  const t = await showCustomPrompt('Rename Chat', chat.title);
  if (!t) return;
  if (state.currentUser && !id.startsWith('local_')) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title: t }) });
      const u = await res.json();
      const i = state.chats.findIndex(c => c.id === id);
      if (i !== -1) state.chats[i] = u;
      renderChatList();
    } catch (err) { showToast('Failed: ' + err.message, true); }
  } else { chat.title = t; renderChatList(); }
  chatMenu.classList.add('hidden');
}
async function togglePin(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  if (state.currentUser && !id.startsWith('local_')) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ pinned: !chat.pinned }) });
      const u = await res.json();
      const i = state.chats.findIndex(c => c.id === id);
      if (i !== -1) state.chats[i] = u;
      renderChatList();
    } catch (err) { showToast('Failed: ' + err.message, true); }
  } else { chat.pinned = !chat.pinned; renderChatList(); }
  chatMenu.classList.add('hidden');
}
function openChatMenu(e, chatId) {
  e.preventDefault();
  state.contextMenuTarget = chatId;
  const rect = e.target.getBoundingClientRect();
  const w = 180;
  let left = Math.min(rect.left, window.innerWidth - w - 10);
  let top = rect.bottom + 5;
  if (top + 200 > window.innerHeight) top = rect.top - 200;
  chatMenu.style.left = left + 'px';
  chatMenu.style.top = top + 'px';
  chatMenu.classList.remove('hidden');
  chatMenu.querySelectorAll('button').forEach(btn => {
    btn.onclick = null;
    const a = btn.dataset.action;
    if (a === 'pin') {
      const c = state.chats.find(x => x.id === chatId);
      btn.textContent = c?.pinned ? 'Unpin' : 'Pin';
      btn.innerHTML = `<i data-lucide="${c?.pinned ? 'pin-off' : 'pin'}"></i> ${c?.pinned ? 'Unpin' : 'Pin'}`;
      btn.onclick = () => { chatMenu.classList.add('hidden'); togglePin(chatId); };
    } else if (a === 'share') { btn.onclick = () => { chatMenu.classList.add('hidden'); shareConversation(); }; }
    else if (a === 'rename') { btn.onclick = () => { chatMenu.classList.add('hidden'); renameChat(chatId); }; }
    else if (a === 'delete') { btn.onclick = () => { chatMenu.classList.add('hidden'); deleteChat(chatId); }; }
  });
  window.refreshIcons();
}
document.addEventListener('click', (e) => {
  if (!chatMenu.contains(e.target) && !e.target.closest('.chat-item .actions')) chatMenu.classList.add('hidden');
});

function handleNewChat() {
  const empty = state.chats.find(c => c.messages.length === 0);
  if (empty) { selectChat(empty.id); return; }
  createChat('New Chat').then(chat => {
    if (chat) {
      state.activeChatId = chat.id; state.messages = []; state.editingMessageId = null; state.messageVersions = {};
      renderMessages(); renderChatList(); messageInput.focus();
      if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
    }
  });
}

// ============ COMPOSER ============
function resizeComposer() {
  messageInput.style.height = '0px';
  const sh = messageInput.scrollHeight;
  messageInput.style.height = Math.min(sh, 120) + 'px';
  messageInput.style.overflowY = sh > 120 ? 'auto' : 'hidden';
}
function updateSendButton() {
  const has = messageInput.value.trim().length > 0 || state.attachments.length > 0;
  const si = sendBtn.querySelector('.send-icon');
  const sti = sendBtn.querySelector('.stop-icon');
  if (!state.isGenerating) {
    if (si) si.style.display = 'inline';
    if (sti) sti.style.display = 'none';
    sendBtn.disabled = !has;
    sendBtn.style.opacity = has ? '1' : '0.3';
    sendBtn.classList.remove('generating');
  } else {
    if (si) si.style.display = 'none';
    if (sti) sti.style.display = 'inline';
    sendBtn.disabled = false;
    sendBtn.style.opacity = '1';
    sendBtn.classList.add('generating');
  }
}

function renderAttachments() {
  attachmentPreview.innerHTML = '';
  state.attachments.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (file.type?.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.onclick = () => openLightbox(img.src, true);
      chip.appendChild(img);
    } else {
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', 'file-text');
      chip.appendChild(ic);
    }
    const rm = document.createElement('button');
    rm.innerHTML = `<i data-lucide="x" style="width:14px;height:14px;"></i>`;
    rm.onclick = (e) => { e.stopPropagation(); state.attachments.splice(idx, 1); renderAttachments(); updateSendButton(); };
    chip.appendChild(rm);
    attachmentPreview.appendChild(chip);
  });
  window.refreshIcons();
}

// ============ SEND MESSAGE ============
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !state.attachments.length) return;
  if (state.isGenerating) return;

  let chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    const title = (text || 'New Chat').substring(0, 42);
    if (state.currentUser) {
      const cloud = await createChat(title);
      if (!cloud) return;
      chat = cloud;
      state.activeChatId = chat.id;
    } else {
      chat = createLocalChat(title);
      state.activeChatId = chat.id;
    }
  }

  const localFiles = state.attachments.map(f => ({ filename: f.name, mime_type: f.type, size: f.size, public_url: URL.createObjectURL(f) }));
  const userMsg = { id: 'user_' + Date.now().toString(36), role: 'user', content: text || '[File attached]', files: localFiles, created_at: new Date().toISOString() };
  state.messages.push(userMsg);
  chat.messages = state.messages;
  renderMessages();

  messageInput.value = '';
  const atts = [...state.attachments];
  state.attachments = [];
  renderAttachments(); resizeComposer(); updateSendButton();
  messageInput.disabled = true;

  const assist = { id: 'assist_' + Date.now().toString(36), role: 'assistant', content: '', files: [], created_at: new Date().toISOString() };
  state.messages.push(assist);
  chat.messages = state.messages;

  state.isGenerating = true; state.shouldScrollToBottom = true;
  renderMessages(); updateSendButton();
  state.abortController = new AbortController();

  try {
    let response;
    if (state.currentUser && !chat.id.startsWith('local_')) {
      const fd = new FormData();
      fd.append('message', text || '');
      atts.forEach(f => fd.append('file', f));
      const session = (await state.supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        // Refresh
        const { data } = await state.supabase.auth.refreshSession();
        if (!data.session?.access_token) throw new Error('Session expired. Please sign in again.');
      }
      const finalToken = (await state.supabase.auth.getSession()).data.session?.access_token;
      response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${finalToken}` },
        body: fd, signal: state.abortController.signal,
      });
    } else {
      const payload = { messages: state.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })) };
      if (atts.length > 0) {
        const first = atts[0];
        if (first.type?.startsWith('image/') && first.size < 4 * 1024 * 1024) {
          const b64 = await new Promise(resolve => {
            const r = new FileReader();
            r.onload = () => resolve(r.result.split(',')[1]);
            r.readAsDataURL(first);
          });
          payload.image = { base64: b64, mimeType: first.type, filename: first.name };
        }
      }
      response = await fetch('/api/chat/guest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: state.abortController.signal,
      });
    }
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'AI failed'); }
    await consumeStream(response, chat);
  } catch (err
