// ============================================================
// AGRIDEEPAI — Full Frontend
// ============================================================

const log = (msg, type = 'info') => console.log(`[FRONTEND] [${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}`);

const IS_SHARE_VIEW = document.documentElement.classList.contains('is-share-view');

function applyShareViewHiding() {
  document.body.classList.add('share-view');
  ['sidebar','topBar','composerArea','welcomeScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const fn = document.querySelector('.footer-note');
  if (fn) fn.style.display = 'none';
  const wl = document.querySelector('.welcome-logo');
  if (wl) wl.style.display = 'none';
  const sc = document.querySelector('.suggestion-chips');
  if (sc) sc.style.display = 'none';
}

if (IS_SHARE_VIEW) {
  if (document.body) applyShareViewHiding();
  else document.addEventListener('DOMContentLoaded', applyShareViewHiding, { once: true });
}

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
const CODE_RESEND_SECONDS = 60;

let state = {
  activeChatId: null, chats: [], messages: [],
  isGenerating: false, abortController: null,
  supabase: null, currentUser: null,
  attachments: [], editingMessageId: null, editingValue: '',
  messageVersions: {}, likedMessages: new Set(), dislikedMessages: new Set(),
  contextMenuTarget: null, isShareView: IS_SHARE_VIEW, shareMessages: [], copyTimeout: null,
  pendingAuth: null,
};

// ============ COUNTDOWN TIMER ============
function attachCountdown(btn, seconds = CODE_RESEND_SECONDS) {
  if (!btn) return;
  if (btn._cdInterval) { clearInterval(btn._cdInterval); btn._cdInterval = null; }
  if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent.trim() || 'Resend code';
  let remaining = seconds;
  btn.disabled = true;
  btn.textContent = `Resend in ${remaining}s`;
  btn._cdInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(btn._cdInterval);
      btn._cdInterval = null;
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText;
    } else {
      btn.textContent = `Resend in ${remaining}s`;
    }
  }, 1000);
}

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
    modal.innerHTML = `<div class="modal-content"><button class="modal-close" id="customModalClose">&times;</button><h2>${title}</h2><p style="margin:1rem 0;color:var(--text-muted);">${message}</p><div style="display:flex;gap:.5rem;margin-top:1rem;"><button class="btn-primary ${isDanger ? 'btn-danger' : ''}" id="customModalConfirm" style="flex:1;">${confirmText}</button><button class="btn-primary" id="customModalCancel" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);">${cancelText}</button></div></div>`;
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
    modal.innerHTML = `<div class="modal-content"><button class="modal-close" id="customPromptClose">&times;</button><h2>${title}</h2><input type="text" id="customPromptInput" value="${defaultValue}" style="width:100%;margin-top:.5rem;" /><div style="display:flex;gap:.5rem;margin-top:1rem;"><button class="btn-primary" id="customPromptConfirm" style="flex:1;">Save</button><button class="btn-primary" id="customPromptCancel" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);">Cancel</button></div></div>`;
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

// ============ SUPABASE ============
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
        storageKey: 'agrideepai-auth-v2',
        flowType: 'pkce',
      },
    });
    state.supabase.auth.onAuthStateChange(async (event, session) => {
      log(`Auth: ${event}`, 'debug');
      if (event === 'TOKEN_REFRESHED' && session) { state.currentUser = session.user; return; }
      if (event === 'SIGNED_OUT') {
        state.currentUser = null; state.chats = []; state.messages = []; state.activeChatId = null;
        updateAuthUI(); renderChatList(); renderMessages(); return;
      }
      if (session?.user) {
        state.currentUser = session.user; updateAuthUI(); await loadCloudConversations();
      } else {
        state.currentUser = null; state.chats = []; state.messages = []; state.activeChatId = null;
        updateAuthUI(); renderChatList(); renderMessages();
      }
    });
    const { data: { session } } = await state.supabase.auth.getSession();
    if (session?.user) {
      state.currentUser = session.user; updateAuthUI(); await loadCloudConversations();
    } else {
      const { data: refreshed } = await state.supabase.auth.refreshSession();
      if (refreshed.session?.user) {
        state.currentUser = refreshed.session.user; updateAuthUI(); await loadCloudConversations();
      } else {
        updateAuthUI(); renderChatList(); renderMessages();
      }
    }
  } catch (err) {
    log(`Supabase init error: ${err.message}`, 'error');
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

async function apiFetch(endpoint, options = {}) {
  if (!state.supabase) throw new Error('Not initialized');
  let session = (await state.supabase.auth.getSession()).data.session;
  if (!session) { try { const { data } = await state.supabase.auth.refreshSession(); session = data.session; } catch (e) {} }
  if (!session?.access_token) throw new Error('Not authenticated');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers };
  let res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    const { data } = await state.supabase.auth.refreshSession();
    if (data.session?.access_token) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${data.session.access_token}` };
      res = await fetch(endpoint, { ...options, headers: retryHeaders });
    }
  }
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Request failed (${res.status})`); }
  return res;
}

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
    rebuildVersions(); renderMessages(); renderChatList();
  } catch (err) { log(`Load cloud messages error: ${err.message}`, 'error'); }
}

// Reload with retry — waits until the assistant reply appears in the DB
async function reloadAfterSend(chatId, expectedMinCount, maxAttempts = 6) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
      const msgs = await res.json();
      if (Array.isArray(msgs) && msgs.length >= expectedMinCount) {
        state.messages = msgs;
        rebuildVersions(); renderMessages();
        const convRes = await apiFetch('/api/chat/conversations');
        state.chats = await convRes.json();
        renderChatList();
        return true;
      }
    } catch (e) { /* retry */ }
  }
  // Fallback: force reload anyway
  await loadCloudMessages(chatId);
  await loadCloudConversations();
  return false;
}

function rebuildVersions() {
  state.messageVersions = {};
  state.messages.forEach(msg => {
    if (msg.versions && msg.versions.length > 0) {
      const idx = msg.current_version_index ?? msg.currentVersionIndex ?? 0;
      state.messageVersions[msg.id] = { versions: msg.versions, currentIndex: idx };
      msg.content = msg.versions[idx] || '';
    }
  });
}

function renderChatList() {
  chatList.innerHTML = '';
  const pinned = state.chats.filter(c => c.pinned);
  const unpinned = state.chats.filter(c => !c.pinned);
  if (pinned.length > 0) {
    const c = document.createElement('div'); c.className = 'pinned-section';
    const lbl = document.createElement('div'); lbl.className = 'pinned-label'; lbl.textContent = 'Pinned';
    c.appendChild(lbl); pinned.forEach(ch => appendChatItem(c, ch)); chatList.appendChild(c);
  }
  unpinned.forEach(ch => appendChatItem(chatList, ch));
  if (state.chats.length === 0) chatList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem 0;font-size:.9rem;">No chats yet</div>';
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
  const actions = document.createElement('div'); actions.className = 'actions';
  const more = document.createElement('button');
  more.innerHTML = `<i data-lucide="more-horizontal" style="width:16px;height:16px;"></i>`;
  more.title = 'More options';
  more.onclick = (e) => { e.stopPropagation(); openChatMenu(e, chat.id); };
  actions.appendChild(more); div.appendChild(actions);
  div.onclick = () => selectChat(chat.id);
  container.appendChild(div);
}

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
        const h = document.createElement('div'); h.className = 'assistant-header-row';
        h.innerHTML = '<img src="/logo.png" alt="agrideepai" class="assistant-avatar" /> <span class="assistant-name">agrideepai</span>';
        row.appendChild(h);
      }
      const div = document.createElement('div'); div.className = `message ${msg.role}`;
      const c = document.createElement('div'); c.className = 'message-content';
      let html = marked.parse(cleanContent(msg.content) || ''); html = html.replace(/<hr\s*\/?>/g, '');
      c.innerHTML = html; div.appendChild(c); row.appendChild(div); messageList.appendChild(row);
    });
    welcomeScreen.style.display = 'none';
    messageList.style.display = 'flex';
    return;
  }

  if (!state.messages.length) {
    welcomeScreen.style.display = 'flex'; messageList.style.display = 'none'; return;
  }
  welcomeScreen.style.display = 'none'; messageList.style.display = 'flex';
  const lastIndex = state.messages.length - 1;

  state.messages.forEach((msg, index) => {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;
    if (msg.role === 'assistant') {
      const h = document.createElement('div'); h.className = 'assistant-header-row';
      h.innerHTML = '<img src="/logo.png" alt="agrideepai" class="assistant-avatar" /> <span class="assistant-name">agrideepai</span>';
      row.appendChild(h);
    }
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${msg.role}`;

    if (state.editingMessageId === msg.id && msg.role === 'user') {
      const area = document.createElement('div'); area.style.width = '100%';
      if (msg.files?.length) {
        const atts = document.createElement('div'); atts.className = 'attachments-above';
        msg.files.forEach(f => {
          const w = document.createElement('div'); w.className = 'user-message-attachment';
          if (f.mime_type?.startsWith('image/') && f.public_url) {
            const img = document.createElement('img'); img.src = f.public_url; img.alt = f.filename;
            img.onclick = () => openLightbox(f.public_url, true); w.appendChild(img);
          } else if (f.public_url) {
            const ic = document.createElement('div'); ic.className = 'file-icon';
            ic.innerHTML = `<i data-lucide="file-text" style="width:24px;height:24px;"></i>`;
            ic.onclick = () => openLightbox(f.public_url, false); w.appendChild(ic);
          }
          atts.appendChild(w);
        });
        area.appendChild(atts); window.refreshIcons();
      }
      const ta = document.createElement('textarea');
      ta.value = state.editingValue;
      ta.style.cssText = 'width:100%;padding:.6rem .8rem;border-radius:10px;background:var(--background);color:var(--text);border:1px solid var(--border);resize:vertical;font-family:inherit;font-size:16px;line-height:1.5;min-height:80px;max-height:none;overflow-y:auto;box-sizing:border-box;';
      const autoGrow = () => {
        ta.style.height = 'auto';
        const maxH = Math.min(window.innerHeight * 0.6, 600);
        const want = Math.min(ta.scrollHeight + 2, maxH);
        ta.style.height = Math.max(want, 80) + 'px';
        ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
      };
      ta.addEventListener('input', autoGrow);
      const g = document.createElement('div'); g.style.cssText = 'display:flex;gap:.5rem;margin-top:.5rem;justify-content:flex-end;';
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
      cancel.style.cssText = 'padding:.5rem 1.1rem;background:transparent;border:1px solid var(--border);border-radius:10px;color:var(--text);cursor:pointer;font-weight:500;font-size:.9rem;';
      cancel.onclick = () => { state.editingMessageId = null; renderMessages(); };
      const send = document.createElement('button'); send.textContent = 'Send';
      send.style.cssText = 'padding:.5rem 1.4rem;background:var(--accent);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer;box-shadow:0 2px 8px rgba(47,143,70,.35);';
      send.onclick = async () => {
        const newContent = ta.value.trim(); if (!newContent) return;
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
        renderMessages(); await sendEditedUserMessage();
      };
      g.appendChild(cancel); g.appendChild(send);
      area.appendChild(ta); area.appendChild(g); msgDiv.appendChild(area);
      row.appendChild(msgDiv); messageList.appendChild(row);
      setTimeout(() => { ta.focus(); autoGrow(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50); return;
    }

    if (msg.role === 'assistant') {
      const isLast = index === lastIndex;
      const thinking = isLast && state.isGenerating && msg.content === '';
      if (thinking) {
        const t = document.createElement('div'); t.className = 'thinking-indicator';
        t.innerHTML = `<div class="spinner"></div><span>Thinking...</span>`;
        msgDiv.appendChild(t);
      } else if (msg.content) {
        const c = document.createElement('div'); c.className = 'message-content';
        let html = marked.parse(cleanContent(msg.content) || ''); html = html.replace(/<hr\s*\/?>/g, '');
        c.innerHTML = html; msgDiv.appendChild(c);
      }
    } else {
      if (msg.files?.length) {
        const atts = document.createElement('div'); atts.className = 'attachments-above';
        msg.files.forEach(f => {
          const w = document.createElement('div'); w.className = 'user-message-attachment';
          if (f.mime_type?.startsWith('image/') && f.public_url) {
            const img = document.createElement('img'); img.src = f.public_url; img.alt = f.filename;
            img.onclick = () => openLightbox(f.public_url, true); w.appendChild(img);
          } else if (f.public_url) {
            const ic = document.createElement('div'); ic.className = 'file-icon';
            ic.innerHTML = `<i data-lucide="file-text" style="width:24px;height:24px;"></i>`;
            ic.onclick = () => openLightbox(f.public_url, false); w.appendChild(ic);
          }
          atts.appendChild(w);
        });
        msgDiv.appendChild(atts); window.refreshIcons();
      }
      const c = document.createElement('div'); c.className = 'message-content'; c.textContent = msg.content;
      msgDiv.appendChild(c);
    }

    const showActions = (msg.role === 'user') || (msg.role === 'assistant' && msg.content && !(state.isGenerating && index === lastIndex && msg.content === ''));

    if (state.editingMessageId !== msg.id && showActions) {
      const ar = document.createElement('div'); ar.className = 'message-actions-row';

      const copy = document.createElement('button'); copy.className = 'icon-button-sm';
      copy.innerHTML = `<i data-lucide="copy" style="width:16px;height:16px;"></i>`; copy.title = 'Copy';
      copy.onclick = async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(msg.content);
        copy.classList.add('copied'); showToast('Copied!');
        if (state.copyTimeout) clearTimeout(state.copyTimeout);
        state.copyTimeout = setTimeout(() => copy.classList.remove('copied'), 1500);
      };
      ar.appendChild(copy);

      if (msg.role === 'user') {
        const edit = document.createElement('button'); edit.className = 'icon-button-sm';
        edit.innerHTML = `<i data-lucide="pencil" style="width:16px;height:16px;"></i>`; edit.title = 'Edit';
        edit.onclick = (e) => { e.stopPropagation(); startEditing(msg); };
        ar.appendChild(edit);
        if (state.messageVersions[msg.id]?.versions.length > 1) {
          const v = state.messageVersions[msg.id];
          const vc = document.createElement('div'); vc.className = 'version-controls';
          const prev = document.createElement('button');
          prev.innerHTML = `<i data-lucide="chevron-left" style="width:16px;height:16px;"></i>`;
          prev.disabled = v.currentIndex === 0;
          prev.onclick = () => { if (v.currentIndex > 0) { v.currentIndex--; msg.content = v.versions[v.currentIndex]; renderMessages(); } };
          vc.appendChild(prev);
          const lbl = document.createElement('span'); lbl.textContent = `${v.currentIndex + 1} / ${v.versions.length}`; vc.appendChild(lbl);
          const next = document.createElement('button');
          next.innerHTML = `<i data-lucide="chevron-right" style="width:16px;height:16px;"></i>`;
          next.disabled = v.currentIndex === v.versions.length - 1;
          next.onclick = () => { if (v.currentIndex < v.versions.length - 1) { v.currentIndex++; msg.content = v.versions[v.currentIndex]; renderMessages(); } };
          vc.appendChild(next); ar.appendChild(vc);
        }
      }

      if (msg.role === 'assistant') {
        const like = document.createElement('button'); like.className = 'icon-button-sm';
        if (state.likedMessages.has(msg.id)) like.classList.add('liked');
        like.innerHTML = `<i data-lucide="thumbs-up" style="width:16px;height:16px;"></i>`; like.title = 'Like';
        like.onclick = (e) => { e.stopPropagation(); toggleLike(msg); };
        ar.appendChild(like);

        const dislike = document.createElement('button'); dislike.className = 'icon-button-sm';
        if (state.dislikedMessages.has(msg.id)) dislike.classList.add('disliked');
        dislike.innerHTML = `<i data-lucide="thumbs-down" style="width:16px;height:16px;"></i>`; dislike.title = 'Dislike';
        dislike.onclick = (e) => { e.stopPropagation(); toggleDislike(msg); };
        ar.appendChild(dislike);

        const regen = document.createElement('button'); regen.className = 'icon-button-sm';
        regen.innerHTML = `<i data-lucide="rotate-ccw" style="width:16px;height:16px;"></i>`; regen.title = 'Regenerate';
        regen.onclick = (e) => { e.stopPropagation(); regenerateMessage(index); };
        ar.appendChild(regen);

        const share = document.createElement('button'); share.className = 'icon-button-sm';
        share.innerHTML = `<i data-lucide="share-2" style="width:16px;height:16px;"></i>`; share.title = 'Share this message';
        share.onclick = (e) => { e.stopPropagation(); shareConversation([{ role: msg.role, content: msg.content }]); };
        ar.appendChild(share);
      }

      row.appendChild(msgDiv); row.appendChild(ar); messageList.appendChild(row);
    } else {
      row.appendChild(msgDiv); messageList.appendChild(row);
    }
  });

  window.refreshIcons();
  const container = document.getElementById('chatContainer');
  if (container && (state.shouldScrollToBottom || isNearBottom(container))) {
    container.scrollTop = container.scrollHeight; state.shouldScrollToBottom = false;
  }
}

function isNearBottom(container, threshold = 150) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

function showToast(message, isError = false) {
  document.querySelector('.agrideep-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'agrideep-toast'; toast.textContent = message;
  const bg = isError ? '#e85d5d' : '#2f8f46';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '80px', left: '50%',
    background: bg, color: '#fff', padding: '.5rem 1.2rem', borderRadius: '10px',
    fontSize: '.9rem', fontWeight: '500', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    zIndex: '9999', opacity: '0', transition: 'opacity .3s, transform .3s',
    transform: 'translateX(-50%) translateY(10px)', maxWidth: '90vw', textAlign: 'center',
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

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
  state.editingMessageId = msg.id; state.editingValue = msg.content; renderMessages();
}

function buildGuestPayload(messages) {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .filter(m => m.content && String(m.content).trim().length > 0)
    .map(m => ({ role: m.role, content: m.content }));
}

async function sendEditedUserMessage() {
  const chat = state.chats.find(c => c.id === state.activeChatId); if (!chat) return;
  const assist = { id: 'assist_' + Date.now().toString(36), role: 'assistant', content: '', files: [], created_at: new Date().toISOString() };
  state.messages.push(assist); chat.messages = state.messages;
  state.isGenerating = true; state.shouldScrollToBottom = true;
  renderMessages(); updateSendButton();
  state.abortController = new AbortController();
  try {
    const cleanMessages = state.messages.filter(m => m.id !== assist.id);
    const payload = { messages: buildGuestPayload(cleanMessages) };
    const response = await fetch('/api/chat/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: state.abortController.signal });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'AI failed'); }
    await consumeStream(response, chat, null, { skipCloudReload: true });
  } catch (err) { if (err.name !== 'AbortError') showToast('Error: ' + err.message, true); }
  finally {
    state.isGenerating = false; sendBtn.classList.remove('generating'); sendBtn.disabled = false;
    state.abortController = null; updateSendButton();
  }
}

async function regenerateMessage(index) {
  const msg = state.messages[index]; if (!msg || msg.role !== 'assistant') return;
  const chat = state.chats.find(c => c.id === state.activeChatId); if (!chat) return;
  const ctx = state.messages.slice(0, index);
  if (!ctx.length || ctx[ctx.length - 1].role !== 'user') { showToast('Cannot regenerate', true); return; }
  if (!state.messageVersions[msg.id]) state.messageVersions[msg.id] = { versions: [], currentIndex: 0 };
  const v = state.messageVersions[msg.id];
  v.versions.push(''); v.currentIndex = v.versions.length - 1; msg.content = '';
  state.isGenerating = true; state.shouldScrollToBottom = true;
  renderMessages(); updateSendButton();
  state.abortController = new AbortController();
  try {
    const payload = { messages: buildGuestPayload(ctx) };
    const response = await fetch('/api/chat/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: state.abortController.signal });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'AI failed'); }
    await consumeStream(response, chat, v, { skipCloudReload: true });
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Regenerate failed: ' + err.message, true);
      if (v.versions.length && v.versions[v.versions.length - 1] === '') { v.versions.pop(); msg.content = v.versions[v.currentIndex] || ''; renderMessages(); }
    }
  } finally {
    state.isGenerating = false; sendBtn.classList.remove('generating'); sendBtn.disabled = false;
    state.abortController = null; updateSendButton();
  }
}

async function consumeStream(response, chat, versionData = null, opts = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = ''; let buffer = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6); if (data === '[DONE]') continue;
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
  if (last && last.role === 'assistant' && last.content) {
    if (!state.messageVersions[last.id]) state.messageVersions[last.id] = { versions: [], currentIndex: 0 };
    const v = state.messageVersions[last.id];
    if (v.versions.length === 0 || v.versions[v.versions.length - 1] !== last.content) { v.versions.push(last.content); v.currentIndex = v.versions.length - 1; }
    renderMessages();
  }
  // For authenticated sends: poll until DB reflects both messages, then reload
  if (state.currentUser && !opts.skipCloudReload && !chat.id.startsWith('local_')) {
    await reloadAfterSend(chat.id, state.messages.length);
  } else if (!opts.skipCloudReload) {
    renderChatList();
  }
}

async function shareConversation(messagesToShare = null) {
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat && !messagesToShare) { showToast('No chat to share', true); return; }
  let messages = messagesToShare || state.messages.map(m => ({ role: m.role, content: m.content }));
  messages = messages.filter(m => m.content && String(m.content).trim());
  if (!messages.length) { showToast('Nothing to share', true); return; }
  try {
    let response;
    if (state.currentUser && !messagesToShare && chat) {
      response = await apiFetch(`/api/chat/share/${chat.id}`, { method: 'POST' });
    } else {
      response = await fetch('/api/share/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
    }
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
    const data = await response.json();
    shareLinkDisplay.textContent = data.url;
    shareModal.classList.remove('hidden');
    copyShareLink.onclick = () => navigator.clipboard.writeText(data.url).then(() => showToast('Link copied!'));
  } catch (err) { showToast('Failed to generate share link: ' + err.message, true); }
}

function createLocalChat(title = 'New Chat') {
  const chat = { id: 'local_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5), title, messages: [], pinned: false, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  state.chats.unshift(chat); renderChatList(); return chat;
}

async function createChat(title = 'New Chat') {
  if (state.currentUser) {
    try {
      const res = await apiFetch('/api/chat/conversations', { method: 'POST', body: JSON.stringify({ title }) });
      const chat = await res.json();
      state.chats.unshift(chat); renderChatList(); return chat;
    } catch (err) { showToast('Failed to create chat: ' + err.message, true); return null; }
  }
  return createLocalChat(title);
}

async function selectChat(id) {
  state.activeChatId = id;
  if (state.currentUser && !id.startsWith('local_')) { await loadCloudMessages(id); renderChatList(); }
  else {
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
  const chat = state.chats.find(c => c.id === id); if (!chat) return;
  const t = await showCustomPrompt('Rename Chat', chat.title); if (!t) return;
  if (state.currentUser && !id.startsWith('local_')) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title: t }) });
      const u = await res.json(); const i = state.chats.findIndex(c => c.id === id);
      if (i !== -1) state.chats[i] = u; renderChatList();
    } catch (err) { showToast('Failed: ' + err.message, true); }
  } else { chat.title = t; renderChatList(); }
  chatMenu.classList.add('hidden');
}

async function togglePin(id) {
  const chat = state.chats.find(c => c.id === id); if (!chat) return;
  if (state.currentUser && !id.startsWith('local_')) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ pinned: !chat.pinned }) });
      const u = await res.json(); const i = state.chats.findIndex(c => c.id === id);
      if (i !== -1) state.chats[i] = u; renderChatList();
    } catch (err) { showToast('Failed: ' + err.message, true); }
  } else { chat.pinned = !chat.pinned; renderChatList(); }
  chatMenu.classList.add('hidden');
}

function openChatMenu(e, chatId) {
  e.preventDefault(); state.contextMenuTarget = chatId;
  const rect = e.target.getBoundingClientRect(); const w = 180;
  let left = Math.min(rect.left, window.innerWidth - w - 10);
  let top = rect.bottom + 5;
  if (top + 200 > window.innerHeight) top = rect.top - 200;
  chatMenu.style.left = left + 'px'; chatMenu.style.top = top + 'px';
  chatMenu.classList.remove('hidden');
  chatMenu.querySelectorAll('button').forEach(btn => {
    btn.onclick = null; const a = btn.dataset.action;
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
  const empty = state.chats.find(c => !c.messages || c.messages.length === 0);
  if (empty) { selectChat(empty.id); return; }
  createChat('New Chat').then(chat => {
    if (chat) {
      state.activeChatId = chat.id; state.messages = []; state.editingMessageId = null; state.messageVersions = {};
      renderMessages(); renderChatList(); messageInput.focus();
      if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
    }
  });
}

function resizeComposer() {
  messageInput.style.height = '0px';
  const sh = messageInput.scrollHeight;
  const maxH = Math.min(window.innerHeight * 0.5, 400);
  messageInput.style.height = Math.min(sh, maxH) + 'px';
  messageInput.style.overflowY = sh > maxH ? 'auto' : 'hidden';
}

function updateSendButton() {
  const has = messageInput.value.trim().length > 0 || state.attachments.length > 0;
  const si = sendBtn.querySelector('.send-icon'); const sti = sendBtn.querySelector('.stop-icon');
  if (!state.isGenerating) {
    if (si) si.style.display = 'inline'; if (sti) sti.style.display = 'none';
    sendBtn.disabled = !has; sendBtn.style.opacity = has ? '1' : '0.3';
    sendBtn.classList.remove('generating');
  } else {
    if (si) si.style.display = 'none'; if (sti) sti.style.display = 'inline';
    sendBtn.disabled = false; sendBtn.style.opacity = '1';
    sendBtn.classList.add('generating');
  }
}

function renderAttachments() {
  attachmentPreview.innerHTML = '';
  state.attachments.forEach((file, idx) => {
    const chip = document.createElement('div'); chip.className = 'attachment-chip';
    if (file.type?.startsWith('image/')) {
      const img = document.createElement('img'); img.src = URL.createObjectURL(file);
      img.onclick = () => openLightbox(img.src, true); chip.appendChild(img);
    } else {
      const ic = document.createElement('i'); ic.setAttribute('data-lucide', 'file-text'); chip.appendChild(ic);
    }
    const rm = document.createElement('button');
    rm.innerHTML = `<i data-lucide="x" style="width:14px;height:14px;"></i>`;
    rm.onclick = (e) => { e.stopPropagation(); state.attachments.splice(idx, 1); renderAttachments(); updateSendButton(); };
    chip.appendChild(rm); attachmentPreview.appendChild(chip);
  });
  window.refreshIcons();
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !state.attachments.length) return;
  if (state.isGenerating) return;

  let chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) {
    state.messages = [];
    const title = (text || 'New Chat').substring(0, 42);
    if (state.currentUser) {
      const cloud = await createChat(title); if (!cloud) return;
      chat = cloud; state.activeChatId = chat.id;
    } else {
      chat = createLocalChat(title); state.activeChatId = chat.id;
    }
  }

  if ((chat.title === 'New Chat' || !chat.title) && text) {
    const newTitle = text.substring(0, 42) + (text.length > 42 ? '…' : '');
    chat.title = newTitle;
    if (state.currentUser && !chat.id.startsWith('local_')) {
      try { await apiFetch(`/api/chat/conversations/${chat.id}`, { method: 'PUT', body: JSON.stringify({ title: newTitle }) }); } catch (e) { log('Title update failed', 'warn'); }
    }
    renderChatList();
  }

  const localFiles = state.attachments.map(f => ({ filename: f.name, mime_type: f.type, size: f.size, public_url: URL.createObjectURL(f) }));
  const userMsg = { id: 'user_' + Date.now().toString(36), role: 'user', content: text || '[File attached]', files: localFiles, created_at: new Date().toISOString() };
  state.messages.push(userMsg); chat.messages = state.messages; renderMessages();

  messageInput.value = ''; const atts = [...state.attachments]; state.attachments = [];
  renderAttachments(); resizeComposer(); updateSendButton();
  messageInput.disabled = true;

  const assist = { id: 'assist_' + Date.now().toString(36), role: 'assistant', content: '', files: [], created_at: new Date().toISOString() };
  state.messages.push(assist); chat.messages = state.messages;

  state.isGenerating = true; state.shouldScrollToBottom = true;
  renderMessages(); updateSendButton();
  state.abortController = new AbortController();

  try {
    let response;
    if (state.currentUser && !chat.id.startsWith('local_')) {
      const fd = new FormData(); fd.append('message', text || '');
      atts.forEach(f => fd.append('file', f));
      const session = (await state.supabase.auth.getSession()).data.session;
      let token = session?.access_token;
      if (!token) { const { data } = await state.supabase.auth.refreshSession(); token = data.session?.access_token; }
      if (!token) throw new Error('Session expired');
      response = await fetch(`/api/chat/conversations/${chat.id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd, signal: state.abortController.signal });
    } else {
      const cleanMessages = state.messages.filter(m => m.id !== assist.id);
      const payload = { messages: buildGuestPayload(cleanMessages) };
      if (atts.length > 0) {
        const first = atts[0];
        if (first.type?.startsWith('image/') && first.size < 4 * 1024 * 1024) {
          const b64 = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(first); });
          payload.image = { base64: b64, mimeType: first.type, filename: first.name };
        }
      }
      response = await fetch('/api/chat/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: state.abortController.signal });
    }
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'AI failed'); }
    await consumeStream(response, chat);
  } catch (err) {
    if (err.name === 'AbortError') {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === 'assistant') { last.status = 'stopped'; renderMessages(); }
    } else {
      showToast('Error: ' + err.message, true);
      const last = state.messages[state.messages.length - 1];
      if (last?.role === 'assistant' && (!last.content || !last.content.trim())) {
        state.messages.pop(); chat.messages = state.messages; renderMessages();
      }
    }
  } finally {
    state.isGenerating = false; sendBtn.classList.remove('generating'); sendBtn.disabled = false;
    messageInput.disabled = false; state.abortController = null; updateSendButton();
  }
}

function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort(); state.abortController = null;
    state.isGenerating = false; sendBtn.classList.remove('generating');
    sendBtn.disabled = false; messageInput.disabled = false; updateSendButton();
  }
}

function createPasswordField(id, placeholder) {
  const w = document.createElement('div'); w.style.cssText = 'position:relative;width:100%;';
  const input = document.createElement('input');
  input.type = 'password'; input.id = id; input.placeholder = placeholder;
  input.style.cssText = 'width:100%;padding-right:40px;';
  const t = document.createElement('button'); t.type = 'button';
  t.innerHTML = `<i data-lucide="eye" style="width:18px;height:18px;"></i>`;
  t.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;min-width:32px;min-height:32px;display:flex;align-items:center;justify-content:center;';
  t.onclick = () => {
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    t.innerHTML = `<i data-lucide="${isPw ? 'eye-off' : 'eye'}" style="width:18px;height:18px;"></i>`;
    window.refreshIcons();
  };
  w.appendChild(input); w.appendChild(t); return w;
}

function openAuthModal(mode = 'login') { authModal.classList.remove('hidden'); renderAuthForm(mode); }
function closeAuthModal() { authModal.classList.add('hidden'); }
modalClose.forEach(b => b.addEventListener('click', closeAuthModal));
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

function renderAuthForm(mode) {
  const isLogin = mode === 'login';
  authModalBody.innerHTML = `
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div id="authError" class="error-msg" style="display:none;"></div>
    <div id="authStatus" class="status-msg" style="display:none;"></div>
    <div id="authInitialSection">
      <label>Email</label>
      <input type="email" id="authEmail" placeholder="you@example.com" autocomplete="email" />
      <label>Password</label>
      <div id="authPasswordWrapper"></div>
      ${!isLogin ? `<label>Confirm Password</label><div id="authConfirmPasswordWrapper"></div>
        <div id="pwLiveStatus" style="font-size:.8rem;margin-top:.3rem;min-height:1.2em;"></div>` : ''}
      ${!isLogin ? `<label>Full Name (optional)</label><input type="text" id="authFullName" placeholder="Your name" autocomplete="name" />` : ''}
      <button class="btn-primary" id="authSubmitBtn" disabled>${isLogin ? 'Sign In' : 'Sign Up'}</button>
      <div class="toggle-link" id="authToggle">${isLogin ? 'Create an account' : 'Already have an account? Sign in'}</div>
    </div>
    <div id="verifySection" style="display:none;margin-top:1rem;">
      <p>We sent a verification code to your email.</p>
      <input type="text" id="verifyCode" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
      <button class="btn-primary" id="verifyBtn">Verify</button>
      <button id="resendVerifyBtn" class="link-btn" type="button">Resend code</button>
    </div>
    <div id="twofaSection" style="display:none;margin-top:1rem;">
      <p>Enter the 6-digit code from your authenticator app.</p>
      <input type="text" id="twofaCode" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
      <button class="btn-primary" id="twofaBtn">Verify 2FA</button>
    </div>`;
  document.getElementById('authPasswordWrapper').appendChild(createPasswordField('authPassword', '••••••••'));
  if (!isLogin) document.getElementById('authConfirmPasswordWrapper').appendChild(createPasswordField('authConfirmPassword', 'Confirm password'));
  window.refreshIcons();

  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleLink = document.getElementById('authToggle');
  const errDiv = document.getElementById('authError');
  const statDiv = document.getElementById('authStatus');
  const emailInput = document.getElementById('authEmail');
  const pwInput = document.getElementById('authPassword');
  const confirmInput = document.getElementById('authConfirmPassword');
  const pwLiveStatus = document.getElementById('pwLiveStatus');

  const pwIsStrong = (p) => p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);

  const check = () => {
    const e = emailInput.value.trim(); const p = pwInput.value;
    let valid = e.includes('@') && p.length > 0;
    if (!isLogin) {
      const c = confirmInput?.value || '';
      const strong = pwIsStrong(p);
      const match = c.length > 0 && p === c;
      if (pwLiveStatus) {
        if (!p && !c) { pwLiveStatus.textContent = ''; pwLiveStatus.style.color = ''; }
        else if (!strong) { pwLiveStatus.textContent = 'Password must be 8+ chars with letters and numbers'; pwLiveStatus.style.color = 'var(--danger)'; }
        else if (!match) { pwLiveStatus.textContent = 'Passwords do not match'; pwLiveStatus.style.color = 'var(--danger)'; }
        else { pwLiveStatus.textContent = '✓ Passwords match'; pwLiveStatus.style.color = 'var(--accent)'; }
      }
      valid = valid && strong && match;
    }
    submitBtn.disabled = !valid;
  };
  emailInput.addEventListener('input', check); pwInput.addEventListener('input', check);
  if (confirmInput) confirmInput.addEventListener('input', check);
  check();
  toggleLink.onclick = () => renderAuthForm(isLogin ? 'signup' : 'login');

  const wireResend = (resendBtn, endpoint, getToken, setToken) => {
    attachCountdown(resendBtn);
    resendBtn.onclick = async () => {
      if (resendBtn.disabled) return;
      statDiv.textContent = 'Resending...'; statDiv.style.display = 'block'; errDiv.style.display = 'none';
      try {
        const rr = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingToken: getToken() })
        });
        const rd = await rr.json();
        if (!rr.ok) throw new Error(rd.error || 'Failed to resend');
        setToken(rd.pendingToken);
        statDiv.textContent = 'New code sent. Check your email.';
        showToast('New code sent.');
        attachCountdown(resendBtn);
      } catch (e) {
        errDiv.textContent = e.message; errDiv.style.display = 'block';
        statDiv.style.display = 'none';
        resendBtn.disabled = false;
        if (resendBtn._cdInterval) { clearInterval(resendBtn._cdInterval); resendBtn._cdInterval = null; }
        resendBtn.textContent = resendBtn.dataset.originalText || 'Resend code';
      }
    };
  };

  submitBtn.onclick = async () => {
    if (!isLogin) {
      const email = emailInput.value.trim(), password = pwInput.value, confirm = confirmInput?.value || '';
      if (!email || !password) { errDiv.textContent = 'All fields required'; errDiv.style.display = 'block'; return; }
      if (password !== confirm) { errDiv.textContent = 'Passwords do not match'; errDiv.style.display = 'block'; return; }
      if (!pwIsStrong(password)) { errDiv.textContent = 'Password must be 8+ chars with letters and numbers'; errDiv.style.display = 'block'; return; }
      const fullName = document.getElementById('authFullName')?.value.trim() || email.split('@')[0];
      errDiv.style.display = 'none'; statDiv.textContent = 'Sending code...'; statDiv.style.display = 'block'; submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, fullName }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error);
        state.pendingAuth = data.pendingToken;
        document.getElementById('verifySection').style.display = 'block';
        statDiv.textContent = 'Verification code sent.';
        const resendBtn = document.getElementById('resendVerifyBtn');
        wireResend(resendBtn, '/api/auth/resend-verification', () => state.pendingAuth, t => state.pendingAuth = t);

        document.getElementById('verifyBtn').onclick = async () => {
          const code = document.getElementById('verifyCode').value.trim();
          if (!code) { errDiv.textContent = 'Enter the code'; errDiv.style.display = 'block'; return; }
          statDiv.textContent = 'Verifying...';
          try {
            const cr = await fetch('/api/auth/confirm-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingToken: state.pendingAuth, code }) });
            const cd = await cr.json(); if (!cr.ok) throw new Error(cd.error);
            await state.supabase.auth.setSession({ access_token: cd.session.access_token, refresh_token: cd.session.refresh_token });
            state.currentUser = cd.user; state.pendingAuth = null;
            updateAuthUI(); closeAuthModal(); showToast('Account created!');
            await loadCloudConversations();
          } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; statDiv.style.display = 'none'; }
        };
      } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; statDiv.style.display = 'none'; }
      finally { submitBtn.disabled = false; }
    } else {
      const email = emailInput.value.trim(), password = pwInput.value;
      if (!email || !password) { errDiv.textContent = 'Email and password required'; errDiv.style.display = 'block'; return; }
      errDiv.style.display = 'none'; statDiv.textContent = 'Checking password...'; statDiv.style.display = 'block'; submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error);
        state.pendingAuth = data.pendingToken;
        statDiv.textContent = 'Verification code sent. Check your email.';
        document.getElementById('verifySection').style.display = 'block';
        const resendBtn = document.getElementById('resendVerifyBtn');
        wireResend(resendBtn, '/api/auth/resend-login-code', () => state.pendingAuth, t => state.pendingAuth = t);

        document.getElementById('verifyBtn').onclick = async () => {
          const code = document.getElementById('verifyCode').value.trim();
          if (!code) { errDiv.textContent = 'Enter code'; errDiv.style.display = 'block'; return; }
          statDiv.textContent = 'Verifying...';
          try {
            const vr = await fetch('/api/auth/verify-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingToken: state.pendingAuth, code }) });
            const vd = await vr.json(); if (!vr.ok) throw new Error(vd.error);
            if (vd.requires2fa) {
              state.pendingAuth = vd.twoFactorToken;
              document.getElementById('verifySection').style.display = 'none';
              document.getElementById('twofaSection').style.display = 'block';
              statDiv.textContent = 'Email verified. Enter your 2FA code.';
              document.getElementById('twofaBtn').onclick = async () => {
                const c2 = document.getElementById('twofaCode').value.trim();
                if (!c2) { errDiv.textContent = 'Enter 2FA code'; errDiv.style.display = 'block'; return; }
                try {
                  const t2 = await fetch('/api/auth/2fa/validate-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ twoFactorToken: state.pendingAuth, code: c2 }) });
                  const t2d = await t2.json(); if (!t2.ok) throw new Error(t2d.error);
                  await state.supabase.auth.setSession({ access_token: t2d.session.access_token, refresh_token: t2d.session.refresh_token });
                  state.currentUser = t2d.user; state.pendingAuth = null;
                  updateAuthUI(); closeAuthModal(); showToast('Signed in!');
                  await loadCloudConversations();
                } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; }
              };
              return;
            }
            await state.supabase.auth.setSession({ access_token: vd.session.access_token, refresh_token: vd.session.refresh_token });
            state.currentUser = vd.user; state.pendingAuth = null;
            updateAuthUI(); closeAuthModal(); showToast('Signed in!');
            await loadCloudConversations();
          } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; statDiv.style.display = 'none'; }
        };
      } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; statDiv.style.display = 'none'; }
      finally { submitBtn.disabled = false; }
    }
  };
}

// ============ ACCOUNT MODAL ============
async function openAccountModal() {
  if (!state.currentUser) return;
  let profile = {};
  try { const res = await apiFetch('/api/auth/me'); const d = await res.json(); profile = d.profile || {}; } catch (e) {}

  const modal = document.createElement('div');
  modal.className = 'modal account-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" id="accClose">&times;</button>
      <div class="account-modal-layout">
        <div class="account-tabs">
          <div class="account-tab active" data-tab="profile"><i data-lucide="user"></i> Profile</div>
          <div class="account-tab" data-tab="account"><i data-lucide="settings"></i> Account</div>
          <div class="account-tab" data-tab="security"><i data-lucide="shield"></i> Security</div>
          <div class="account-tab" data-tab="sessions"><i data-lucide="monitor"></i> Sessions</div>
          <div class="account-tab logout-tab" data-tab="logout"><i data-lucide="log-out"></i> Log out</div>
        </div>
        <div class="account-content" id="accContent"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#accClose').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  const tabs = modal.querySelectorAll('.account-tab');
  const content = modal.querySelector('#accContent');

  const render = async (id) => {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    if (id === 'logout') {
      content.innerHTML = `<div style="display:flex;flex-direction:column;gap:1rem;"><h2>Log out</h2><p>Are you sure?</p><button class="btn-primary" id="loConfirm" style="background:var(--danger);">Log out</button><button class="btn-primary" id="loCancel" style="background:transparent;border:1px solid var(--border);color:var(--text);">Cancel</button></div>`;
      content.querySelector('#loConfirm').onclick = async () => {
        await state.supabase.auth.signOut();
        close(); showToast('Logged out');
      };
      content.querySelector('#loCancel').onclick = () => render('profile');
      return;
    }
    let html = '';
    if (id === 'profile') {
      html = `<h2>Profile</h2><div class="profile-info"><p><strong>Name:</strong> ${profile.full_name || state.currentUser.email}</p><p><strong>Email:</strong> ${state.currentUser.email}</p><p><strong>Member since:</strong> ${new Date(state.currentUser.created_at).toLocaleDateString()}</p></div>`;
    } else if (id === 'account') {
      html = `<h2>Account Settings</h2>
        <div class="account-section">
          <label>Email</label>
          <input type="email" id="newEmail" value="${state.currentUser.email}" />
          <button class="btn-primary" id="changeEmailBtn">Change Email</button>
          <div id="emailVerify" style="display:none;margin-top:.5rem;">
            <label>Verification code</label>
            <input type="text" id="emailCode" inputmode="numeric" maxlength="6" />
            <button class="btn-primary" id="emailVerifyBtn">Verify & Change</button>
            <button id="emailResendBtn" class="link-btn" type="button">Resend code</button>
          </div>
          <hr />
          <label>Current Password</label>
          <div id="curPwWrap"></div>
          <label>New Password</label>
          <div id="newPwWrap"></div>
          <div id="pwLiveStatus" style="font-size:.8rem;margin-top:.3rem;min-height:1.2em;"></div>
          <button class="btn-primary" id="changePwBtn">Change Password</button>
          <div id="pwVerify" style="display:none;margin-top:.5rem;">
            <label>Verification code</label>
            <input type="text" id="pwCode" inputmode="numeric" maxlength="6" />
            <button class="btn-primary" id="pwVerifyBtn">Verify & Change</button>
            <button id="pwResendBtn" class="link-btn" type="button">Resend code</button>
          </div>
          <hr />
          <h3 style="color:var(--danger);margin-top:.5rem;">Danger Zone</h3>
          <p style="font-size:.85rem;color:var(--text-muted);">Permanently delete your account and all associated data. This cannot be undone.</p>
          <button class="btn-primary" id="deleteAccountBtn" style="background:var(--danger);">Delete Account</button>
          <div id="deleteVerify" style="display:none;margin-top:.5rem;">
            <label>Verification code</label>
            <input type="text" id="deleteCode" inputmode="numeric" maxlength="6" />
            <button class="btn-primary" id="deleteVerifyBtn" style="background:var(--danger);">Verify & Delete</button>
            <button id="deleteResendBtn" class="link-btn" type="button">Resend code</button>
          </div>
        </div>`;
    } else if (id === 'security') {
      const en = profile.two_factor_enabled;
      html = `<h2>Security</h2><div class="security-section"><h3>Two-Factor Authentication</h3><p>${en ? 'Enabled.' : 'Disabled.'}</p>${en ? `<button class="btn-primary btn-danger" id="dis2fa">Disable 2FA</button>` : `<button class="btn-primary" id="en2fa">Enable 2FA</button><div id="twofaSetup" style="display:none;margin-top:1rem;"><div class="twofa-setup"><p>Scan with your authenticator app:</p><div id="qrCode"></div><div class="manual-secret"><p style="font-size:.85rem;color:var(--text-muted);margin-top:.75rem;">Or enter this code manually in your app:</p><div class="secret-box"><code id="manualSecret"></code><button type="button" id="copySecretBtn" class="copy-secret-btn">Copy</button></div></div><label style="margin-top:1rem;">Enter 6-digit code:</label><input type="text" id="twofaCodeIn" inputmode="numeric" maxlength="6" /><button class="btn-primary" id="verify2faBtn">Verify & Enable</button></div></div>`}</div>`;
    } else if (id === 'sessions') {
      try {
        const res = await apiFetch('/api/auth/sessions');
        const data = await res.json();
        const cur = data.current || {};
        const acc = data.account || {};
        const all = data.all || [];
        html = `<h2>Active Sessions</h2>
          <div class="sessions-list">
            <h3>Current device</h3>
            <p><strong>Email:</strong> ${cur.email || state.currentUser.email}</p>
            <p><strong>Browser:</strong> ${(cur.user_agent || '').substring(0, 80)}</p>
            <p><strong>IP:</strong> ${cur.ip || 'Unknown'}</p>
            <hr />
            <h3>All recent sessions (${all.length})</h3>
            ${all.length === 0 ? '<p style="color:var(--text-muted);font-size:.85rem;">No other sessions recorded.</p>' : all.map(s => `
              <div class="session-item">
                <p><strong>Device:</strong> ${(s.device || 'Unknown').substring(0, 60)}</p>
                <p><strong>IP:</strong> ${s.ip || 'Unknown'}</p>
                <p style="font-size:.8rem;color:var(--text-muted);">Last active: ${new Date(s.last_active || s.created_at).toLocaleString()}</p>
              </div>
            `).join('')}
            <hr />
            <h3>Account</h3>
            <p><strong>Created:</strong> ${acc.created_at ? new Date(acc.created_at).toLocaleString() : '—'}</p>
            <p><strong>Last sign in:</strong> ${acc.last_sign_in_at ? new Date(acc.last_sign_in_at).toLocaleString() : '—'}</p>
          </div>`;
      } catch (e) { html = `<h2>Active Sessions</h2><p>Unable to load: ${e.message}</p>`; }
    }
    content.innerHTML = html;
    window.refreshIcons();

    if (id === 'account') {
      document.getElementById('curPwWrap').appendChild(createPasswordField('curPw', 'Current password'));
      document.getElementById('newPwWrap').appendChild(createPasswordField('newPw', 'New password'));
      window.refreshIcons();

      const pwLiveStatus = document.getElementById('pwLiveStatus');
      const pwIsStrong = (p) => p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);
      const updatePwLive = () => {
        const cur = document.getElementById('curPw')?.value || '';
        const np = document.getElementById('newPw')?.value || '';
        if (!cur && !np) { pwLiveStatus.textContent = ''; return; }
        if (!np) { pwLiveStatus.textContent = ''; return; }
        if (!pwIsStrong(np)) { pwLiveStatus.textContent = 'New password must be 8+ chars with letters and numbers'; pwLiveStatus.style.color = 'var(--danger)'; return; }
        if (np === cur) { pwLiveStatus.textContent = 'New password must be different from current password'; pwLiveStatus.style.color = 'var(--danger)'; return; }
        pwLiveStatus.textContent = '✓ Password looks good';
        pwLiveStatus.style.color = 'var(--accent)';
      };
      document.getElementById('curPw').addEventListener('input', updatePwLive);
      document.getElementById('newPw').addEventListener('input', updatePwLive);

      let emailPendingToken = null;
      document.getElementById('changeEmailBtn').onclick = async () => {
        const newEmail = document.getElementById('newEmail').value.trim();
        if (!newEmail || newEmail === state.currentUser.email) { showToast('Different email required', true); return; }
        try {
          const res = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'change-email' }) });
          const data = await res.json();
          emailPendingToken = data.pendingToken;
          showToast('Code sent.');
          document.getElementById('emailVerify').style.display = 'block';
          const resendBtn = document.getElementById('emailResendBtn');
          attachCountdown(resendBtn);
          resendBtn.onclick = async () => {
            if (resendBtn.disabled) return;
            try {
              const r = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'change-email' }) });
              const rd = await r.json();
              emailPendingToken = rd.pendingToken;
              showToast('New code sent.');
              attachCountdown(resendBtn);
            } catch (e) { showToast(e.message, true); resendBtn.disabled = false; resendBtn.textContent = 'Resend code'; if (resendBtn._cdInterval) { clearInterval(resendBtn._cdInterval); resendBtn._cdInterval = null; } }
          };
          document.getElementById('emailVerifyBtn').onclick = async () => {
            const code = document.getElementById('emailCode').value.trim();
            if (!code) { showToast('Enter code', true); return; }
            try {
              const vr = await apiFetch('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ pendingToken: emailPendingToken, code, action: 'change-email' }) });
              const vd = await vr.json();
              await apiFetch('/api/auth/change-email', { method: 'POST', body: JSON.stringify({ newEmail, grantedToken: vd.grantedToken }) });
              showToast('Email changed.'); close();
            } catch (e) { showToast(e.message, true); }
          };
        } catch (e) { showToast(e.message, true); }
      };

      // ---- Change Password: VERIFY CURRENT FIRST before sending code ----
      let pwPendingToken = null;
      document.getElementById('changePwBtn').onclick = async () => {
        const cur = document.getElementById('curPw').value;
        const np = document.getElementById('newPw').value;
        if (!cur || !np) { showToast('Fill both fields', true); return; }
        if (!pwIsStrong(np)) { showToast('New password must be 8+ chars with letters and numbers', true); return; }
        if (np === cur) { showToast('New password must be different from current password', true); return; }
        // STEP 1: Verify current password BEFORE sending the code
        try {
          const vres = await apiFetch('/api/auth/verify-current-password', { method: 'POST', body: JSON.stringify({ password: cur }) });
          const vd = await vres.json();
          if (!vd.valid) throw new Error('Current password is incorrect');
        } catch (e) {
          showToast(e.message || 'Current password is incorrect', true);
          return; // Do NOT send code
        }
        // STEP 2: Current password verified — now send the code
        try {
          const res = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'change-password' }) });
          const data = await res.json();
          pwPendingToken = data.pendingToken;
          showToast('Code sent.');
          document.getElementById('pwVerify').style.display = 'block';
          const resendBtn = document.getElementById('pwResendBtn');
          attachCountdown(resendBtn);
          resendBtn.onclick = async () => {
            if (resendBtn.disabled) return;
            try {
              const r = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'change-password' }) });
              const rd = await r.json();
              pwPendingToken = rd.pendingToken;
              showToast('New code sent.');
              attachCountdown(resendBtn);
            } catch (e) { showToast(e.message, true); resendBtn.disabled = false; resendBtn.textContent = 'Resend code'; if (resendBtn._cdInterval) { clearInterval(resendBtn._cdInterval); resendBtn._cdInterval = null; } }
          };
          document.getElementById('pwVerifyBtn').onclick = async () => {
            const code = document.getElementById('pwCode').value.trim();
            if (!code) { showToast('Enter code', true); return; }
            try {
              const vr = await apiFetch('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ pendingToken: pwPendingToken, code, action: 'change-password' }) });
              const vd = await vr.json();
              await apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: np, grantedToken: vd.grantedToken }) });
              showToast('Password changed.'); close();
            } catch (e) { showToast(e.message, true); }
          };
        } catch (e) { showToast(e.message, true); }
      };

      let delPendingToken = null;
      document.getElementById('deleteAccountBtn').onclick = async () => {
        const ok = await showCustomModal('Delete Account', 'This will permanently delete your account and all chats. Continue?', 'Continue', 'Cancel', true);
        if (!ok) return;
        try {
          const res = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'delete-account' }) });
          const data = await res.json();
          delPendingToken = data.pendingToken;
          showToast('Verification code sent.');
          document.getElementById('deleteVerify').style.display = 'block';
          const resendBtn = document.getElementById('deleteResendBtn');
          attachCountdown(resendBtn);
          resendBtn.onclick = async () => {
            if (resendBtn.disabled) return;
            try {
              const r = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'delete-account' }) });
              const rd = await r.json();
              delPendingToken = rd.pendingToken;
              showToast('New code sent.');
              attachCountdown(resendBtn);
            } catch (e) { showToast(e.message, true); resendBtn.disabled = false; resendBtn.textContent = 'Resend code'; if (resendBtn._cdInterval) { clearInterval(resendBtn._cdInterval); resendBtn._cdInterval = null; } }
          };
          document.getElementById('deleteVerifyBtn').onclick = async () => {
            const code = document.getElementById('deleteCode').value.trim();
            if (!code) { showToast('Enter code', true); return; }
            try {
              const vr = await apiFetch('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ pendingToken: delPendingToken, code, action: 'delete-account' }) });
              const vd = await vr.json();
              await apiFetch('/api/auth/delete-account', { method: 'DELETE', body: JSON.stringify({ grantedToken: vd.grantedToken }) });
              showToast('Account deleted.');
              await state.supabase.auth.signOut();
              close();
            } catch (e) { showToast(e.message, true); }
          };
        } catch (e) { showToast(e.message, true); }
      };
    }
    if (id === 'security') {
      document.getElementById('en2fa')?.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/auth/2fa/enable', { method: 'POST' });
          const d = await res.json();
          document.getElementById('qrCode').innerHTML = `<img src="${d.qrCodeDataUrl}" class="qr-code" />`;
          document.getElementById('manualSecret').textContent = d.secret;
          document.getElementById('copySecretBtn').onclick = () => {
            navigator.clipboard.writeText(d.secret).then(() => showToast('Secret copied!'));
          };
          document.getElementById('twofaSetup').style.display = 'block';
          document.getElementById('verify2faBtn').onclick = async () => {
            const code = document.getElementById('twofaCodeIn').value.trim();
            try { await apiFetch('/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) }); showToast('2FA enabled.'); close(); openAccountModal(); } catch (e) { showToast(e.message, true); }
          };
        } catch (e) { showToast(e.message, true); }
      });
      document.getElementById('dis2fa')?.addEventListener('click', async () => {
        try { await apiFetch('/api/auth/2fa/disable', { method: 'POST' }); showToast('2FA disabled.'); close(); openAccountModal(); } catch (e) { showToast(e.message, true); }
      });
    }
  };
  tabs.forEach(t => t.onclick = () => render(t.dataset.tab));
  render('profile');
}

attachBtn.onclick = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,.txt,.doc,.docx';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files);
    if (files.some(f => f.size > 10 * 1024 * 1024)) { showToast('Max 10MB per file', true); return; }
    if (state.attachments.length + files.length > MAX_ATTACHMENTS) { showToast(`Max ${MAX_ATTACHMENTS} files`, true); return; }
    state.attachments.push(...files);
    renderAttachments(); updateSendButton();
  };
  input.click();
};

sidebarToggle.onclick = () => {
  sidebar.classList.toggle('collapsed');
  const c = sidebar.classList.contains('collapsed');
  sidebarToggle.querySelector('[data-lucide="panel-left-close"]').style.display = c ? 'none' : 'inline';
  sidebarToggle.querySelector('[data-lucide="panel-left-open"]').style.display = c ? 'inline' : 'none';
};
openSidebarBtn.onclick = () => sidebar.classList.toggle('mobile-open');
document.addEventListener('click', (e) => {
  if (window.innerWidth < 768 && sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && e.target !== openSidebarBtn) sidebar.classList.remove('mobile-open');
});

newChatBtn.onclick = handleNewChat;
sendBtn.onclick = () => { if (state.isGenerating) stopGeneration(); else sendMessage(); };
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!state.isGenerating) sendMessage(); }
});
messageInput.addEventListener('input', () => { resizeComposer(); updateSendButton(); });
chips.forEach(c => c.onclick = () => { messageInput.value = c.dataset.prompt; updateSendButton(); sendMessage(); });
document.getElementById('shareModalClose').onclick = () => shareModal.classList.add('hidden');
shareModal.onclick = (e) => { if (e.target === shareModal) shareModal.classList.add('hidden'); };

async function checkShareView() {
  const path = window.location.pathname;
  if (!path.startsWith('/share/')) return false;
  const token = path.split('/share/')[1];
  if (!token) return false;
  state.isShareView = true;
  document.body.classList.add('share-view');
  try {
    const res = await fetch(`/api/share/${token}`);
    if (!res.ok) throw new Error('Share not found');
    const data = await res.json();
    state.shareMessages = data.messages || [];
    renderMessages();
    document.title = 'Shared Chat — AgriDeepAI';
  } catch (err) {
    messageList.innerHTML = `<p style="color:var(--danger);text-align:center;padding:2rem;">Error loading share: ${err.message}</p>`;
  }
  return true;
}

(async function init() {
  const isShare = await checkShareView();
  if (!isShare) { await initSupabase(); updateSendButton(); }
})();
