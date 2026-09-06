// ==========================================================
// AgriDeepAI Backend — Full API with Supabase + Brevo
// ==========================================================

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Brevo config
const brevoApiKey = process.env.BREVO_API_KEY;
const emailFrom = process.env.EMAIL_FROM || 'noreply@agrideepai.agentdomains.co';

// Helper: send verification email via Brevo
async function sendVerificationEmail(email, code) {
  if (!brevoApiKey) throw new Error('BREVO_API_KEY not set');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
    const text = await response.text();
    throw new Error(`Brevo error: ${text}`);
  }
  return true;
}

// Generate a 6-digit code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ------------------------------
// MAIN HANDLER
// ------------------------------
export default async function handler(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const segments = pathname.split('/').filter(Boolean);

  // Route: /api/chat -> AI chat
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'chat') {
    return handleChat(req, res);
  }

  // Route: /api/auth/signup -> create account (after code verification)
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'auth' && segments[2] === 'signup') {
    return handleSignup(req, res);
  }

  // Route: /api/auth/login -> initiate login (send code)
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'auth' && segments[2] === 'login') {
    return handleLoginRequest(req, res);
  }

  // Route: /api/auth/verify-login -> confirm login with code
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'auth' && segments[2] === 'verify-login') {
    return handleVerifyLogin(req, res);
  }

  // Route: /api/conversations -> get/save conversations
  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'conversations') {
    return handleGetConversations(req, res);
  }
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'conversations') {
    return handleSaveConversations(req, res);
  }

  // Fallback: /api/send-verification (old endpoint) -> redirect to signup
  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'send-verification') {
    return handleSendVerification(req, res);
  }

  // 404
  res.status(404).json({ error: 'Not found' });
}

// ==========================================================
// HANDLER: Chat
// ==========================================================
async function handleChat(req, res) {
  try {
    const { message, history, model, temperature, webSearchEnabled, files, userId } = req.body;

    if (!message && !files) {
      return res.status(400).json({ error: 'Message or files required' });
    }

    // ... (your existing AI logic remains unchanged)
    // We'll keep the same system prompt and AI calling functions as before
    // (I'll omit them for brevity, but you must keep the full AI code from earlier)

    // For brevity, I'll assume you have the AI functions from previous versions.
    // We'll just return a dummy response for demonstration; in reality you keep your AI code.
    const response = await callAI(getSystemPrompt(), message, history, model, temperature, files);
    return res.status(200).json({ response, searchUsed: false, fileProcessed: false });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// HANDLER: Signup (after verification code)
// ==========================================================
async function handleSignup(req, res) {
  try {
    const { email, password, name, code, verificationCode } = req.body;

    // Verify the code matches the one stored (we'll store in a temporary cache, but for simplicity we assume frontend passes the code and we verify it)
    // We'll use a simple in-memory store for now – in production use Redis.
    if (!global.verificationCodes) global.verificationCodes = {};
    const stored = global.verificationCodes[email];
    if (!stored || stored.code !== verificationCode || Date.now() > stored.expiry) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    // Insert user into Supabase
    const { data, error } = await supabase
      .from('users')
      .insert([{ email, name, password_hash: passwordHash }])
      .select('id, email, name');

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Email already registered' });
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    const user = data[0];
    // Remove the code from store
    delete global.verificationCodes[email];

    // Generate a session token (JWT) – we'll use a simple UUID for demo
    const sessionToken = crypto.randomUUID();
    // Store session (in production use Supabase sessions or JWT)
    // For now, return user and token
    return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name }, sessionToken });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// HANDLER: Login request (send verification code)
// ==========================================================
async function handleLoginRequest(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Find user in Supabase
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, password_hash')
      .eq('email', email)
      .maybeSingle();

    if (error || !data) return res.status(400).json({ error: 'Invalid email or password' });

    // Verify password
    const valid = bcrypt.compareSync(password, data.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    // Generate and send verification code
    const code = generateCode();
    // Store in memory with expiry
    if (!global.verificationCodes) global.verificationCodes = {};
    global.verificationCodes[email] = { code, expiry: Date.now() + 5 * 60 * 1000, userId: data.id };

    await sendVerificationEmail(email, code);

    return res.status(200).json({ message: 'Verification code sent', userId: data.id });
  } catch (error) {
    console.error('Login request error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// HANDLER: Verify login (confirm code)
// ==========================================================
async function handleVerifyLogin(req, res) {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const stored = global.verificationCodes?.[email];
    if (!stored || stored.code !== code || Date.now() > stored.expiry) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Get user data
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', stored.userId)
      .maybeSingle();

    if (error || !data) return res.status(400).json({ error: 'User not found' });

    // Generate session token
    const sessionToken = crypto.randomUUID();
    delete global.verificationCodes[email];

    return res.status(200).json({ user: data, sessionToken });
  } catch (error) {
    console.error('Verify login error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// HANDLER: Get conversations
// ==========================================================
async function handleGetConversations(req, res) {
  try {
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
  } catch (error) {
    console.error('Get conv error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// HANDLER: Save conversations
// ==========================================================
async function handleSaveConversations(req, res) {
  try {
    const { userId, conversations } = req.body;
    if (!userId || !conversations) return res.status(400).json({ error: 'userId and conversations required' });

    // For simplicity, we upsert each conversation
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
  } catch (error) {
    console.error('Save conv error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// HANDLER: Send verification (old endpoint, kept for compatibility)
// ==========================================================
async function handleSendVerification(req, res) {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
    await sendVerificationEmail(email, code);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Send verification error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==========================================================
// (Include your existing AI functions: getSystemPrompt, callAI, etc.)
// ==========================================================
// For brevity, I'm not duplicating the large AI code here.
// You must copy your full AI functions (from earlier versions) into this file.
// The functions should be: getSystemPrompt(), callAI(), shouldPerformWebSearch(), performSerperSearch(), performTavilySearch().
