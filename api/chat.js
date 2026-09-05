// ==========================================================
// AgriDeepAI Backend — Minimal Echo Test
// ==========================================================

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;
    console.log('📩 Received message:', message);

    // Return a simple echo response (always JSON)
    return res.status(200).json({
      response: `You said: "${message || 'nothing'}" (test response from backend)`,
      searchUsed: false,
      fileProcessed: false,
    });

  } catch (error) {
    console.error('❌ Backend error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}
