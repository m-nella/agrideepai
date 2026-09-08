// ============================================================
// AGRIDEEPAI – Full Frontend (with password confirmation + status)
// ============================================================

// --- Logging helper ---
const log = (msg, type = 'info') => {
  const timestamp = new Date().toISOString();
  console.log(`[FRONTEND] [${timestamp}] [${type.toUpperCase()}] ${msg}`);
};

// --- DOM refs (same as before) ---
// ... (all DOM refs remain unchanged)

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
  editingContent: '',
  likedMessages: new Set(),
  dislikedMessages: new Set(),
  contextMenuTarget: null,
};

// --- Supabase init (same as before) ---
// ... (keep the same)

// --- Auth UI (same) ---
// ...

// --- API helper (same) ---
// ...

// --- Local storage (same) ---
// ...

// --- Render functions (same) ---
// ...

// ======================== UPDATED AUTH MODAL ========================

function renderAuthForm(mode) {
  const isLogin = mode === 'login';
  authModalBody.innerHTML = `
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div id="authError" class="error-msg" style="display:none;"></div>
    <div id="authStatus" class="status-msg" style="display:none;"></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@example.com" />
    <label>Password</label>
    <input type="password" id="authPassword" placeholder="••••••••" />
    ${!isLogin ? `
      <label>Confirm Password</label>
      <input type="password" id="authConfirmPassword" placeholder="Confirm password" />
    ` : ''}
    ${!isLogin ? `<label>Full Name (optional)</label><input type="text" id="authFullName" placeholder="Your name" />` : ''}
    <button class="btn-primary" id="authSubmitBtn" disabled>${isLogin ? 'Sign In' : 'Sign Up'}</button>
    <div class="toggle-link" id="authToggle">${isLogin ? 'Create an account' : 'Already have an account? Sign in'}</div>
    ${!isLogin ? `<div id="verifySection" style="display:none; margin-top:1rem;">
      <p>We sent a verification code to your email. Enter it below:</p>
      <input type="text" id="verifyCode" placeholder="6-digit code" />
      <button class="btn-primary" id="verifyBtn">Verify</button>
      <button id="resendVerifyBtn" style="background:none;border:none;color:var(--accent);cursor:pointer;margin-top:0.5rem;">Resend code</button>
    </div>` : ''}
  `;

  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleLink = document.getElementById('authToggle');
  const errorDiv = document.getElementById('authError');
  const statusDiv = document.getElementById('authStatus');

  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmInput = document.getElementById('authConfirmPassword');

  function checkFields() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    let valid = email && password;
    if (!isLogin) {
      const confirm = confirmInput.value;
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

  submitBtn.addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const confirm = document.getElementById('authConfirmPassword')?.value || '';
    errorDiv.style.display = 'none';
    statusDiv.style.display = 'none';
    if (!email || !password) {
      errorDiv.textContent = 'Email and password required.';
      errorDiv.style.display = 'block';
      return;
    }
    if (!isLogin && password !== confirm) {
      errorDiv.textContent = 'Passwords do not match.';
      errorDiv.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    statusDiv.textContent = isLogin ? 'Signing in...' : 'Creating account...';
    statusDiv.style.display = 'block';
    try {
      if (isLogin) {
        const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        closeAuthModal();
        showToast('Signed in successfully!');
      } else {
        const fullName = document.getElementById('authFullName')?.value.trim() || email.split('@')[0];
        const { data, error } = await state.supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        document.getElementById('verifySection').style.display = 'block';
        submitBtn.disabled = true;
        statusDiv.textContent = 'Verification code sent. Please check your email.';
        statusDiv.style.display = 'block';
        const userId = data.user.id;
        document.getElementById('verifyBtn').addEventListener('click', async () => {
          const code = document.getElementById('verifyCode').value.trim();
          if (!code) {
            errorDiv.textContent = 'Enter the code';
            errorDiv.style.display = 'block';
            return;
          }
          statusDiv.textContent = 'Verifying email...';
          statusDiv.style.display = 'block';
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, code }),
          });
          const result = await res.json();
          if (res.ok) {
            showToast('Email verified! You can now sign in.');
            closeAuthModal();
            renderAuthForm('login');
          } else {
            errorDiv.textContent = result.error || 'Verification failed';
            errorDiv.style.display = 'block';
            statusDiv.style.display = 'none';
          }
        });
        document.getElementById('resendVerifyBtn').addEventListener('click', async () => {
          statusDiv.textContent = 'Sending new code...';
          statusDiv.style.display = 'block';
          const res = await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          if (res.ok) {
            showToast('New code sent');
            statusDiv.textContent = 'New code sent. Check your email.';
          } else {
            const err = await res.json();
            showToast(err.error || 'Failed to resend', true);
          }
        });
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Authentication failed';
      errorDiv.style.display = 'block';
      statusDiv.style.display = 'none';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// --- Rest of the file (sendMessage, render, etc.) remains exactly as before ---
// (No changes needed to those functions)
