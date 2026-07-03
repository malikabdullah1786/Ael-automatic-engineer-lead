import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return NextResponse.json({
        error: "No refresh token was returned. To fix this, go to your Google Account Security Settings, remove permission for this app, and click the link to re-authenticate.",
        tokens
      }, { status: 400 });
    }

    // Return a sleek HTML screen displaying the token
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Google OAuth Refresh Token</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            background-color: #030712;
            color: #f3f4f6;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
          }
          .card {
            background: rgba(17, 24, 39, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            padding: 40px;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(16px);
            text-align: center;
          }
          h1 {
            color: #38bdf8;
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 16px 0;
          }
          p {
            color: #9ca3af;
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 24px;
          }
          .token-label {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #f3f4f6;
            margin-top: 24px;
            margin-bottom: 8px;
            text-align: left;
          }
          .token-box {
            background-color: #090d16;
            border: 1px solid #1f2937;
            border-radius: 8px;
            padding: 14px;
            font-family: monospace;
            font-size: 13px;
            word-break: break-all;
            user-select: all;
            color: #34d399;
            text-align: left;
            box-shadow: inset 0 2px 4px 0 rgba(0,0,0,0.06);
          }
          .highlight {
            color: #60a5fa;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google OAuth Token Generated</h1>
          <p>Copy the refresh token below and paste it into your local <span class="highlight">.env.local</span> file as the value for <span class="highlight">GOOGLE_REFRESH_TOKEN</span>.</p>
          
          <div class="token-label">GOOGLE_REFRESH_TOKEN</div>
          <div class="token-box">${tokens.refresh_token}</div>
        </div>
      </body>
      </html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html" }
    });
  } catch (error: any) {
    console.error("Token Exchange Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
