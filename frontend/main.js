// ============================================================
// AGRIDEEPAI — Full Frontend
// ============================================================

const log = (msg, type = 'info') => console.log(`[FRONTEND] [${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}`);

const IS_SHARE_VIEW = document.documentElement.classList.contains('is-share-view');

const CLIENT_ID_KEY = 'agrideepai-client-id-v1';
function getOrCreateClientId() {
  try {
    let id = window.localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
      const bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      id = 'c_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch (e) {
    return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
const CLIENT_ID = getOrCreateClientId();
log(`Client ID: ${CLIENT_ID}`, 'debug');

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
const chatContainer = document.getElementById('chatContainer');

const MAX_ATTACHMENTS = 5;
const CODE_RESEND_SECONDS = 60;
const SESSION_CHECK_THROTTLE_MS = 20000;

let state = {
  activeChatId: null, chats: [], messages: [],
  isGenerating: false, abortController: null,
  supabase: null, currentUser: null,
  attachments: [], editingMessageId: null, editingValue: '', editingSelection: null,
  messageVersions: {}, likedMessages: new Set(), dislikedMessages: new Set(),
  contextMenuTarget: null, isShareView: IS_SHARE_VIEW, shareMessages: [], copyTimeout: null,
  pendingAuth: null, shouldScrollToBottom: false,
  lastSessionCheck: 0, isSigningOut: false,
  forgotPw: { email: null, pendingToken: null, grantedToken: null },
};

function isNearBottom(container, threshold = 200) {
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}
function smartScroll(force = false) {
  if (!chatContainer) return;
  if (!force && !state.shouldScrollToBottom && !isNearBottom(chatContainer)) return;
  requestAnimationFrame(() => {
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
  });
  state.shouldScrollToBottom = false;
}
if (chatContainer) {
  chatContainer.addEventListener('scroll', () => {
    if (!isNearBottom(chatContainer, 80)) state.shouldScrollToBottom = false;
  }, { passive: true });
}

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
      clearInterval(btn._cdInterval); btn._cdInterval = null;
      btn.disabled = false; btn.textContent = btn.dataset.originalText;
    } else btn.textContent = `Resend in ${remaining}s`;
  }, 1000);
}

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
    const img = document.createElement('img'); img.src = src;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
    overlay.appendChild(img);
  } else {
    const link = document.createElement('a'); link.href = src; link.target = '_blank';
    link.style.cssText = 'color:#fff;font-size:1.2rem;text-decoration:underline;';
    link.textContent = 'Open file in new tab'; overlay.appendChild(link);
  }
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

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
  if (!content) return '';
  const lines = String(content).split('\n');
  const out = []; let skip = false;
  for (const line of lines) {
    if (/^sources:/i.test(line.trim())) { skip = true; continue; }
    if (skip && line.trim() === '') { skip = false; continue; }
    if (!skip) out.push(line);
  }
  return out.join('\n').trim();
}

function escapeRawHtmlOutsideCode(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  let inFence = false;
  let fenceChar = '';
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const char = fenceMatch[1][0];
      if (!inFence) {
        inFence = true; fenceChar = char; out.push(line); continue;
      } else if (char === fenceChar) {
        inFence = false; fenceChar = ''; out.push(line); continue;
      }
      out.push(line); continue;
    }

    if (inFence) { out.push(line); continue; }

    const parts = line.split(/(`+[^`]*`+)/g);
    const escaped = parts.map(part => {
      if (/^`+[^`]*`+$/.test(part)) return part;
      return part.replace(
        /<(\/?)([a-zA-Z][a-zA-Z0-9-]{0,20})((?:\s[^>]*)?)(\/?)>/g,
        (m, slash, tag, attrs, sc) => {
          if (attrs && /:\/\//.test(attrs)) return m;
          return `&lt;${slash}${tag}${attrs}${sc}&gt;`;
        }
      );
    }).join('');

    out.push(escaped);
  }

  return out.join('\n');
}

function safeMarkdown(text) {
  try {
    const cleaned = cleanContent(text) || '';
    const escaped = escapeRawHtmlOutsideCode(cleaned);
    let html = marked.parse(escaped) || '';
    html = html.replace(/<hr\s*\/?>/g, '');
    return html;
  } catch (e) {
    return (String(text) || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  }
}

function enhanceCodeBlocks(container) {
  if (!container) return;
  const pres = container.querySelectorAll('pre');
  pres.forEach(pre => {
    if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrap')) return;

    pre.removeAttribute('style');

    const wrap = document.createElement('div');
    wrap.className = 'code-block-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.title = 'Copy code';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.onclick = (e) => {
      e.stopPropagation();
      const code = pre.textContent || '';
      const done = () => {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
      };
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(() => { fallback(); done(); });
      } else {
        fallback(); done();
      }
    };
    wrap.appendChild(btn);
  });
}

async function downloadGeneratedImage(url, filename) {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || `agrideepai-image-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    showToast('Image downloaded');
  } catch (err) {
    log(`Download failed, falling back to new tab: ${err.message}`, 'warn');
    window.open(url, '_blank');
  }
}

async function initSupabase() {
  log('Initializing Supabase...', 'info');
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    state.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
        storage: window.localStorage, storageKey: 'agrideepai-auth-v2', flowType: 'pkce',
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
      state.currentUser = session.user;
      const ok = await verifySessionValidity(true);
      if (!ok) return;
      updateAuthUI(); await loadCloudConversations();
    } else {
      const { data: refreshed } = await state.supabase.auth.refreshSession();
      if (refreshed.session?.user) {
        state.currentUser = refreshed.session.user;
        const ok = await verifySessionValidity(true);
        if (!ok) return;
        updateAuthUI(); await loadCloudConversations();
      } else {
        updateAuthUI(); renderChatList(); renderMessages();
      }
    }
  } catch (err) {
    log(`Supabase init error: ${err.message}`, 'error');
    renderChatList(); renderMessages();
  }
}

async function verifySessionValidity(force = false) {
  if (!state.supabase || !state.currentUser || state.isShareView) return true;
  const now = Date.now();
  if (!force && now - state.lastSessionCheck < SESSION_CHECK_THROTTLE_MS) return true;
  state.lastSessionCheck = now;
  try {
    let session = (await state.supabase.auth.getSession()).data.session;
    if (!session) return false;
    const doFetch = (token) => fetch('/api/auth/session-check', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'X-Client-Id': CLIENT_ID },
      cache: 'no-store',
    });
    let res = await doFetch(session.access_token);
    if (res.status === 401) {
      const { data } = await state.supabase.auth.refreshSession();
      if (data.session?.access_token) res = await doFetch(data.session.access_token);
      else { await forceSignOut('Session expired'); return false; }
    }
    if (!res.ok) return true;
    const data = await res.json().catch(() => ({ valid: true }));
    if (data && data.valid === false) {
      await forceSignOut('Signed out from another device');
      return false;
    }
    return true;
  } catch (e) {
    log(`verifySessionValidity error: ${e.message}`, 'warn');
    return true;
  }
}

async function forceSignOut(reason = 'Signed out') {
  if (state.isSigningOut) return;
  state.isSigningOut = true;
  try {
    document.querySelectorAll('.modal').forEach(m => m.remove());
    document.querySelectorAll('.lightbox-overlay').forEach(m => m.remove());
    if (state.supabase) {
      try { await state.supabase.auth.signOut({ scope: 'local' }); } catch (e) {}
    }
    try { window.localStorage.removeItem('agrideepai-auth-v2'); } catch (e) {}
    state.currentUser = null;
    state.chats = []; state.messages = []; state.activeChatId = null;
    state.lastSessionCheck = 0;
    updateAuthUI(); renderChatList(); renderMessages();
    showToast(reason, true);
  } finally {
    state.isSigningOut = false;
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
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    'X-Client-Id': CLIENT_ID,
    ...options.headers,
  };
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
    } catch (e) {}
  }
  await loadCloudMessages(chatId);
  await loadCloudConversations();
  return false;
}

function rebuildVersions() {
  state.messageVersions = {};
  state.messages.forEach((msg, idx) => {
    if (!msg.versions || msg.versions.length === 0) return;

    const curIdx = msg.current_version_index ?? msg.currentVersionIndex ?? 0;
    const versions = msg.versions.slice();

    let serverVersionFiles = Array.isArray(msg.version_files) ? msg.version_files : null;
    let serverAiReplies = Array.isArray(msg.ai_replies) ? msg.ai_replies : null;
    let serverAiFiles = Array.isArray(msg.ai_files) ? msg.ai_files : null;

    const useServer = serverVersionFiles && serverAiReplies && serverAiFiles
      && serverVersionFiles.length === versions.length
      && serverAiReplies.length === versions.length
      && serverAiFiles.length === versions.length;

    let aiReplies, aiFiles, files;

    if (useServer) {
      aiReplies = serverAiReplies.map(r => (typeof r === 'string' ? r : ''));
      aiFiles = serverAiFiles.map(a => Array.isArray(a) ? a.slice() : []);
      files = serverVersionFiles.map(a => Array.isArray(a) ? a.slice() : []);
    } else {
      aiReplies = new Array(versions.length).fill('');
      aiFiles = new Array(versions.length).fill(null).map(() => []);
      files = new Array(versions.length).fill(null).map(() => []);
      if (curIdx >= 0 && curIdx < versions.length) {
        const aiMsg = state.messages[idx + 1];
        if (aiMsg && aiMsg.role === 'assistant') {
          aiReplies[curIdx] = aiMsg.content || '';
          if (Array.isArray(aiMsg.files)) aiFiles[curIdx] = aiMsg.files.slice();
        }
        if (Array.isArray(msg.files)) files[curIdx] = msg.files.slice();
      }
    }

    state.messageVersions[msg.id] = { versions, aiReplies, aiFiles, files, currentIndex: curIdx };
    msg.content = versions[curIdx] || '';
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

function renderGeneratedImageBlock(genFile) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;margin-top:.6rem;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:var(--background);max-width:min(560px,100%);';

  const img = document.createElement('img');
  img.src = genFile.public_url;
  img.alt = 'Generated image';
  img.style.cssText = 'display:block;width:100%;height:auto;cursor:zoom-in;';
  img.onclick = () => openLightbox(genFile.public_url, true);
  img.onerror = () => {
    const err = document.createElement('div');
    err.style.cssText = 'padding:1rem;color:var(--text-muted);font-size:.85rem;text-align:center;';
    err.textContent = 'Image unavailable.';
    wrap.replaceChildren(err);
  };
  wrap.appendChild(img);

  const dlBtn = document.createElement('button');
  dlBtn.title = 'Download image';
  dlBtn.setAttribute('aria-label', 'Download image');
  dlBtn.innerHTML = `<i data-lucide="download" style="width:16px;height:16px;"></i>`;
  dlBtn.style.cssText = 'position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.6);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:.4rem;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;min-width:36px;min-height:36px;backdrop-filter:blur(4px);transition:background .15s;';
  dlBtn.onmouseenter = () => { dlBtn.style.background = 'rgba(0,0,0,.8)'; };
  dlBtn.onmouseleave = () => { dlBtn.style.background = 'rgba(0,0,0,.6)'; };
  dlBtn.onclick = (e) => {
    e.stopPropagation();
    downloadGeneratedImage(genFile.public_url, `agrideepai-${Date.now()}.jpg`);
  };
  wrap.appendChild(dlBtn);

  return wrap;
}

function renderMessages() {
  messageList.innerHTML = '';
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
      const area = document.createElement('div'); area.className = 'edit-area';
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
      ta.className = 'edit-textarea';
      ta.value = state.editingValue;
      const autoGrow = () => {
        ta.style.height = 'auto';
        const maxH = Math.min(window.innerHeight * 0.6, 600);
        const want = Math.min(ta.scrollHeight + 2, maxH);
        ta.style.height = Math.max(want, 44) + 'px';
        ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
      };

      // Persist BOTH the text and the cursor position so any re-render or
      // tab switch can restore the exact editing state.
      const rememberState = () => {
        state.editingValue = ta.value;
        state.editingSelection = { start: ta.selectionStart, end: ta.selectionEnd };
      };
      ta.addEventListener('input', () => { rememberState(); autoGrow(); });
      ta.addEventListener('keyup', rememberState);
      ta.addEventListener('click', rememberState);
      ta.addEventListener('mouseup', rememberState);
      ta.addEventListener('select', rememberState);
      ta.addEventListener('blur', rememberState);

      // Restore cursor on regaining focus — but skip if focus came from an
      // actual click (in that case the click's own position should win).
      let skipNextFocusRestore = false;
      ta.addEventListener('mousedown', () => {
        skipNextFocusRestore = true;
        setTimeout(() => { skipNextFocusRestore = false; }, 0);
      });
      ta.addEventListener('focus', () => {
        if (skipNextFocusRestore) return;
        if (state.editingSelection && typeof state.editingSelection.start === 'number') {
          try { ta.setSelectionRange(state.editingSelection.start, state.editingSelection.end); } catch (e) {}
        }
      });

      const g = document.createElement('div'); g.className = 'edit-actions';
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.className = 'edit-btn-cancel';
      cancel.onclick = () => {
        state.editingMessageId = null;
        state.editingSelection = null;
        renderMessages();
      };
      const send = document.createElement('button'); send.textContent = 'Send'; send.className = 'edit-btn-send';
      send.onclick = async () => {
        const newContent = ta.value.trim(); if (!newContent) return;

        const curIdx = state.messages.indexOf(msg);
        const oldAiMsg = (state.messages[curIdx + 1] && state.messages[curIdx + 1].role === 'assistant')
          ? state.messages[curIdx + 1]
          : null;

        if (!state.messageVersions[msg.id]) {
          state.messageVersions[msg.id] = {
            versions: [msg.content],
            aiReplies: [oldAiMsg ? (oldAiMsg.content || '') : ''],
            aiFiles: [oldAiMsg && Array.isArray(oldAiMsg.files) ? oldAiMsg.files.slice() : []],
            files: [Array.isArray(msg.files) ? msg.files.slice() : []],
            currentIndex: 0,
          };
        }
        const v = state.messageVersions[msg.id];
        if (!Array.isArray(v.aiReplies)) v.aiReplies = new Array(v.versions.length).fill('');
        if (!Array.isArray(v.aiFiles)) v.aiFiles = new Array(v.versions.length).fill(null).map(() => []);
        if (!Array.isArray(v.files)) v.files = new Array(v.versions.length).fill(null).map(() => []);
        while (v.aiReplies.length < v.versions.length) v.aiReplies.push('');
        while (v.aiFiles.length < v.versions.length) v.aiFiles.push([]);
        while (v.files.length < v.versions.length) v.files.push([]);

        if ((v.aiReplies[v.currentIndex] === undefined || v.aiReplies[v.currentIndex] === '') && oldAiMsg) {
          v.aiReplies[v.currentIndex] = oldAiMsg.content || '';
        }
        if ((!v.aiFiles[v.currentIndex] || v.aiFiles[v.currentIndex].length === 0) && oldAiMsg && Array.isArray(oldAiMsg.files) && oldAiMsg.files.length > 0) {
          v.aiFiles[v.currentIndex] = oldAiMsg.files.slice();
        }
        if ((!v.files[v.currentIndex] || v.files[v.currentIndex].length === 0) && Array.isArray(msg.files) && msg.files.length > 0) {
          v.files[v.currentIndex] = msg.files.slice();
        }

        if (v.versions[v.versions.length - 1] !== newContent) {
          v.versions.push(newContent);
          v.aiReplies.push('');
          v.aiFiles.push([]);
          v.files.push(Array.isArray(msg.files) ? msg.files.slice() : []);
          v.currentIndex = v.versions.length - 1;
        } else {
          v.currentIndex = v.versions.length - 1;
        }

        msg.content = newContent;
        if (Array.isArray(v.files[v.currentIndex])) msg.files = v.files[v.currentIndex].slice();
        const i = state.messages.indexOf(msg);
        state.messages = state.messages.slice(0, i + 1);
        state.editingMessageId = null;
        state.editingSelection = null;
        const chat = state.chats.find(c => c.id === state.activeChatId);
        if (chat) chat.messages = state.messages;
        renderMessages(); await sendEditedUserMessage();
      };
      g.appendChild(cancel); g.appendChild(send);
      area.appendChild(ta); area.appendChild(g); msgDiv.appendChild(area);
      msgDiv.classList.add('message-editing');
      row.appendChild(msgDiv); messageList.appendChild(row);
      setTimeout(() => {
        ta.focus();
        autoGrow();
        // Restore saved cursor if we're re-rendering an in-progress edit;
        // otherwise (fresh edit) put the cursor at the end.
        if (state.editingSelection && typeof state.editingSelection.start === 'number') {
          try {
            ta.setSelectionRange(state.editingSelection.start, state.editingSelection.end);
          } catch (e) {
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
        } else {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }, 50);
      return;
    }

    if (msg.role === 'assistant') {
      const isLast = index === lastIndex;
      const thinking = isLast && state.isGenerating && msg.content === '' && !(msg.files?.some(f => f.generated));
      if (thinking) {
        const t = document.createElement('div'); t.className = 'thinking-indicator';
        t.innerHTML = `<div class="spinner"></div><span>Thinking...</span>`;
        msgDiv.appendChild(t);
      } else if (msg.content) {
        const c = document.createElement('div'); c.className = 'message-content';
        c.innerHTML = safeMarkdown(msg.content);
        enhanceCodeBlocks(c);
        msgDiv.appendChild(c);
      }
      const genFiles = (msg.files || []).filter(f => f.generated && f.public_url);
      genFiles.forEach(f => {
        msgDiv.appendChild(renderGeneratedImageBlock(f));
      });
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

    const hasGenerated = msg.files?.some(f => f.generated);
    const showActions = (msg.role === 'user') || (msg.role === 'assistant' && (msg.content || hasGenerated) && !(state.isGenerating && index === lastIndex && !msg.content && !hasGenerated));

    if (state.editingMessageId !== msg.id && showActions) {
      const ar = document.createElement('div'); ar.className = 'message-actions-row';
      const copy = document.createElement('button'); copy.className = 'icon-button-sm';
      copy.innerHTML = `<i data-lucide="copy" style="width:16px;height:16px;"></i>`; copy.title = 'Copy';
      copy.onclick = async (e) => {
        e.stopPropagation();
        const copyText = msg.content || (hasGenerated ? 'Generated image' : '');
        try { await navigator.clipboard.writeText(copyText); } catch (e) {}
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

          const applyVersion = (newIdx) => {
            v.currentIndex = newIdx;
            msg.content = v.versions[newIdx] || '';
            if (Array.isArray(v.files) && Array.isArray(v.files[newIdx])) {
              msg.files = v.files[newIdx].slice();
            } else {
              msg.files = [];
            }
            const aiMsg = state.messages[index + 1];
            if (aiMsg && aiMsg.role === 'assistant') {
              if (Array.isArray(v.aiReplies) && v.aiReplies[newIdx] !== undefined) {
                aiMsg.content = v.aiReplies[newIdx];
              }
              if (Array.isArray(v.aiFiles) && Array.isArray(v.aiFiles[newIdx])) {
                aiMsg.files = v.aiFiles[newIdx].slice();
              } else {
                aiMsg.files = [];
              }
            }
            renderMessages();
          };

          const prev = document.createElement('button');
          prev.innerHTML = `<i data-lucide="chevron-left" style="width:16px;height:16px;"></i>`;
          prev.disabled = v.currentIndex === 0;
          prev.onclick = () => { if (v.currentIndex > 0) applyVersion(v.currentIndex - 1); };
          vc.appendChild(prev);

          const lbl = document.createElement('span'); lbl.textContent = `${v.currentIndex + 1} / ${v.versions.length}`; vc.appendChild(lbl);

          const next = document.createElement('button');
          next.innerHTML = `<i data-lucide="chevron-right" style="width:16px;height:16px;"></i>`;
          next.disabled = v.currentIndex === v.versions.length - 1;
          next.onclick = () => { if (v.currentIndex < v.versions.length - 1) applyVersion(v.currentIndex + 1); };
          vc.appendChild(next);

          ar.appendChild(vc);
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

        if (!hasGenerated) {
          const regen = document.createElement('button'); regen.className = 'icon-button-sm';
          regen.innerHTML = `<i data-lucide="rotate-ccw" style="width:16px;height:16px;"></i>`; regen.title = 'Regenerate';
          regen.onclick = (e) => { e.stopPropagation(); regenerateMessage(index); };
          ar.appendChild(regen);
        }

        const share = document.createElement('button'); share.className = 'icon-button-sm';
        share.innerHTML = `<i data-lucide="share-2" style="width:16px;height:16px;"></i>`; share.title = 'Share this message';
        share.onclick = (e) => {
          e.stopPropagation();
          shareConversation([{ role: msg.role, content: msg.content, files: msg.files || [] }]);
        };
        ar.appendChild(share);
      }

      row.appendChild(msgDiv); row.appendChild(ar); messageList.appendChild(row);
    } else {
      row.appendChild(msgDiv); messageList.appendChild(row);
    }
  });

  window.refreshIcons();
  smartScroll();
}

function updateStreamingLast(fullContent) {
  const rows = messageList.querySelectorAll('.message-row.assistant');
  const row = rows[rows.length - 1];
  if (!row) { renderMessages(); return; }
  const msgDiv = row.querySelector('.message');
  if (!msgDiv) { renderMessages(); return; }
  const thinking = msgDiv.querySelector('.thinking-indicator');
  if (thinking) thinking.remove();
  let contentDiv = msgDiv.querySelector('.message-content');
  if (!contentDiv) {
    contentDiv = document.createElement('div'); contentDiv.className = 'message-content';
    msgDiv.appendChild(contentDiv);
  }
  contentDiv.innerHTML = safeMarkdown(fullContent);
  enhanceCodeBlocks(contentDiv);
  smartScroll();
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
  state.editingMessageId = msg.id;
  state.editingValue = msg.content;
  state.editingSelection = null;
  renderMessages();
}

function buildGuestPayload(messages) {
  let lastUserId = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserId = messages[i].id; break; }
  }
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .filter(m => m.content && String(m.content).trim().length > 0)
    .map(m => {
      let content = String(m.content);
      if (m.files?.length && m.id !== lastUserId) {
        const names = m.files.map(f => f.filename || 'file').join(', ');
        content = `[User attached: ${names}]\n${content}`;
      }
      return { role: m.role, content };
    });
}

async function syncVersionsToBackend(userMsg, assistantMsg) {
  if (!state.currentUser) return;
  if (!userMsg || !userMsg.id || userMsg.id.startsWith('user_') || userMsg.id.startsWith('assist_') || userMsg.id.startsWith('local_')) return;

  const v = state.messageVersions[userMsg.id];
  const payload = {
    userMessageContent: userMsg.content || '',
    userMessageFiles: Array.isArray(userMsg.files) ? userMsg.files : [],
    versions: v ? v.versions.slice() : [userMsg.content || ''],
    versionFiles: v ? v.files.map(f => Array.isArray(f) ? f.slice() : []) : [],
    aiReplies: v ? v.aiReplies.slice() : (assistantMsg ? [assistantMsg.content || ''] : []),
    aiFiles: v ? v.aiFiles.map(f => Array.isArray(f) ? f.slice() : []) : (assistantMsg && Array.isArray(assistantMsg.files) ? [assistantMsg.files.slice()] : []),
    currentVersionIndex: v ? v.currentIndex : 0,
    assistantContent: assistantMsg ? (assistantMsg.content || '') : '',
    assistantFiles: assistantMsg && Array.isArray(assistantMsg.files) ? assistantMsg.files : [],
  };
  try {
    const res = await apiFetch(`/api/chat/messages/${userMsg.id}/sync-versions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.assistantMessageId && assistantMsg && assistantMsg.id !== data.assistantMessageId) {
      assistantMsg.id = data.assistantMessageId;
    }
  } catch (e) {
    log(`sync-versions failed: ${e.message}`, 'warn');
  }
}

async function sendEditedUserMessage() {
  const chat = state.chats.find(c => c.id === state.activeChatId); if (!chat) return;

  const lastUserMsg = [...state.messages].reverse().find(m => m.role === 'user');

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
    await consumeStream(response, chat, null, {
      skipCloudReload: true,
      onComplete: (finalContent) => {
        if (lastUserMsg && state.messageVersions[lastUserMsg.id]) {
          const v = state.messageVersions[lastUserMsg.id];
          if (!Array.isArray(v.aiReplies)) v.aiReplies = [];
          if (!Array.isArray(v.aiFiles)) v.aiFiles = [];
          v.aiReplies[v.currentIndex] = finalContent || '';
          const uIdx = state.messages.indexOf(lastUserMsg);
          const aMsg = uIdx >= 0 ? state.messages[uIdx + 1] : null;
          if (aMsg && aMsg.role === 'assistant' && Array.isArray(aMsg.files)) {
            v.aiFiles[v.currentIndex] = aMsg.files.slice();
          } else {
            v.aiFiles[v.currentIndex] = [];
          }
        }
      },
    });
  } catch (err) { if (err.name !== 'AbortError') showToast('Error: ' + err.message, true); }
  finally {
    state.isGenerating = false; sendBtn.classList.remove('generating'); sendBtn.disabled = false;
    state.abortController = null; updateSendButton();
  }

  try {
    if (state.currentUser && lastUserMsg) {
      const uIdx = state.messages.indexOf(lastUserMsg);
      const aMsg = uIdx >= 0 ? state.messages[uIdx + 1] : null;
      await syncVersionsToBackend(lastUserMsg, aMsg && aMsg.role === 'assistant' ? aMsg : null);
    }
  } catch (e) { log(`post-edit sync failed: ${e.message}`, 'warn'); }
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
  const ensureLastAssistant = () => {
    let last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'assistant') {
      last = { id: 'assist_' + Date.now().toString(36), role: 'assistant', content: '', files: [], created_at: new Date().toISOString() };
      state.messages.push(last);
      chat.messages = state.messages;
    }
    return last;
  };
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
          const last = ensureLastAssistant();
          last.content = full; chat.messages = state.messages;
          updateStreamingLast(full);
        }
        if (parsed.image) {
          const last = ensureLastAssistant();
          if (!last.files) last.files = [];
          last.files.push({
            filename: `generated-${Date.now()}.jpg`,
            mime_type: 'image/jpeg',
            public_url: parsed.image,
            generated: true,
          });
          renderMessages();
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
    if (typeof opts.onComplete === 'function') {
      try { opts.onComplete(last.content); } catch (e) { log(`onComplete error: ${e.message}`, 'warn'); }
    }
  }
  if (state.currentUser && !opts.skipCloudReload && !chat.id.startsWith('local_')) {
    await reloadAfterSend(chat.id, state.messages.length);
  } else if (!opts.skipCloudReload) {
    renderChatList();
  }
}

// ============================================================
// SHARE — snapshot with version history included
// ============================================================
async function shareConversation(messagesToShare = null, chatId = null) {
  const targetChatId = chatId || state.activeChatId;
  const chat = state.chats.find(c => c.id === targetChatId);

  let rawMessages;
  if (messagesToShare) {
    rawMessages = messagesToShare.slice();
  } else if (chat && targetChatId === state.activeChatId && Array.isArray(state.messages) && state.messages.length > 0) {
    rawMessages = state.messages.slice();
  } else if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
    rawMessages = chat.messages.slice();
  } else if (chat && state.currentUser && !targetChatId.startsWith('local_')) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${targetChatId}/messages`);
      const data = await res.json();
      rawMessages = (data || []).slice();
    } catch (e) { showToast('Failed to load chat: ' + e.message, true); return; }
  } else {
    rawMessages = [];
  }

  const messages = rawMessages.map(m => {
    const base = { role: m.role, content: m.content || '', files: Array.isArray(m.files) ? m.files : [] };
    if (m.role === 'user') {
      const localV = m.id && state.messageVersions[m.id];
      if (localV && Array.isArray(localV.versions) && localV.versions.length > 1) {
        const curIdx = (typeof localV.currentIndex === 'number' && localV.currentIndex >= 0 && localV.currentIndex < localV.versions.length)
          ? localV.currentIndex : 0;
        return {
          role: 'user',
          content: localV.versions[curIdx] || '',
          files: (Array.isArray(localV.files) && Array.isArray(localV.files[curIdx])) ? localV.files[curIdx].slice() : base.files,
          versions: localV.versions.slice(),
          versionFiles: (Array.isArray(localV.files) ? localV.files : []).map(f => Array.isArray(f) ? f.slice() : []),
          aiReplies: (Array.isArray(localV.aiReplies) ? localV.aiReplies : []).slice(),
          aiFiles: (Array.isArray(localV.aiFiles) ? localV.aiFiles : []).map(f => Array.isArray(f) ? f.slice() : []),
          currentVersionIndex: curIdx,
        };
      }
      if (Array.isArray(m.versions) && m.versions.length > 1) {
        const curIdx = (typeof m.current_version_index === 'number' && m.current_version_index >= 0 && m.current_version_index < m.versions.length)
          ? m.current_version_index : 0;
        const sVF = Array.isArray(m.version_files) ? m.version_files : [];
        const sAR = Array.isArray(m.ai_replies) ? m.ai_replies : [];
        const sAF = Array.isArray(m.ai_files) ? m.ai_files : [];
        return {
          role: 'user',
          content: m.versions[curIdx] || '',
          files: Array.isArray(sVF[curIdx]) ? sVF[curIdx].slice() : base.files,
          versions: m.versions.slice(),
          versionFiles: sVF.map(f => Array.isArray(f) ? f.slice() : []),
          aiReplies: sAR.slice(),
          aiFiles: sAF.map(f => Array.isArray(f) ? f.slice() : []),
          currentVersionIndex: curIdx,
        };
      }
    }
    return base;
  }).filter(m =>
    (m.content && String(m.content).trim()) ||
    (Array.isArray(m.files) && m.files.some(f => f.generated && f.public_url)) ||
    (Array.isArray(m.files) && m.files.length > 0)
  );

  if (!messages.length) { showToast('Nothing to share', true); return; }

  try {
    const response = await fetch('/api/share/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });
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
    } else if (a === 'share') { btn.onclick = () => { chatMenu.classList.add('hidden'); shareConversation(null, chatId); }; }
    else if (a === 'rename') { btn.onclick = () => { chatMenu.classList.add('hidden'); renameChat(chatId); }; }
    else if (a === 'delete') { btn.onclick = () => { chatMenu.classList.add('hidden'); deleteChat(chatId); }; }
  });
  window.refreshIcons();
}

document.addEventListener('click', (e) => {
  if (window.innerWidth < 768
      && sidebar.classList.contains('mobile-open')
      && !sidebar.contains(e.target)
      && !openSidebarBtn.contains(e.target)
      && !e.target.closest('#openSidebarBtn')) {
    sidebar.classList.remove('mobile-open');
  }
  if (!chatMenu.contains(e.target) && !e.target.closest('.chat-item .actions')) chatMenu.classList.add('hidden');
});

async function handleNewChat() {
  if (state.activeChatId && state.messages.length === 0 && !state.editingMessageId) {
    messageInput.focus();
    if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
    return;
  }
  const title = 'New Chat';
  let chat;
  if (state.currentUser) chat = await createChat(title);
  else chat = createLocalChat(title);
  if (!chat) return;
  state.activeChatId = chat.id;
  state.messages = []; state.editingMessageId = null; state.messageVersions = {};
  state.attachments = []; state.shouldScrollToBottom = false;
  renderMessages(); renderChatList(); renderAttachments();
  messageInput.focus();
  if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
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
  let isNewlyCreated = false;
  if (!chat) {
    state.messages = [];
    if (state.currentUser) {
      const cloud = await createChat('New Chat');
      if (!cloud) return;
      chat = cloud; state.activeChatId = chat.id; isNewlyCreated = true;
    } else {
      chat = createLocalChat('New Chat');
      state.activeChatId = chat.id; isNewlyCreated = true;
    }
  }

  const isFirstMessage = isNewlyCreated || (chat.title === 'New Chat' || !chat.title);

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

  if (isFirstMessage && !state.currentUser && text) {
    const localChatId = chat.id;
    fetch('/api/chat/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.title) {
          const c = state.chats.find(x => x.id === localChatId);
          if (c) { c.title = d.title; renderChatList(); }
        }
      })
      .catch(() => {});
  }

  try {
    let response;
    if (state.currentUser && !chat.id.startsWith('local_')) {
      const fd = new FormData(); fd.append('message', text || '');
      atts.forEach(f => fd.append('file', f));
      const session = (await state.supabase.auth.getSession()).data.session;
      let token = session?.access_token;
      if (!token) { const { data } = await state.supabase.auth.refreshSession(); token = data.session?.access_token; }
      if (!token) throw new Error('Session expired');
      response = await fetch(`/api/chat/conversations/${chat.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Client-Id': CLIENT_ID },
        body: fd,
        signal: state.abortController.signal,
      });
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
      if (last?.role === 'assistant' && (!last.content || !last.content.trim()) && !(last.files && last.files.length)) {
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

function openAuthModal(mode = 'login') {
  state.forgotPw = { email: null, pendingToken: null, grantedToken: null };
  authModal.classList.remove('hidden');
  renderAuthForm(mode);
}
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
      ${isLogin ? `<div class="toggle-link" id="forgotPwLink" style="margin-top:.5rem;color:var(--accent);">Forgot Password?</div>` : ''}
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
  const forgotPwLink = document.getElementById('forgotPwLink');
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
  if (forgotPwLink) forgotPwLink.onclick = () => renderForgotPasswordForm('email');

  const wireResend = (resendBtn, endpoint, getToken, setToken) => {
    attachCountdown(resendBtn);
    resendBtn.onclick = async () => {
      if (resendBtn.disabled) return;
      const token = getToken();
      if (!token) { errDiv.textContent = 'Your session expired. Please sign in again.'; errDiv.style.display = 'block'; return; }
      statDiv.textContent = 'Resending...'; statDiv.style.display = 'block'; errDiv.style.display = 'none';
      try {
        const rr = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ pendingToken: token }),
        });
        const rd = await rr.json().catch(() => ({}));
        if (!rr.ok) throw new Error(rd.error || `Resend failed (${rr.status})`);
        setToken(rd.pendingToken);
        statDiv.textContent = 'New code sent. Check your email.';
        showToast('New code sent.');
        attachCountdown(resendBtn);
      } catch (e) {
        console.error('[RESEND] Failed:', e);
        errDiv.textContent = e.message || 'Failed to resend code.';
        errDiv.style.display = 'block';
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
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ email, password, fullName }),
        });
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
            const cr = await fetch('/api/auth/confirm-signup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
              body: JSON.stringify({ pendingToken: state.pendingAuth, code }),
            });
            const cd = await cr.json(); if (!cr.ok) throw new Error(cd.error);
            await state.supabase.auth.setSession({ access_token: cd.session.access_token, refresh_token: cd.session.refresh_token });
            state.currentUser = cd.user; state.pendingAuth = null;
            state.lastSessionCheck = Date.now();
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
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ email, password }),
        });
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
            const vr = await fetch('/api/auth/verify-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
              body: JSON.stringify({ pendingToken: state.pendingAuth, code }),
            });
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
                  const t2 = await fetch('/api/auth/2fa/validate-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
                    body: JSON.stringify({ twoFactorToken: state.pendingAuth, code: c2 }),
                  });
                  const t2d = await t2.json(); if (!t2.ok) throw new Error(t2d.error);
                  await state.supabase.auth.setSession({ access_token: t2d.session.access_token, refresh_token: t2d.session.refresh_token });
                  state.currentUser = t2d.user; state.pendingAuth = null;
                  state.lastSessionCheck = Date.now();
                  updateAuthUI(); closeAuthModal(); showToast('Signed in!');
                  await loadCloudConversations();
                } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; }
              };
              return;
            }
            await state.supabase.auth.setSession({ access_token: vd.session.access_token, refresh_token: vd.session.refresh_token });
            state.currentUser = vd.user; state.pendingAuth = null;
            state.lastSessionCheck = Date.now();
            updateAuthUI(); closeAuthModal(); showToast('Signed in!');
            await loadCloudConversations();
          } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; statDiv.style.display = 'none'; }
        };
      } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; statDiv.style.display = 'none'; }
      finally { submitBtn.disabled = false; }
    }
  };
}

function renderForgotPasswordForm(step) {
  const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  const pwIsStrong = (p) => p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);

  if (step === 'email') {
    authModalBody.innerHTML = `
      <h2>Reset Password</h2>
      <div id="fpError" class="error-msg" style="display:none;"></div>
      <div id="fpStatus" class="status-msg" style="display:none;"></div>
      <p style="color:var(--text-muted);font-size:.9rem;margin:.25rem 0 .75rem;">Enter the email you used to register. We'll send a verification code to it.</p>
      <label>Registered Email</label>
      <input type="email" id="fpEmail" placeholder="you@example.com" autocomplete="email" />
      <button class="btn-primary" id="fpSendCodeBtn">Send Code</button>
      <div class="toggle-link" id="fpBackToSignIn" style="margin-top:.5rem;">Back to Sign In</div>`;
    window.refreshIcons();

    const errDiv = document.getElementById('fpError');
    const statDiv = document.getElementById('fpStatus');
    const emailInput = document.getElementById('fpEmail');
    const sendBtn = document.getElementById('fpSendCodeBtn');

    const validate = () => {
      const e = emailInput.value.trim();
      sendBtn.disabled = !(e.includes('@') && e.length >= 5);
    };
    emailInput.addEventListener('input', validate);
    validate();
    setTimeout(() => emailInput.focus(), 50);

    emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendBtn.click(); });

    document.getElementById('fpBackToSignIn').onclick = () => renderAuthForm('login');

    sendBtn.onclick = async () => {
      const email = emailInput.value.trim().toLowerCase();
      errDiv.style.display = 'none'; statDiv.style.display = 'none';
      if (!email) { errDiv.textContent = 'Please enter your email address'; errDiv.style.display = 'block'; return; }
      if (!EMAIL_RE.test(email) || email.includes('..')) { errDiv.textContent = 'Please enter a valid email address'; errDiv.style.display = 'block'; return; }

      statDiv.textContent = 'Checking email...'; statDiv.style.display = 'block';
      sendBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/forgot-password-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404) throw new Error(data.error || 'This email is not registered. Please sign up first.');
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        state.forgotPw.email = data.email || email;
        state.forgotPw.pendingToken = data.pendingToken;
        statDiv.textContent = `Verification code sent to ${state.forgotPw.email}.`;
        setTimeout(() => renderForgotPasswordForm('code'), 300);
      } catch (e) {
        errDiv.textContent = e.message; errDiv.style.display = 'block';
        statDiv.style.display = 'none';
        sendBtn.disabled = false;
      }
    };
  }

  else if (step === 'code') {
    authModalBody.innerHTML = `
      <h2>Enter Verification Code</h2>
      <div id="fpError" class="error-msg" style="display:none;"></div>
      <div id="fpStatus" class="status-msg" style="display:block;">We sent a code to <strong>${state.forgotPw.email}</strong>.</div>
      <label>6-digit code</label>
      <input type="text" id="fpCode" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
      <button class="btn-primary" id="fpVerifyBtn">Verify Code</button>
      <button id="fpResendBtn" class="link-btn" type="button">Resend code</button>
      <div class="toggle-link" id="fpBackToEmail" style="margin-top:.5rem;">Use a different email</div>`;
    window.refreshIcons();

    const errDiv = document.getElementById('fpError');
    const codeInput = document.getElementById('fpCode');
    const verifyBtn = document.getElementById('fpVerifyBtn');
    const resendBtn = document.getElementById('fpResendBtn');

    attachCountdown(resendBtn);
    setTimeout(() => codeInput.focus(), 50);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyBtn.click(); });

    document.getElementById('fpBackToEmail').onclick = () => {
      state.forgotPw = { email: null, pendingToken: null, grantedToken: null };
      renderForgotPasswordForm('email');
    };

    resendBtn.onclick = async () => {
      if (resendBtn.disabled) return;
      if (!state.forgotPw.pendingToken) { errDiv.textContent = 'Your session expired. Please start again.'; errDiv.style.display = 'block'; return; }
      try {
        const r = await fetch('/api/auth/resend-forgot-password-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ pendingToken: state.forgotPw.pendingToken }),
        });
        const rd = await r.json();
        if (!r.ok) throw new Error(rd.error || 'Failed to resend');
        state.forgotPw.pendingToken = rd.pendingToken;
        showToast(rd.email ? `New code sent to ${rd.email}` : 'New code sent.');
        attachCountdown(resendBtn);
      } catch (e) {
        showToast(e.message, true);
        resendBtn.disabled = false;
        if (resendBtn._cdInterval) { clearInterval(resendBtn._cdInterval); resendBtn._cdInterval = null; }
        resendBtn.textContent = 'Resend code';
      }
    };

    verifyBtn.onclick = async () => {
      const code = codeInput.value.trim();
      errDiv.style.display = 'none';
      if (!code || code.length < 6) { errDiv.textContent = 'Enter the 6-digit code'; errDiv.style.display = 'block'; return; }
      verifyBtn.disabled = true;
      try {
        const vr = await fetch('/api/auth/forgot-password-verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ pendingToken: state.forgotPw.pendingToken, code }),
        });
        const vd = await vr.json().catch(() => ({}));
        if (!vr.ok) throw new Error(vd.error || 'Invalid or expired code');
        state.forgotPw.grantedToken = vd.grantedToken;
        renderForgotPasswordForm('password');
      } catch (e) {
        errDiv.textContent = e.message; errDiv.style.display = 'block';
        verifyBtn.disabled = false;
      }
    };
  }

  else if (step === 'password') {
    authModalBody.innerHTML = `
      <h2>Set New Password</h2>
      <div id="fpError" class="error-msg" style="display:none;"></div>
      <p style="color:var(--text-muted);font-size:.9rem;margin:.25rem 0 .75rem;">Choose a new password for <strong>${state.forgotPw.email}</strong>.</p>
      <label>New Password</label>
      <div id="fpNewPwWrap"></div>
      <label>Confirm New Password</label>
      <div id="fpConfirmPwWrap"></div>
      <div id="fpPwLiveStatus" style="font-size:.8rem;margin-top:.3rem;min-height:1.2em;"></div>
      <button class="btn-primary" id="fpResetBtn" disabled>Reset Password</button>
      <div class="toggle-link" id="fpCancelBtn" style="margin-top:.5rem;">Cancel</div>`;
    document.getElementById('fpNewPwWrap').appendChild(createPasswordField('fpNewPw', 'New password'));
    document.getElementById('fpConfirmPwWrap').appendChild(createPasswordField('fpConfirmPw', 'Confirm new password'));
    window.refreshIcons();

    const errDiv = document.getElementById('fpError');
    const newPwInput = document.getElementById('fpNewPw');
    const confirmPwInput = document.getElementById('fpConfirmPw');
    const statusEl = document.getElementById('fpPwLiveStatus');
    const resetBtn = document.getElementById('fpResetBtn');

    const validate = () => {
      const np = newPwInput.value; const cp = confirmPwInput.value;
      if (!np && !cp) { statusEl.textContent = ''; resetBtn.disabled = true; return; }
      if (!pwIsStrong(np)) { statusEl.textContent = 'Password must be 8+ chars with letters and numbers'; statusEl.style.color = 'var(--danger)'; resetBtn.disabled = true; return; }
      if (!cp || np !== cp) { statusEl.textContent = 'Passwords do not match'; statusEl.style.color = 'var(--danger)'; resetBtn.disabled = true; return; }
      statusEl.textContent = '✓ Passwords match'; statusEl.style.color = 'var(--accent)';
      resetBtn.disabled = false;
    };
    newPwInput.addEventListener('input', validate);
    confirmPwInput.addEventListener('input', validate);
    setTimeout(() => newPwInput.focus(), 50);

    document.getElementById('fpCancelBtn').onclick = () => {
      state.forgotPw = { email: null, pendingToken: null, grantedToken: null };
      renderAuthForm('login');
    };

    resetBtn.onclick = async () => {
      const newPassword = newPwInput.value;
      const confirm = confirmPwInput.value;
      errDiv.style.display = 'none';
      if (!pwIsStrong(newPassword)) { errDiv.textContent = 'Password must be 8+ chars with letters and numbers'; errDiv.style.display = 'block'; return; }
      if (newPassword !== confirm) { errDiv.textContent = 'Passwords do not match'; errDiv.style.display = 'block'; return; }
      resetBtn.disabled = true; resetBtn.textContent = 'Resetting...';
      try {
        const rr = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
          body: JSON.stringify({ newPassword, grantedToken: state.forgotPw.grantedToken }),
        });
        const rd = await rr.json().catch(() => ({}));
        if (!rr.ok) throw new Error(rd.error || 'Failed to reset password');
        state.forgotPw = { email: null, pendingToken: null, grantedToken: null };
        showToast('Password reset successfully. You can now sign in.');
        renderAuthForm('login');
      } catch (e) {
        errDiv.textContent = e.message; errDiv.style.display = 'block';
        resetBtn.disabled = false; resetBtn.textContent = 'Reset Password';
      }
    };
  }
}

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
        try { await apiFetch('/api/auth/sessions/current', { method: 'DELETE' }).catch(() => {}); } catch (e) {}
        await state.supabase.auth.signOut();
        state.lastSessionCheck = 0;
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
        const isCurrentRow = (s) => {
          if (s.client_id && s.client_id === CLIENT_ID) return true;
          if (!s.client_id && s.ip === cur.ip && s.user_agent === cur.user_agent) return true;
          return false;
        };
        const otherSessions = all.filter(s => !isCurrentRow(s));
        html = `<h2>Active Sessions</h2>
          <div class="sessions-list">
            <div class="sessions-actions">
              <button class="btn-primary btn-danger sessions-logout-all" id="logoutAllBtn" ${otherSessions.length === 0 ? 'disabled' : ''}>
                <i data-lucide="log-out"></i> Log out all other sessions
              </button>
            </div>
            <h3>This device</h3>
            <p><strong>Email:</strong> ${cur.email || state.currentUser.email}</p>
            <p><strong>Browser:</strong> ${(cur.user_agent || '').substring(0, 80)}</p>
            <p><strong>IP:</strong> ${cur.ip || 'Unknown'}</p>
            <p style="font-size:.8rem;color:var(--text-muted);margin-top:.35rem;">
              To sign out this device, use the <strong>Log out</strong> tab on the left.
            </p>
            <hr />
            <h3>Other active sessions (${otherSessions.length})</h3>
            <div id="sessionsListBody">
            ${otherSessions.length === 0 ? '<p style="color:var(--text-muted);font-size:.85rem;">No other sessions recorded.</p>' : otherSessions.map(s => `
              <div class="session-item" data-session-id="${s.id}">
                <div class="session-info">
                  <p><strong>Device:</strong> ${(s.device || 'Unknown').substring(0, 60)}</p>
                  <p><strong>IP:</strong> ${s.ip || 'Unknown'}</p>
                  <p style="font-size:.8rem;color:var(--text-muted);">Last active: ${new Date(s.last_active || s.created_at).toLocaleString()}</p>
                </div>
                <button class="session-logout-btn" data-session-id="${s.id}" title="Log out this session">
                  <i data-lucide="log-out" style="width:16px;height:16px;"></i>
                  <span>Log out</span>
                </button>
              </div>
            `).join('')}
            </div>
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
        if (!np) { pwLiveStatus.textContent = ''; return; }
        if (!pwIsStrong(np)) { pwLiveStatus.textContent = 'New password must be 8+ chars with letters and numbers'; pwLiveStatus.style.color = 'var(--danger)'; return; }
        if (np === cur) { pwLiveStatus.textContent = 'New password must be different from current password'; pwLiveStatus.style.color = 'var(--danger)'; return; }
        pwLiveStatus.textContent = '✓ Password looks good'; pwLiveStatus.style.color = 'var(--accent)';
      };
      document.getElementById('curPw').addEventListener('input', updatePwLive);
      document.getElementById('newPw').addEventListener('input', updatePwLive);

      let emailPendingToken = null;
      document.getElementById('changeEmailBtn').onclick = async () => {
        const newEmail = document.getElementById('newEmail').value.trim().toLowerCase();
        const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
        const currentEmail = (state.currentUser.email || '').toLowerCase();
        if (!newEmail) { showToast('Please enter the new email address', true); return; }
        if (!EMAIL_RE.test(newEmail) || newEmail.includes('..')) { showToast('Please enter a valid email address', true); return; }
        if (newEmail === currentEmail) { showToast('New email must be different from your current email', true); return; }
        try {
          const res = await apiFetch('/api/auth/send-verification-code', { method: 'POST', body: JSON.stringify({ action: 'change-email', newEmail }) });
          const data = await res.json();
          emailPendingToken = data.pendingToken;
          showToast(`Verification code sent to ${newEmail}`);
          document.getElementById('emailVerify').style.display = 'block';
          const resendBtn = document.getElementById('emailResendBtn');
          attachCountdown(resendBtn);
          resendBtn.onclick = async () => {
            if (resendBtn.disabled) return;
            if (!emailPendingToken) { showToast('Session expired. Try again.', true); return; }
            try {
              const r = await apiFetch('/api/auth/resend-action-code', { method: 'POST', body: JSON.stringify({ pendingToken: emailPendingToken }) });
              const rd = await r.json();
              emailPendingToken = rd.pendingToken;
              showToast(rd.targetEmail ? `New code sent to ${rd.targetEmail}` : 'New code sent.');
              attachCountdown(resendBtn);
            } catch (e) { showToast(e.message, true); resendBtn.disabled = false; resendBtn.textContent = 'Resend code'; if (resendBtn._cdInterval) { clearInterval(resendBtn._cdInterval); resendBtn._cdInterval = null; } }
          };
          document.getElementById('emailVerifyBtn').onclick = async () => {
            const code = document.getElementById('emailCode').value.trim();
            if (!code) { showToast('Enter the code', true); return; }
            try {
              const vr = await apiFetch('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ pendingToken: emailPendingToken, code, action: 'change-email' }) });
              const vd = await vr.json();
              const cr = await apiFetch('/api/auth/change-email', { method: 'POST', body: JSON.stringify({ newEmail, grantedToken: vd.grantedToken }) });
              const cd = await cr.json();
              showToast(`Email changed to ${cd.newEmail || newEmail}.`);
              state.currentUser.email = cd.newEmail || newEmail;
              updateAuthUI();
              close();
            } catch (e) { showToast(e.message, true); }
          };
        } catch (e) { showToast(e.message, true); }
      };

      let pwPendingToken = null;
      document.getElementById('changePwBtn').onclick = async () => {
        const cur = document.getElementById('curPw').value;
        const np = document.getElementById('newPw').value;
        if (!cur || !np) { showToast('Fill both fields', true); return; }
        if (!pwIsStrong(np)) { showToast('New password must be 8+ chars with letters and numbers', true); return; }
        if (np === cur) { showToast('New password must be different from current password', true); return; }
        try {
          const vres = await apiFetch('/api/auth/verify-current-password', { method: 'POST', body: JSON.stringify({ password: cur }) });
          const vd = await vres.json();
          if (!vd.valid) throw new Error('Current password is incorrect');
        } catch (e) { showToast(e.message || 'Current password is incorrect', true); return; }
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
            if (!pwPendingToken) { showToast('Session expired. Try again.', true); return; }
            try {
              const r = await apiFetch('/api/auth/resend-action-code', { method: 'POST', body: JSON.stringify({ pendingToken: pwPendingToken }) });
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
            if (!delPendingToken) { showToast('Session expired. Try again.', true); return; }
            try {
              const r = await apiFetch('/api/auth/resend-action-code', { method: 'POST', body: JSON.stringify({ pendingToken: delPendingToken }) });
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
          document.getElementById('copySecretBtn').onclick = () => { navigator.clipboard.writeText(d.secret).then(() => showToast('Secret copied!')); };
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

    if (id === 'sessions') {
      document.getElementById('logoutAllBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('logoutAllBtn');
        if (btn && btn.disabled) return;
        const ok = await showCustomModal(
          'Log out all other sessions',
          'This will sign out every device except this one. You may need to sign in again on those devices. Continue?',
          'Log out all others', 'Cancel', true
        );
        if (!ok) return;
        if (btn) { btn.disabled = true; btn.innerHTML = 'Logging out…'; }
        try {
          const r = await apiFetch('/api/auth/sessions/all', { method: 'DELETE' });
          const d = await r.json();
          showToast(d.removed > 0 ? `Logged out ${d.removed} session${d.removed === 1 ? '' : 's'}` : 'No other sessions to log out');
          render('sessions');
        } catch (e) {
          showToast('Failed: ' + e.message, true);
          if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="log-out"></i> Log out all other sessions'; window.refreshIcons(); }
        }
      });

      content.querySelectorAll('.session-logout-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sid = btn.dataset.sessionId;
          if (!sid) return;
          const ok = await showCustomModal(
            'Log out this session',
            'This device will be signed out. Continue?',
            'Log out', 'Cancel', true
          );
          if (!ok) return;
          btn.disabled = true; btn.innerHTML = 'Logging out…';
          try {
            await apiFetch(`/api/auth/sessions/${sid}`, { method: 'DELETE' });
            showToast('Session logged out');
            render('sessions');
          } catch (e) {
            showToast('Failed: ' + e.message, true);
            btn.disabled = false; btn.innerHTML = '<i data-lucide="log-out" style="width:16px;height:16px;"></i><span>Log out</span>';
            window.refreshIcons();
          }
        });
      });
    }
  };
  tabs.forEach(t => t.onclick = () => render(t.dataset.tab));
  render('profile');
}

attachBtn.onclick = () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,.pdf,.txt,.doc,.docx'; input.multiple = true;
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

newChatBtn.onclick = handleNewChat;
sendBtn.onclick = () => { if (state.isGenerating) stopGeneration(); else sendMessage(); };
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!state.isGenerating) sendMessage(); }
});
messageInput.addEventListener('input', () => { resizeComposer(); updateSendButton(); });
chips.forEach(c => c.onclick = () => { messageInput.value = c.dataset.prompt; updateSendButton(); sendMessage(); });
document.getElementById('shareModalClose').onclick = () => shareModal.classList.add('hidden');
shareModal.onclick = (e) => { if (e.target === shareModal) shareModal.classList.add('hidden'); };

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verifySessionValidity();
});
window.addEventListener('focus', () => { verifySessionValidity(); });
window.addEventListener('online', () => { verifySessionValidity(true); });
setInterval(() => {
  if (document.visibilityState === 'visible') verifySessionValidity();
}, 60000);

(async function init() {
  try {
    await initSupabase();
    updateSendButton();
    resizeComposer();
  } catch (e) { log(`Init error: ${e.message}`, 'error'); }
})();
