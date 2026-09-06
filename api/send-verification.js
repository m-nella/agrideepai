// ==========================================================
// AgriDeepAI — Send Verification Email via Brevo
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
    const emailFrom = process.env.EMAIL_FROM || 'noreply@agrideepai.agentdomains.co';

    if (!apiKey) {
      console.error('❌ BREVO_API_KEY not set in environment variables');
      return res.status(500).json({ error: 'Email service not configured. Please set BREVO_API_KEY.' });
    }

    console.log('📧 Sending verification email to:', email);
    console.log('📧 From:', emailFrom);
    console.log('📧 Code:', code);

    const logoUrl = 'https://agrideepai.vercel.app/logo.png';

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { 
          email: emailFrom, 
          name: 'AgriDeepAI' 
        },
        to: [{ email }],
        subject: 'AgriDeepAI — Your Verification Code',
        htmlContent: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
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
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">
                <img src="${logoUrl}" alt="AgriDeepAI Logo" />
              </div>
              <h1>AgriDeepAI</h1>
              <p class="subtitle">Your verification code</p>
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              <p style="color:#9a9aa2; text-align:center;">Enter this code to verify your email address.</p>
              <p class="expiry">⏱ This code expires in <strong>5 minutes</strong>.</p>
              <div class="footer">
                If you didn't request this, please ignore this email.<br>
                &copy; AgriDeepAI — Your AI assistant for agriculture &amp; livestock
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error('❌ Brevo error response:', responseText);
      let errorMessage = 'Failed to send email. ';
      
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.message) {
          errorMessage += errorData.message;
        }
        if (errorData.message && errorData.message.includes('unresolved domain')) {
          errorMessage = 'Sender email not verified. Please verify your email in Brevo dashboard.';
        }
        if (errorData.message && errorData.message.includes('unauthorized')) {
          errorMessage = 'Invalid API key. Please check your BREVO_API_KEY.';
        }
        if (errorData.message && errorData.message.includes('unrecognised IP address')) {
          errorMessage = 'Your server IP is not authorized. Please add the IP to Brevo\'s authorised list.';
        }
      } catch (e) {
        errorMessage += `HTTP ${response.status}: ${response.statusText}`;
      }

      return res.status(response.status).json({ 
        error: errorMessage,
        details: responseText.slice(0, 200)
      });
    }

    console.log('✅ Verification email sent successfully');
    return res.status(200).json({ 
      success: true, 
      message: 'Verification code sent to your email' 
    });

  } catch (error) {
    console.error('❌ Email error:', error);
    return res.status(500).json({ 
      error: error.message || 'Something went wrong sending the email' 
    });
  }
}
