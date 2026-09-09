// ============================================================
// AGRIDEEPAI – Full Frontend (Final)
// ============================================================

const log = (msg, type = 'info') => {
  const timestamp = new Date().toISOString();
  console.log(`[FRONTEND] [${timestamp}] [${type.toUpperCase()}] ${msg}`);
};

// --- DOM refs (same as before) ---
// ... (unchanged) ...

// --- State (unchanged) ---
// ... (unchanged) ...

// --- Custom Modal helpers (unchanged) ---
// ... (unchanged) ...

// --- Clean content, Supabase init, etc. (unchanged) ---
// ... (unchanged) ...

// --- Auth Modal render (updated) ---
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
      <button class="btn-primary" id="verifyBtn">Verify & Create Account</button>
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
      // Signup intent
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
        // Show verification section
        verifySection.style.display = 'block';
        statusDiv.textContent = 'Verification code sent. Check your email.';
        // Store email for later use
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
            // Success – user created and logged in
            state.currentUser = confirmData.user;
            // Update supabase auth state? We can set session manually
            // Instead, we'll just update UI and close modal.
            updateAuthUI();
            closeAuthModal();
            showToast('Account created and verified! You are now signed in.');
            // Reload conversations (now authenticated)
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
        const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
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

// ... (rest of the frontend code remains unchanged: account modal, sendMessage, etc.) ...
