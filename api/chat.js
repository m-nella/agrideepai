// ==========================================================
// AgriDeepAI Backend — Full API with Supabase + Brevo
// ==========================================================

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ------------------------------
// 1. SUPABASE CLIENT
// ------------------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

if (!supabase) {
  console.warn('⚠️ Supabase not configured. Auth will fail.');
}

// ------------------------------
// 2. BREVO CONFIG
// ------------------------------
const brevoApiKey = process.env.BREVO_API_KEY;
const emailFrom = process.env.EMAIL_FROM || 'mutuyimanaornella00@gmail.com';

// Helper: email validation
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Helper: generate 6‑digit code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper: send verification email via Brevo (always throws on error)
async function sendVerificationEmail(email, code) {
  if (!brevoApiKey) throw new Error('BREVO_API_KEY is not set');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Added User-Agent to avoid Brevo browser detection issues
      'User-Agent': 'AgriDeepAI-Backend/2.0',
    },
    body: JSON.stringify({
      sender: { email: emailFrom, name: 'AgriDeepAI' },
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
    let errorMsg = `Brevo API error: ${response.status} ${response.statusText}`;
    try {
      const text = await response.text();
      const json = JSON.parse(text);
      if (json.message) errorMsg = json.message;
    } catch (e) {
      // fallback
    }
    throw new Error(errorMsg);
  }
  return true;
}

// ==========================================================
// ROUTER (global try-catch ensures JSON)
// ==========================================================
export default async function handler(req, res) {
  // CORS
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
    if (req.method === 'POST' && path === '/api/chat') {
      return handleChat(req, res);
    }
    if (req.method === 'POST' && path === '/api/auth/signup') {
      return handleSignup(req, res);
    }
    if (req.method === 'POST' && path === '/api/auth/login') {
      return handleLoginRequest(req, res);
    }
    if (req.method === 'POST' && path === '/api/auth/verify-login') {
      return handleVerifyLogin(req, res);
    }
    if (req.method === 'GET' && path === '/api/conversations') {
      return handleGetConversations(req, res);
    }
    if (req.method === 'POST' && path === '/api/conversations') {
      return handleSaveConversations(req, res);
    }
    if (req.method === 'POST' && path === '/api/send-verification') {
      return handleSendVerification(req, res);
    }
    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// ==========================================================
// HANDLERS (all return JSON)
// ==========================================================

// ----- CHAT (placeholder – replace with your real AI) -----
async function handleChat(req, res) {
  // Temporary dummy response
  res.status(200).json({ response: 'AI response placeholder – replace with your Groq/Gemini logic' });
}

// ----- SIGNUP -----
async function handleSignup(req, res) {
  const { email, password, name, verificationCode } = req.body;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (!verificationCode) return res.status(400).json({ error: 'Verification code required' });

  // Verify code from Supabase
  const { data, error } = await supabase
    .from('verification_codes')
    .select('code, expiry')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) {
    return res.status(400).json({ error: 'No verification code found. Please request a new code.' });
  }
  if (data.code !== verificationCode) {
    return res.status(400).json({ error: 'Invalid verification code' });
  }
  if (new Date(data.expiry) < new Date()) {
    return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
  }

  // Hash password
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  // Insert user
  const { data: userData, error: userError } = await supabase
    .from('users')
    .insert([{ email, name, password_hash: passwordHash }])
    .select('id, email, name');

  if (userError) {
    if (userError.code === '23505') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    console.error('Supabase insert error:', userError);
    return res.status(500).json({ error: 'Database error' });
  }

  // Delete used code
  await supabase.from('verification_codes').delete().eq('email', email);

  const user = userData[0];
  const sessionToken = crypto.randomUUID();
  return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name }, sessionToken });
}

// ----- LOGIN REQUEST (send code) -----
async function handleLoginRequest(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

  // Find user
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, password_hash')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  // Verify password
  const valid = bcrypt.compareSync(password, data.password_hash);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  // Generate and store code
  const code = generateCode();
  const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabase
    .from('verification_codes')
    .upsert({ email, code, expiry, user_id: data.id }, { onConflict: 'email' });

  // Send email
  try {
    await sendVerificationEmail(email, code);
  } catch (err) {
    console.error('Brevo error:', err.message);
    return res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }

  return res.status(200).json({ message: 'Verification code sent', userId: data.id });
}

// ----- VERIFY LOGIN -----
async function handleVerifyLogin(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

  const { data, error } = await supabase
    .from('verification_codes')
    .select('code, expiry, user_id')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) {
    return res.status(400).json({ error: 'No verification code found. Please request a new code.' });
  }
  if (data.code !== code) {
    return res.status(400).json({ error: 'Invalid verification code' });
  }
  if (new Date(data.expiry) < new Date()) {
    return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
  }

  // Get user
  const { data: userData } = await supabase
    .from('users')
    .select('id, email, name')
    .eq('id', data.user_id)
    .maybeSingle();

  if (!userData) {
    return res.status(400).json({ error: 'User not found' });
  }

  // Delete used code
  await supabase.from('verification_codes').delete().eq('email', email);

  const sessionToken = crypto.randomUUID();
  return res.status(200).json({ user: userData, sessionToken });
}

// ----- SEND VERIFICATION (legacy, used for sign-up) -----
async function handleSendVerification(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

  // Store code in Supabase
  const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabase
    .from('verification_codes')
    .upsert({ email, code, expiry }, { onConflict: 'email' });

  // Send email
  try {
    await sendVerificationEmail(email, code);
  } catch (err) {
    console.error('Brevo error:', err.message);
    return res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }

  return res.status(200).json({ success: true });
}

// ----- GET CONVERSATIONS -----
async function handleGetConversations(req, res) {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('Fetch conversations error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ conversations: data || [] });
}

// ----- SAVE CONVERSATIONS -----
async function handleSaveConversations(req, res) {
  const { userId, conversations } = req.body;
  if (!userId || !conversations) return res.status(400).json({ error: 'userId and conversations required' });
  for (const conv of conversations) {
    const { id, title, messages, pinned, updatedAt } = conv;
    const { error } = await supabase
      .from('conversations')
      .upsert({
        id,
        user_id: userId,
        title,
        messages,
        pinned: pinned || false,
        updated_at: updatedAt || new Date().toISOString(),
      }, { onConflict: 'id' });
    if (error) {
      console.error('Upsert conversation error:', error);
      return res.status(500).json({ error: 'Failed to save conversation' });
    }
  }
  return res.status(200).json({ success: true });
}
