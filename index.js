const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();

app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const total = new Map();
// Store active intervals to stop them
const activeIntervals = new Map();
// Store usernames for each session
const userSessions = new Map();
// Store original URLs for each session
const sessionUrls = new Map();

let sessionCounter = 1;

app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index) => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
  }));
  res.json(JSON.parse(JSON.stringify(data || [], null, 2)));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// New endpoint to stop a process
app.post('/api/stop/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  
  // Find the process by session ID
  const processes = Array.from(total.values());
  const processIndex = sessionId - 1;
  
  if (processIndex >= 0 && processIndex < processes.length) {
    const processKey = Array.from(total.keys())[processIndex];
    
    // Clear the interval if it exists
    if (activeIntervals.has(processKey)) {
      clearInterval(activeIntervals.get(processKey));
      activeIntervals.delete(processKey);
    }
    
    // Remove from total map
    total.delete(processKey);
    
    return res.status(200).json({
      status: 200,
      message: 'Process stopped successfully'
    });
  }
  
  return res.status(404).json({
    status: 404,
    error: 'Process not found'
  });
});

app.post('/api/submit', async (req, res) => {
  const {
    username,
    cookie,
    url,
    amount,
    interval,
  } = req.body;
  
  if (!username || !cookie || !url || !amount || !interval) return res.status(400).json({
    error: 'Missing username, state, url, amount, or interval'
  });
  
  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({
        status: 500,
        error: 'Invalid cookies'
      });
    };
    
    const sessionId = sessionCounter++;
    await share(cookies, url, amount, interval, sessionId, username);
    
    res.status(200).json({
      status: 200,
      sessionId: sessionId
    });
  } catch (err) {
    return res.status(500).json({
      status: 500,
      error: err.message || err
    });
  }
});

async function share(cookies, url, amount, interval, sessionId, username) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);
  
  if (!id) {
    throw new Error("Unable to get link id: invalid URL, it's either a private post or visible to friends only");
  }
  
  const postId = total.has(id) ? id + 1 : id;
  total.set(postId, {
    url,
    id,
    count: 0,
    target: amount,
  });
  
  // Store username and original URL for this session
  userSessions.set(sessionId, username);
  sessionUrls.set(sessionId, url);
  
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate',
    'connection': 'keep-alive',
    'content-length': '0',
    'cookie': cookies,
    'host': 'graph.facebook.com'
  };
  
  let sharedCount = 0;
  let timer;
  
  async function sharePost() {
    try {
      const response = await axios.post(`https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`, {}, {
        headers
      });
      
      if (response.status !== 200) {
        console.log('Share failed');
      } else {
        total.set(postId, {
          ...total.get(postId),
          count: total.get(postId).count + 1,
        });
        sharedCount++;
      }
      
      if (sharedCount >= amount) {
        clearInterval(timer);
        activeIntervals.delete(postId);
        
        // Optional: remove from active processes after completion
        setTimeout(() => {
          total.delete(postId);
        }, 5000);
      }
    } catch (error) {
      console.error('Share error:', error.message);
      clearInterval(timer);
      activeIntervals.delete(postId);
      total.delete(postId);
    }
  }
  
  timer = setInterval(sharePost, interval * 1000);
  activeIntervals.set(postId, timer);
  
  // Set timeout to automatically stop after expected completion time + buffer
  setTimeout(() => {
    if (activeIntervals.has(postId)) {
      clearInterval(timer);
      activeIntervals.delete(postId);
      total.delete(postId);
    }
  }, (amount * interval * 1000) + 10000);
}

async function getPostID(url) {
  try {
    const response = await axios.post('https://id.traodoisub.com/api.php', `link=${encodeURIComponent(url)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data.id;
  } catch (error) {
    console.error('Error getting post ID:', error.message);
    return;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
      'cache-control': 'max-age=0',
      'cookie': cookie,
      'referer': 'https://www.facebook.com/',
      'sec-ch-ua': '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    };
    
    const response = await axios.get('https://business.facebook.com/content_management', {
      headers
    });
    
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);
    if (token && token[1]) {
      const accessToken = token[1];
      return accessToken;
    }
  } catch (error) {
    console.error('Error getting access token:', error.message);
    return;
  }
}

async function convertCookie(cookie) {
  return new Promise((resolve, reject) => {
    try {
      const cookies = JSON.parse(cookie);
      const sbCookie = cookies.find(cookie => cookie.key === "sb");
      if (!sbCookie) {
        reject("Detect invalid appstate please provide a valid appstate");
      }
      const sbValue = sbCookie.value;
      const data = `sb=${sbValue}; ${cookies.slice(1).map(cookie => `${cookie.key}=${cookie.value}`).join('; ')}`;
      resolve(data);
    } catch (error) {
      reject("Error processing appstate please provide a valid appstate");
    }
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Spam Share server running on port ${PORT}`);
  console.log(`Developer: Kellan Kaya`);
  console.log(`Access Keys:`);
  console.log(`- Clear History: "shareddd"`);
  console.log(`- Stop Process: "stopnow"`);
});