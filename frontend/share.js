(async function () {
  const statusEl = document.getElementById('shareStatus');
  const listEl = document.getElementById('shareMessages');
  const path = window.location.pathname;
  const token = path.replace(/^\/share\//, '').split('/')[0].split('?')[0];

  if (!token) {
    statusEl.textContent = 'Invalid share link.';
    statusEl.classList.add('error');
    return;
  }

  function safeMd(text) {
    try { return (window.marked?.parse(text || '') || '').replace(/<hr\s*\/?>/g, ''); }
    catch (e) { return String(text || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
  }

  try {
    const res = await fetch('/api/share/' + encodeURIComponent(token), { cache: 'no-store' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + res.status));
    }
    const data = await res.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (!messages.length) {
      statusEl.textContent = 'This shared chat is empty.';
      return;
    }

    statusEl.style.display = 'none';
    messages.forEach(function (msg) {
      if (!msg || !msg.role) return;
      const row = document.createElement('div');
      row.className = 'msg-row ' + msg.role;
      if (msg.role === 'assistant') {
        const h = document.createElement('div');
        h.className = 'msg-header';
        h.innerHTML = '<img src="/logo.png" alt="" /><span>agrideepai</span>';
        row.appendChild(h);
      }
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble ' + msg.role;
      const content = msg.content == null ? '' : String(msg.content);
      if (msg.role === 'assistant') {
        bubble.innerHTML = safeMd(content);
      } else {
        bubble.textContent = content;
      }
      row.appendChild(bubble);
      listEl.appendChild(row);
    });
    document.title = 'Shared Chat — AgriDeepAI';
  } catch (err) {
    statusEl.textContent = 'Unable to load this shared chat: ' + (err.message || 'unknown error');
    statusEl.classList.add('error');
  }
})();
