module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history, files } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // ─── AI + Web Search (always enabled) ──────────────────────
  // Use your existing Groq/Gemini + Serper/Tavily logic here.
  // For now, echo as placeholder.
  const response = `You said: "${message}". Replace with AI integration.`;
  return res.status(200).json({ response });
};
