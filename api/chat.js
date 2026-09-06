// api/chat.js – AgriDeepAI backend with Supabase persistence
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const brevoApiKey = process.env.BREVO_API_KEY;
const emailFrom = process.env.EMAIL_FROM || 'noreply@agrideepai.agentdomains.co';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- Helpers ---
async function sendVerificationEmail(email, code) {
  if (!brevoApiKey) throw new Error('BREVO_API_KEY missing');
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': brevoApiKey },
    body: JSON.stringify({
      sender: { email: emailFrom, name: 'AgriDeepAI' },
      to: [{ email }],
      subject: 'Your AgriDeepAI Verification Code',
      htmlContent: `<p>Your verification code is: <strong>${code}</strong></p><p>It expires in 10 minutes.</p>`,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Brevo error: ${resp.status} - ${txt}`);
  }
  return resp;
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function storeVerificationCode(email, code, userId = null) {
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('verification_codes')
    .upsert({ email, code, expiry, user_id: userId, created_at: new Date().toISOString() }, { onConflict: 'email' });
  if (error) throw error;
}

async function verifyCode(email, code) {
  const { data, error } = await supabase
    .from('verification_codes')
    .select('code, expiry')
    .eq('email', email)
    .maybeSingle();
  if (error || !data) return { valid: false, message: 'No code found. Please request a new code.' };
  if (data.code !== code) return { valid: false, message: 'Invalid verification code.' };
  if (new Date(data.expiry) < new Date()) return { valid: false, message: 'Verification code expired. Request a new one.' };
  return { valid: true };
}

async function deleteVerificationCode(email) {
  await supabase.from('verification_codes').delete().eq('email', email);
}

async function createUser(email, password, name = '') {
  const hashedPassword = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ email, name, password_hash: hashedPassword })
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

// --- Main handler ---
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  const sendJson = (status, data) => res.status(status).json(data);

  try {
    // ---- POST /api/send-verification ----
    if (path === '/api/send-verification' && req.method === 'POST') {
      const { email, code } = req.body;
      if (!email || !code) return sendJson(400, { error: 'Email and code required' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(400, { error: 'Invalid email format' });
      await storeVerificationCode(email, code);
      await sendVerificationEmail(email, code);
      return sendJson(200, { message: 'Verification code sent' });
    }

    // ---- POST /api/auth/signup ----
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

      const sessionToken = require('crypto').randomBytes(32).toString('hex');
      return sendJson(200, { user, sessionToken });
    }

    // ---- POST /api/auth/login ----
    if (path === '/api/auth/login' && req.method === 'POST') {
      const { email, password } = req.body;
      if (!email || !password) return sendJson(400, { error: 'Email and password required' });

      const user = await findUserByEmail(email);
      if (!user) return sendJson(400, { error: 'Invalid credentials' });

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) return sendJson(400, { error: 'Invalid credentials' });

      const code = generateCode();
      await storeVerificationCode(email, code, user.id);
      await sendVerificationEmail(email, code);
      return sendJson(200, { message: 'Verification code sent', userId: user.id });
    }

    // ---- POST /api/auth/verify-login ----
    if (path === '/api/auth/verify-login' && req.method === 'POST') {
      const { email, code } = req.body;
      if (!email || !code) return sendJson(400, { error: 'Email and code required' });

      const { valid, message } = await verifyCode(email, code);
      if (!valid) return sendJson(400, { error: message });

      const user = await findUserByEmail(email);
      if (!user) return sendJson(400, { error: 'User not found' });

      await deleteVerificationCode(email);
      const sessionToken = require('crypto').randomBytes(32).toString('hex');
      return sendJson(200, { user: { id: user.id, email: user.email, name: user.name }, sessionToken });
    }

    // ---- GET /api/conversations ----
    if (path === '/api/conversations' && req.method === 'GET') {
      const userId = req.query.userId;
      if (!userId) return sendJson(400, { error: 'userId required' });

      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return sendJson(200, { conversations: data });
    }

    // ---- POST /api/conversations ----
    if (path === '/api/conversations' && req.method === 'POST') {
      const { userId, conversations } = req.body;
      if (!userId || !conversations) return sendJson(400, { error: 'userId and conversations required' });

      // Upsert each conversation
      for (const conv of conversations) {
        const { id, title, messages, pinned, updatedAt } = conv;
        if (!id) continue;
        const { error } = await supabase
          .from('conversations')
          .upsert({
            id,
            user_id: userId,
            title: title || 'New Chat',
            messages: messages || [],
            pinned: pinned || false,
            updated_at: updatedAt || new Date().toISOString(),
          }, { onConflict: 'id' });
        if (error) throw error;
      }
      return sendJson(200, { success: true });
    }

    // ---- POST /api/chat (AI) ----
    if (path === '/api/chat' && req.method === 'POST') {
      // Placeholder – integrate your Groq/Gemini logic here
      return sendJson(200, { response: 'AI response placeholder – integrate Groq/Gemini here.' });
    }

    // ---- 404 ----
    return sendJson(404, { error: 'Endpoint not found' });
  } catch (error) {
    console.error('Handler error:', error);
    return sendJson(500, { error: error.message || 'Internal server error' });
  }
};
