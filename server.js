require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");
const cors = require("cors");
const fs = require("fs");

const app = express();

// --------------------
// CONFIG
// --------------------
const PORT = process.env.PORT || 3000;

// CORS (frontend controlled via env)
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));

app.use(express.json());

// Session (keep simple for now)
app.use(session({
  secret: process.env.SESSION_SECRET || "brandtier_secret_key",
  resave: false,
  saveUninitialized: false
}));

const FILE = "tokens.json";

// --------------------
// Helpers (file storage)
// --------------------
function loadData() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE));
}

function saveData(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// --------------------
// 1. Google OAuth Login
// --------------------
app.get("/auth", (req, res) => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" +
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
// 2. OAuth Callback
// --------------------
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

    req.session.tokens = { access_token, refresh_token };

    // YouTube API
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

    const channel = yt.data.items[0];

    const data = loadData();

    data.push({
      name: channel.snippet.title,
      avatar: channel.snippet.thumbnails.default.url,
      subs: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
      videos: channel.statistics.videoCount,
      refresh_token,
      accepted: false,
      createdAt: new Date()
    });

    saveData(data);

    // 🔥 FIXED: no more localhost
    res.redirect(process.env.FRONTEND_URL + "/?connected=1");

  } catch (err) {
  console.log("OAUTH FAILED:", err.response?.data || err.message);

  return res.status(500).json({
    message: "OAuth failed",
    error: err.response?.data || err.message
  });
}
});

// --------------------
// 3. Get YouTube Data
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

    const channel = yt.data.items[0];

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
// 4. Accept Sponsorship
// --------------------
app.post("/accept", (req, res) => {
  const data = loadData();

  if (data.length > 0) {
    data[data.length - 1].accepted = true;
  }

  saveData(data);

  res.send("Deal accepted");
});

// --------------------
// 5. Logout
// --------------------
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.send("Logged out");
  });
});

// --------------------
// Start server (Railway-safe)
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
