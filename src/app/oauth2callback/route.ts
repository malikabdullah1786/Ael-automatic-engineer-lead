import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?oauth=error&message=Missing+authorization+code", req.url));
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Sometimes Google only returns a refresh token on the first approval
      // If we don't get one, check if we already have one, or redirect with notice
      if (process.env.GOOGLE_REFRESH_TOKEN) {
        return NextResponse.redirect(new URL("/?oauth=success", req.url));
      }
      return NextResponse.redirect(
        new URL(
          `/?oauth=error&message=${encodeURIComponent(
            "No refresh token was returned. Remove app access in Google Account Settings first."
          )}`,
          req.url
        )
      );
    }

    // Automatically update the .env.local file on disk
    try {
      const envPath = path.join(process.cwd(), ".env.local");
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, "utf-8");
        const tokenRegex = /^GOOGLE_REFRESH_TOKEN=.*/m;

        if (tokenRegex.test(envContent)) {
          envContent = envContent.replace(tokenRegex, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        } else {
          // If it doesn't exist, append it
          envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }

        fs.writeFileSync(envPath, envContent, "utf-8");
        console.log("Successfully auto-updated GOOGLE_REFRESH_TOKEN in .env.local");
      } else {
        console.warn(".env.local file not found at " + envPath);
      }
    } catch (fsErr: any) {
      console.error("Failed to write to .env.local:", fsErr);
    }

    // Redirect the user back to the home page with a success message
    return NextResponse.redirect(new URL("/?oauth=success", req.url));
  } catch (error: any) {
    console.error("Token Exchange Error:", error);
    return NextResponse.redirect(new URL(`/?oauth=error&message=${encodeURIComponent(error.message)}`, req.url));
  }
}
