// --- DOM refs ---
const messageList = document.getElementById('messageList');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const themeToggle = document.getElementById('themeToggle');
const authBtn = document.getElementById('authBtn');
const attachBtn = document.getElementById('attachBtn');
const chips = document.querySelectorAll('.chip');

// --- State ---
let messages = JSON.parse(localStorage.getItem('agrideep_messages')) || [];
let isDark = localStorage.getItem('agrideep_theme') === 'dark';
let isGenerating = false;

// --- UI helpers ---
function renderMessages() {
  messageList.innerHTML = '';
  if (messages.length === 0) {
    welcomeScreen.style.display = 'flex';
    messageList.style.display = 'none';
    return;
  }
  welcomeScreen.style.display = 'none';
  messageList.style.display = 'flex';
  messages.forEach((msg) => {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    div.textContent = msg.content;
    messageList.appendChild(div);
  });
  messageList.scrollTop = messageList.scrollHeight;
}

function saveMessages() {
  localStorage.setItem('agrideep_messages', JSON.stringify(messages));
}

function addMessage(role, content, save = true) {
  messages.push({ role, content });
  if (save) saveMessages();
  renderMessages();
}

// Update the last assistant message (used during streaming)
function updateLastAssistantMessage(content) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant') {
    last.content = content;
  } else {
    messages.push({ role: 'assistant', content });
  }
  saveMessages();
  renderMessages();
}

// --- Send message to backend ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isGenerating) return;

  // Add user message
  addMessage('user', text);
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Prepare history for API (all messages except the one we just added? Actually we need the full history)
  // We'll send the entire messages array (including the new user message) to the backend.
  const payload = { messages: messages.map(m => ({ role: m.role, content: m.content })) };

  isGenerating = true;
  sendBtn.textContent = '⏹'; // change to stop (we'll implement stop later)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessage = '';

    // Add a placeholder assistant message
    messages.push({ role: 'assistant', content: '' });
    renderMessages();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            // finalize
            break;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              assistantMessage += parsed.text;
              updateLastAssistantMessage(assistantMessage);
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    }
    // Ensure message is saved
    saveMessages();
  } catch (err) {
    console.error(err);
    // Remove the placeholder assistant message if error
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content === '') {
      messages.pop();
      saveMessages();
      renderMessages();
    }
    alert('Error: ' + err.message);
  } finally {
    isGenerating = false;
    sendBtn.textContent = '➤';
  }
}

// --- Event listeners ---
sendBtn.addEventListener('click', sendMessage);
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

// Theme toggle
themeToggle.addEventListener('click', () => {
  isDark = !isDark;
  document.body.classList.toggle('dark', isDark);
  localStorage.setItem('agrideep_theme', isDark ? 'dark' : 'light');
  themeToggle.textContent = isDark ? '☀️' : '🌓';
});

// Auth button placeholder
authBtn.addEventListener('click', () => {
  alert('Authentication will be added in Phase 3.\nFor now, you can chat as a guest.');
});

// Attach button placeholder
attachBtn.addEventListener('click', () => {
  alert('File uploads will be added in Phase 5.');
});

// --- Initialize ---
if (isDark) {
  document.body.classList.add('dark');
  themeToggle.textContent = '☀️';
}
renderMessages();
