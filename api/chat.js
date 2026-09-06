const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ─── Environment ──────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const brevoApiKey = process.env.BREVO_API_KEY;
const emailFrom = process.env.EMAIL_FROM || 'noreply@agrideepai.agentdomains.co';

// Crash early if misconfigured
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}
if (!brevoApiKey) {
  throw new Error('Missing BREVO_API_KEY');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Helpers ──────────────────────────────────────────────────
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationEmail(email, code) {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: emailFrom, name: 'AgriDeepAI' },
      to: [{ email }],
      subject: 'Your AgriDeepAI Verification Code',
      htmlContent: `<p>Your verification code is: <strong>${code}</strong></p><p>It expires in 10 minutes.</p>`,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Brevo error: ${resp.status} - ${text}`);
  }
  return resp;
}

async function storeVerificationCode(email, code) {
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('verification_codes')
    .upsert({ email, code, expiry }, { onConflict: 'email' });
  if (error) throw error;
}

async function verifyCode(email, code) {
  const { data, error } = await supabase
    .from('verification_codes')
    .select('code, expiry')
    .eq('email', email)
    .maybeSingle();
  if (error || !data) return { valid: false, message: 'No code found. Request a new one.' };
  if (data.code !== code) return { valid: false, message: 'Invalid verification code.' };
  if (new Date(data.expiry) < new Date()) return { valid: false, message: 'Code expired. Request a new one.' };
  return { valid: true };
}

async function deleteVerificationCode(email) {
  await supabase.from('verification_codes').delete().eq('email', email);
}

async function createUser(email, password, name) {
  const hashed = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash: hashed, name })
    .select('id, email, name')
    .single();
  if (error) throw error;
  return data;
}

async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, password_hash')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createSession(userId) {
  const token = generateToken();
  const { error } = await supabase.from('sessions').insert({ token, user_id: userId });
  if (error) throw error;
  return token;
}

async function deleteSession(token) {
  await supabase.from('sessions').delete().eq('token', token);
}

async function getUserFromToken(token) {
  const { data, error } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  return data.user_id;
}

// ─── Main Handler ─────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sendJson = (status, data) => res.status(status).json(data);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // ─── POST /api/send-verification ──────────────────────────
    if (path === '/api/send-verification' && req.method === 'POST') {
      const { email } = req.body;
      if (!email) return sendJson(400, { error: 'Email required' });
      const code = generateCode();
      await storeVerificationCode(email, code);
      await sendVerificationEmail(email, code);
      return sendJson(200, { message: 'Verification code sent' });
    }

    // ─── POST /api/auth/signup ────────────────────────────────
    if (path === '/api/auth/signup' && req.method === 'POST') {
      const { email, password, name, verificationCode } = req.body;
      if (!email || !password || !name || !verificationCode) {
        return sendJson(400, { error: 'All fields required' });
      }

      const existing = await findUserByEmail(email);
      if (existing) return sendJson(400, { error: 'Email already registered' });

      const { valid, message } = await verifyCode(email, verificationCode);
      if (!valid) return sendJson(400, { error: message });

      const user = await createUser(email, password, name);
      await deleteVerificationCode(email);

      const token = await createSession(user.id);
      return sendJson(200, { user: { id: user.id, email: user.email, name: user.name }, token });
    }

    // ─── POST /api/auth/login ──────────────────────────────────
    if (path === '/api/auth/login' && req.method === 'POST') {
      const { email, password } = req.body;
      if (!email || !password) return sendJson(400, { error: 'Email and password required' });

      const user = await findUserByEmail(email);
      if (!user) return sendJson(400, { error: 'Invalid credentials' });

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return sendJson(400, { error: 'Invalid credentials' });

      const code = generateCode();
      await storeVerificationCode(email, code);
      await sendVerificationEmail(email, code);
      return sendJson(200, { userId: user.id, message: 'Verification code sent' });
    }

    // ─── POST /api/auth/verify-login ──────────────────────────
    if (path === '/api/auth/verify-login' && req.method === 'POST') {
      const { email, code } = req.body;
      if (!email || !code) return sendJson(400, { error: 'Email and code required' });

      const { valid, message } = await verifyCode(email, code);
      if (!valid) return sendJson(400, { error: message });

      const user = await findUserByEmail(email);
      if (!user) return sendJson(400, { error: 'User not found' });

      await deleteVerificationCode(email);
      const token = await createSession(user.id);
      return sendJson(200, { user: { id: user.id, email: user.email, name: user.name }, token });
    }

    // ─── POST /api/auth/logout ─────────────────────────────────
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) await deleteSession(token);
      return sendJson(200, { success: true });
    }

    // ─── GET /api/conversations ────────────────────────────────
    if (path === '/api/conversations' && req.method === 'GET') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return sendJson(401, { error: 'Unauthorized' });

      const userId = await getUserFromToken(token);
      if (!userId) return sendJson(401, { error: 'Invalid token' });

      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return sendJson(200, { conversations: data });
    }

    // ─── POST /api/conversations ───────────────────────────────
    if (path === '/api/conversations' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return sendJson(401, { error: 'Unauthorized' });

      const userId = await getUserFromToken(token);
      if (!userId) return sendJson(401, { error: 'Invalid token' });

      const { conversations } = req.body;
      if (!Array.isArray(conversations)) return sendJson(400, { error: 'Invalid data' });

      for (const conv of conversations) {
        const { id, title, messages, pinned, updatedAt } = conv;
        await supabase
          .from('conversations')
          .upsert({
            id,
            user_id: userId,
            title: title || 'New Chat',
            messages: messages || [],
            pinned: pinned || false,
            updated_at: updatedAt || new Date().toISOString(),
          }, { onConflict: 'id' });
      }
      return sendJson(200, { success: true });
    }

    // ─── POST /api/chat (AI) ───────────────────────────────────
    if (path === '/api/chat' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return sendJson(401, { error: 'Unauthorized' });

      const userId = await getUserFromToken(token);
      if (!userId) return sendJson(401, { error: 'Invalid token' });

      const { message, history, model, temperature, webSearchEnabled, files } = req.body;
      if (!message) return sendJson(400, { error: 'Message required' });

      // ─── REPLACE THIS WITH YOUR GROQ/GEMINI LOGIC ──────────
      const aiResponse = `You said: "${message}". Replace with AI integration.`;

      return sendJson(200, { response: aiResponse });
    }

    // ─── 404 ────────────────────────────────────────────────────
    return sendJson(404, { error: 'Not found' });
  } catch (err) {
    console.error('Handler error:', err);
    return sendJson(500, { error: err.message || 'Internal server error' });
  }
};
