// --- DOM refs ---
const messageList = document.getElementById('messageList');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const themeToggle = document.getElementById('themeToggle');
const authBtn = document.getElementById('authBtn');
const attachBtn = document.getElementById('attachBtn');
const chips = document.querySelectorAll('.chip');

// --- State (localStorage for now) ---
let messages = JSON.parse(localStorage.getItem('agrideep_messages')) || [];
let isDark = localStorage.getItem('agrideep_theme') === 'dark';

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
  messages.forEach((msg, i) => {
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

function addMessage(role, content) {
  messages.push({ role, content });
  saveMessages();
  renderMessages();
}

// --- Send message (local echo for Phase 0) ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  // Add user message
  addMessage('user', text);
  messageInput.value = '';
  // Simulate AI response (will be replaced later)
  setTimeout(() => {
    addMessage('assistant', 'Thank you for your question. I am AgriDeepAI, your agricultural assistant. (This is a local demo. Real AI integration comes in Phase 2.)');
  }, 500);
}

// --- Event listeners ---
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
// Auto-resize textarea
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

// Auth button (placeholder)
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
