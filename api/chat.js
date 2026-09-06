// ==========================================================
// AgriDeepAI Backend — Single handler for all API routes
// ==========================================================

import crypto from 'crypto';

// In-memory storage
const codeStore = {};
const userStore = {};
const conversationStore = {};

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'mutuyimanaornella00@gmail.com';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const computed = crypto.createHash('sha256').update(salt + password).digest('hex');
  return computed === hash;
}

async function sendVerificationEmail(email, code) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'AgriDeepAI/2.0',
    },
    body: JSON.stringify({
      sender: { email: EMAIL_FROM, name: 'AgriDeepAI' },
      to: [{ email }],
      subject: 'AgriDeepAI — Your Verification Code',
      htmlContent: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0c0d; color: #ececf0; padding: 40px 20px; }
          .container { max-width: 500px; margin: 0 auto; background: #141416; border-radius: 12px; padding: 40px; border: 1px solid #262628; }
          .logo { text-align: center; margin-bottom: 16px; }
          .logo img { width: 60px; height: 60px; border-radius: 12px; }
          h1 { color: #2b7d4b; font-size: 28px; margin: 0 0 8px 0; text-align: center; }
          .subtitle { color: #9a9aa2; font-size: 16px; margin: 0 0 24px 0; text-align: center; }
          .code-box { background: #1a1a1c; border: 1px solid #2b7d4b; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
          .code { font-size: 36px; letter-spacing: 8px; color: #ececf0; font-weight: 700; }
          .expiry { color: #5c5c62; font-size: 14px; margin-top: 16px; }
          .footer { border-top: 1px solid #262628; padding-top: 20px; margin-top: 24px; color: #5c5c62; font-size: 13px; text-align: center; }
        </style></head>
        <body>
          <div class="container">
            <div class="logo"><img src="https://agrideepai.vercel.app/logo.png" alt="AgriDeepAI Logo" /></div>
            <h1>AgriDeepAI</h1>
            <p class="subtitle">Your verification code</p>
            <div class="code-box"><div class="code">${code}</div></div>
            <p style="color:#9a9aa2; text-align:center;">Enter this code to verify your email address.</p>
            <p class="expiry">⏱ This code expires in <strong>5 minutes</strong>.</p>
            <div class="footer">If you didn't request this, please ignore this email.<br>&copy; AgriDeepAI — Your AI assistant for agriculture &amp; livestock</div>
          </div>
        </body>
        </html>
      `,
    }),
  });
  if (!response.ok) {
    let msg = `Brevo error: ${response.status}`;
    try {
      const text = await response.text();
      const json = JSON.parse(text);
      if (json.message) msg = json.message;
    } catch (e) {}
    throw new Error(msg);
  }
  return true;
}

// ==========================================================
// Main handler
// ==========================================================
export default async function handler(req, res) {
  // Always JSON
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // ---- SEND VERIFICATION (sign-up flow) ----
    if (req.method === 'POST' && path === '/api/send-verification') {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
      codeStore[email] = { code, expiry: Date.now() + 5 * 60 * 1000 };
      try {
        await sendVerificationEmail(email, code);
        return res.status(200).json({ success: true, message: 'Verification code sent' });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to send email: ' + err.message });
      }
    }

    // ---- SIGNUP ----
    if (req.method === 'POST' && path === '/api/auth/signup') {
      const { email, password, name, verificationCode } = req.body;
      if (!email || !password || !name || !verificationCode) {
        return res.status(400).json({ error: 'All fields required' });
      }
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
      const stored = codeStore[email];
      if (!stored) return res.status(400).json({ error: 'No code found. Please request a new code.' });
      if (stored.code !== verificationCode) return res.status(400).json({ error: 'Invalid verification code' });
      if (stored.expiry < Date.now()) return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
      if (userStore[email]) return res.status(400).json({ error: 'Email already registered' });
      const { salt, hash } = hashPassword(password);
      const userId = generateId();
      userStore[email] = { id: userId, email, name, passwordHash: hash, salt };
      delete codeStore[email];
      const sessionToken = crypto.randomBytes(32).toString('hex');
      return res.status(200).json({ user: { id: userId, email, name }, sessionToken });
    }

    // ---- LOGIN (send code) ----
    if (req.method === 'POST' && path === '/api/auth/login') {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
      const user = userStore[email];
      if (!user) return res.status(400).json({ error: 'Invalid email or password' });
      if (!verifyPassword(password, user.salt, user.passwordHash)) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }
      const code = generateCode();
      codeStore[email] = { code, expiry: Date.now() + 5 * 60 * 1000, userId: user.id };
      try {
        await sendVerificationEmail(email, code);
        return res.status(200).json({ message: 'Verification code sent', userId: user.id });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to send email: ' + err.message });
      }
    }

    // ---- VERIFY LOGIN ----
    if (req.method === 'POST' && path === '/api/auth/verify-login') {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
      const stored = codeStore[email];
      if (!stored) return res.status(400).json({ error: 'No code found. Please request a new code.' });
      if (stored.code !== code) return res.status(400).json({ error: 'Invalid verification code' });
      if (stored.expiry < Date.now()) return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
      const user = userStore[email];
      if (!user) return res.status(400).json({ error: 'User not found' });
      delete codeStore[email];
      const sessionToken = crypto.randomBytes(32).toString('hex');
      return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name }, sessionToken });
    }

    // ---- CONVERSATIONS ----
    if (req.method === 'GET' && path === '/api/conversations') {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      return res.status(200).json({ conversations: conversationStore[userId] || [] });
    }
    if (req.method === 'POST' && path === '/api/conversations') {
      const { userId, conversations } = req.body;
      if (!userId || !conversations) return res.status(400).json({ error: 'userId and conversations required' });
      conversationStore[userId] = conversations;
      return res.status(200).json({ success: true });
    }

    // ---- CHAT (placeholder) ----
    if (req.method === 'POST' && path === '/api/chat') {
      return res.status(200).json({ response: 'AI placeholder – replace with your Groq/Gemini logic' });
    }

    // ---- 404 ----
    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Handler error:', error.message);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
