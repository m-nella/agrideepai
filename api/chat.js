const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'agrideepai';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@agrideepai.agentdomains.co';

if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
if (!BREVO_API_KEY) throw new Error('Missing BREVO_API_KEY');

let client;
let db;

async function connectDb() {
  if (!client) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(MONGODB_DB);
  }
  return db;
}

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
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: EMAIL_FROM, name: 'AgriDeepAI' },
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

// ─── Main handler ─────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sendJson = (status, data) => res.status(status).json(data);

  try {
    const db = await connectDb();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // ─── POST /api/send-verification ──────────────────────────
    if (path === '/api/send-verification' && req.method === 'POST') {
      const { email } = req.body;
      if (!email) return sendJson(400, { error: 'Email required' });
      const code = generateCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1000);
      await db.collection('verification_codes').updateOne(
        { email },
        { $set: { code, expiry } },
        { upsert: true }
      );
      await sendVerificationEmail(email, code);
      return sendJson(200, { message: 'Verification code sent' });
    }

    // ─── POST /api/auth/signup ────────────────────────────────
    if (path === '/api/auth/signup' && req.method === 'POST') {
      const { email, password, name, verificationCode } = req.body;
      if (!email || !password || !name || !verificationCode) {
        return sendJson(400, { error: 'All fields required' });
      }

      const existing = await db.collection('users').findOne({ email });
      if (existing) return sendJson(400, { error: 'Email already registered' });

      const codeDoc = await db.collection('verification_codes').findOne({ email });
      if (!codeDoc) return sendJson(400, { error: 'No code found. Request a new one.' });
      if (codeDoc.code !== verificationCode) return sendJson(400, { error: 'Invalid code' });
      if (new Date() > codeDoc.expiry) return sendJson(400, { error: 'Code expired' });

      const hashed = await bcrypt.hash(password, 10);
      const user = { email, passwordHash: hashed, name, createdAt: new Date() };
      const result = await db.collection('users').insertOne(user);
      const userId = result.insertedId;

      await db.collection('verification_codes').deleteOne({ email });

      const token = generateToken();
      await db.collection('sessions').insertOne({ token, userId, createdAt: new Date() });

      return sendJson(200, {
        user: { id: userId.toString(), email, name },
        token,
      });
    }

    // ─── POST /api/auth/login ──────────────────────────────────
    if (path === '/api/auth/login' && req.method === 'POST') {
      const { email, password } = req.body;
      if (!email || !password) return sendJson(400, { error: 'Email and password required' });

      const user = await db.collection('users').findOne({ email });
      if (!user) return sendJson(400, { error: 'Invalid credentials' });

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) return sendJson(400, { error: 'Invalid credentials' });

      const code = generateCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1000);
      await db.collection('verification_codes').updateOne(
        { email },
        { $set: { code, expiry } },
        { upsert: true }
      );
      await sendVerificationEmail(email, code);
      return sendJson(200, { userId: user._id.toString(), message: 'Verification code sent' });
    }

    // ─── POST /api/auth/verify-login ──────────────────────────
    if (path === '/api/auth/verify-login' && req.method === 'POST') {
      const { email, code } = req.body;
      if (!email || !code) return sendJson(400, { error: 'Email and code required' });

      const codeDoc = await db.collection('verification_codes').findOne({ email });
      if (!codeDoc) return sendJson(400, { error: 'No code found. Request a new one.' });
      if (codeDoc.code !== code) return sendJson(400, { error: 'Invalid code' });
      if (new Date() > codeDoc.expiry) return sendJson(400, { error: 'Code expired' });

      const user = await db.collection('users').findOne({ email });
      if (!user) return sendJson(400, { error: 'User not found' });

      await db.collection('verification_codes').deleteOne({ email });

      const token = generateToken();
      await db.collection('sessions').insertOne({ token, userId: user._id, createdAt: new Date() });

      return sendJson(200, {
        user: { id: user._id.toString(), email, name: user.name },
        token,
      });
    }

    // ─── POST /api/auth/logout ─────────────────────────────────
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        await db.collection('sessions').deleteOne({ token });
      }
      return sendJson(200, { success: true });
    }

    // ─── GET /api/conversations ────────────────────────────────
    if (path === '/api/conversations' && req.method === 'GET') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return sendJson(401, { error: 'Unauthorized' });

      const session = await db.collection('sessions').findOne({ token });
      if (!session) return sendJson(401, { error: 'Invalid token' });

      const userId = session.userId;
      const conversations = await db.collection('conversations')
        .find({ userId })
        .sort({ updatedAt: -1 })
        .toArray();

      const processed = conversations.map(c => ({
        ...c,
        _id: c._id.toString(),
        userId: c.userId.toString(),
        id: c._id.toString(),
      }));
      return sendJson(200, { conversations: processed });
    }

    // ─── POST /api/conversations ───────────────────────────────
    if (path === '/api/conversations' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return sendJson(401, { error: 'Unauthorized' });

      const session = await db.collection('sessions').findOne({ token });
      if (!session) return sendJson(401, { error: 'Invalid token' });

      const userId = session.userId;
      const { conversations } = req.body;
      if (!Array.isArray(conversations)) return sendJson(400, { error: 'Invalid data' });

      for (const conv of conversations) {
        const { id, title, messages, pinned, updatedAt } = conv;
        const filter = id ? { _id: new ObjectId(id) } : { _id: new ObjectId() };
        const update = {
          $set: {
            userId,
            title: title || 'New Chat',
            messages: messages || [],
            pinned: pinned || false,
            updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        };
        await db.collection('conversations').updateOne(filter, update, { upsert: true });
      }
      return sendJson(200, { success: true });
    }

    // ─── POST /api/chat (AI) ───────────────────────────────────
    if (path === '/api/chat' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return sendJson(401, { error: 'Unauthorized' });

      const session = await db.collection('sessions').findOne({ token });
      if (!session) return sendJson(401, { error: 'Invalid token' });

      const { message, history, model, temperature, webSearchEnabled, files } = req.body;
      if (!message) return sendJson(400, { error: 'Message required' });

      // ─── INSERT YOUR GROQ/GEMINI AI LOGIC HERE ──────────────
      // For now, placeholder
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
