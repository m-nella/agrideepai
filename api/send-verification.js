// ==========================================================
// Send Verification Code via Brevo
// ==========================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code required' });
    }

    const apiKey = process.env.BREVO_API_KEY;
    const emailFrom = process.env.EMAIL_FROM || 'noreply@agrideepai.com';

    if (!apiKey) {
      return res.status(500).json({ error: 'Email service not configured' });
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: emailFrom, name: 'AgriDeepAI' },
        to: [{ email }],
        subject: 'AgriDeepAI — Your Verification Code',
        htmlContent: `
          <h1 style="color:#2b7d4b;">AgriDeepAI</h1>
          <p>Your verification code is:</p>
          <h2 style="background:#1a1a1c; padding:16px; border-radius:8px; font-size:32px; letter-spacing:8px; text-align:center;">${code}</h2>
          <p>This code expires in <strong>5 minutes</strong>.</p>
          <hr style="margin:20px 0; border-color:#262628;" />
          <p style="color:#5c5c62; font-size:13px;">If you didn't request this, please ignore this email.</p>
        `,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Brevo error:', errorData);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true, message: 'Verification code sent' });

  } catch (error) {
    console.error('Email error:', error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
