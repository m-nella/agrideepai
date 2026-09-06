// api/chat.js – AI endpoint with Supabase JWT verification
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check environment
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Server misconfigured: SUPABASE_URL and SUPABASE_ANON_KEY required' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Verify JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }
  const token = authHeader.split(' ')[1];

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Now we have authenticated user – proceed with AI
  const { message, history, model, temperature, webSearchEnabled } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // ---- 🧠 INSERT YOUR GROQ/GEMINI LOGIC HERE ----
    // This is a placeholder – you can copy your existing AI calling code.
    const aiResponse = `[Placeholder] You said: "${message}". Integrate Groq/Gemini here.`;

    return res.status(200).json({ response: aiResponse });
  } catch (error) {
    console.error('AI error:', error);
    return res.status(500).json({ error: error.message || 'AI generation failed' });
  }
};
