// ==========================================================
// AgriDeepAI Backend — Vercel Serverless
// ==========================================================

// Try to import Supabase, but fall back to in‑memory if not available
let supabase = null;
let supabaseAvailable = false;

try {
  const { createClient } = await import('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    supabaseAvailable = true;
  }
} catch (e) {
  console.warn('⚠️ Supabase not available, using in‑memory storage');
}

// In‑memory storage (not persistent across function calls)
const memoryStore = {};

// Helper: get storage
function getStorage() {
  if (supabaseAvailable) return supabase;
  return {
    from: (table) => ({
      select: () => ({
        eq: (field, value) => ({
          maybeSingle: async () => {
            if (table === 'verification_codes') {
              const data = memoryStore[value];
              return { data: data || null, error: null };
            }
            return { data: null, error: null };
          }
        })
      }),
      insert: (obj) => ({
        select: () => ({
          maybeSingle: async () => {
            const key = obj[0].email;
            memoryStore[key] = { code: obj[0].code, expiry: obj[0].expiry };
            return { data: [{ id: 'mock', email: key, name: obj[0].name }], error: null };
          }
        })
      }),
      upsert: (obj, options) => ({
        then: (cb) => {
          const key = obj.email;
          memoryStore[key] = { code: obj.code, expiry: obj.expiry, user_id: obj.user_id };
          cb({ error: null });
        }
      }),
      delete: () => ({
        eq: (field, value) => ({
          then: (cb) => {
            delete memoryStore[value];
            cb({ error: null });
          }
        })
      })
    })
  };
}

const storage = getStorage();

// Brevo config
const brevoApiKey = process.env.BREVO_API_KEY;
const emailFrom = process.env.EMAIL_FROM || 'mutuyimanaornella00@gmail.com';

// Helpers
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code) {
  if (!brevoApiKey) throw new Error('BREVO_API_KEY is not set');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'AgriDeepAI/2.0',
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
    let msg = `Brevo API error: ${response.status}`;
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
// HANDLER
// ==========================================================
export default async function handler(req, res) {
  // Always set JSON content type and CORS
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

  // Only handle the verification endpoint for now
  if (req.method === 'POST' && path === '/api/send-verification') {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        return res.status(400).json({ error: 'Email and code required' });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      // Store code in memory or Supabase
      const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      if (supabaseAvailable) {
        await supabase
          .from('verification_codes')
          .upsert({ email, code, expiry }, { onConflict: 'email' });
      } else {
        memoryStore[email] = { code, expiry };
      }

      // Send email
      await sendVerificationEmail(email, code);

      return res.status(200).json({ success: true, message: 'Verification code sent' });
    } catch (error) {
      console.error('Send verification error:', error.message);
      return res.status(500).json({ error: error.message || 'Failed to send email' });
    }
  }

  // For other endpoints, return a simple message (so we know it's JSON)
  res.status(200).json({ message: 'AgriDeepAI API is running' });
}
