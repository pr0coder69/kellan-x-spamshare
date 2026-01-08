const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
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
// Store session details for stopping
const sessionDetails = new Map();

let sessionCounter = 1;
const HISTORY_FILE = 'shareHistory.json';

// Load history from file
let shareHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        shareHistory = JSON.parse(data);
    } catch (error) {
        console.error('Error loading history file:', error);
    }
}

// Save history to file
function saveHistoryToFile() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(shareHistory, null, 2));
    } catch (error) {
        console.error('Error saving history file:', error);
    }
}

// Remove duplicate entries from history
function removeHistoryDuplicates() {
    const uniqueHistory = [];
    const seenSessionIds = new Set();
    
    for (const item of shareHistory) {
        // Extract session ID from item.id (format: status_sessionId_timestamp)
        const sessionId = item.id.split('_')[1];
        
        if (!seenSessionIds.has(sessionId)) {
            seenSessionIds.add(sessionId);
            uniqueHistory.push(item);
        } else {
            // Replace with newer entry if duplicate found
            const existingIndex = uniqueHistory.findIndex(h => h.id.split('_')[1] === sessionId);
            if (existingIndex > -1) {
                const existingTimestamp = new Date(uniqueHistory[existingIndex].timestamp);
                const newTimestamp = new Date(item.timestamp);
                if (newTimestamp > existingTimestamp) {
                    uniqueHistory[existingIndex] = item;
                }
            }
        }
    }
    
    shareHistory = uniqueHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    saveHistoryToFile();
}

// Initial cleanup
removeHistoryDuplicates();

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

// Get history endpoint
app.get('/api/history', (req, res) => {
    res.json(shareHistory);
});

// Save history endpoint
app.post('/api/history/save', (req, res) => {
    try {
        const newHistory = req.body;
        if (Array.isArray(newHistory)) {
            // Merge with existing history
            const combinedHistory = [...shareHistory, ...newHistory];
            // Remove duplicates
            const uniqueHistory = Array.from(new Map(combinedHistory.map(item => [item.id.split('_')[1], item])).values());
            shareHistory = uniqueHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Save to file
            saveHistoryToFile();
            
            res.status(200).json({
                status: 200,
                message: 'History saved successfully'
            });
        } else {
            res.status(400).json({
                status: 400,
                error: 'Invalid history data'
            });
        }
    } catch (error) {
        res.status(500).json({
            status: 500,
            error: error.message
        });
    }
});

// Clear history endpoint
app.post('/api/history/clear', (req, res) => {
    try {
        const { key } = req.body;
        if (key === "shareddd") {
            shareHistory = [];
            saveHistoryToFile();
            res.status(200).json({
                status: 200,
                message: 'History cleared successfully'
            });
        } else {
            res.status(401).json({
                status: 401,
                error: 'Invalid access key'
            });
        }
    } catch (error) {
        res.status(500).json({
            status: 500,
            error: error.message
        });
    }
});

// Get statistics endpoint
app.get('/api/statistics', (req, res) => {
    try {
        let totalShares = 0;
        let completedCount = 0;
        let stoppedCount = 0;
        
        shareHistory.forEach(item => {
            totalShares += item.count;
            if (item.completed) {
                completedCount++;
            } else {
                stoppedCount++;
            }
        });
        
        res.status(200).json({
            status: 200,
            statistics: {
                totalShares,
                completedCount,
                stoppedCount,
                totalProcesses: shareHistory.length
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 500,
            error: error.message
        });
    }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Improved stop process endpoint
app.post('/api/stop/:sessionId', (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const { key } = req.body;
    
    if (!key || key !== "stopnow") {
        return res.status(401).json({
            status: 401,
            error: 'Invalid access key'
        });
    }
    
    // Find the process by session ID
    const processes = Array.from(total.values());
    const processIndex = sessionId - 1;
    
    if (processIndex >= 0 && processIndex < processes.length) {
        const processKeys = Array.from(total.keys());
        const processKey = processKeys[processIndex];
        const process = processes[processIndex];
        
        // Clear the interval if it exists
        if (activeIntervals.has(processKey)) {
            clearInterval(activeIntervals.get(processKey));
            activeIntervals.delete(processKey);
        }
        
        // Get session details
        const username = userSessions.get(sessionId) || 'Unknown User';
        const url = sessionUrls.get(sessionId) || process.url;
        const count = process.count;
        const target = process.target;
        
        // Check if session already exists in history
        const existingIndex = shareHistory.findIndex(item => item.id.includes(`_${sessionId}_`));
        
        if (existingIndex > -1) {
            // Update existing entry
            shareHistory[existingIndex] = {
                id: `stopped_${sessionId}_${Date.now()}`,
                url: url,
                username: username,
                count: count,
                target: target,
                timestamp: new Date().toISOString(),
                completed: false
            };
        } else {
            // Add new entry
            const historyItem = {
                id: `stopped_${sessionId}_${Date.now()}`,
                url: url,
                username: username,
                count: count,
                target: target,
                timestamp: new Date().toISOString(),
                completed: false
            };
            
            shareHistory.unshift(historyItem);
        }
        
        if (shareHistory.length > 1000) shareHistory.pop();
        saveHistoryToFile();
        
        // Clean up
        total.delete(processKey);
        userSessions.delete(sessionId);
        sessionUrls.delete(sessionId);
        sessionDetails.delete(sessionId);
        
        return res.status(200).json({
            status: 200,
            message: 'Process stopped successfully'
        });
    }
    
    return res.status(404).json({
        status: 404,
        error: 'Process not found'
    });
  } catch (error) {
    console.error('Error stopping process:', error);
    return res.status(500).json({
        status: 500,
        error: 'Internal server error'
    });
  }
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
  
  // Store session details
  userSessions.set(sessionId, username);
  sessionUrls.set(sessionId, url);
  sessionDetails.set(sessionId, {
    postId: postId,
    username: username,
    url: url,
    target: amount
  });
  
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
        
        // Check if session already exists in history
        const existingIndex = shareHistory.findIndex(item => item.id.includes(`_${sessionId}_`));
        
        if (existingIndex > -1) {
            // Update existing entry
            shareHistory[existingIndex] = {
                id: `completed_${sessionId}_${Date.now()}`,
                url: url,
                username: username,
                count: amount,
                target: amount,
                timestamp: new Date().toISOString(),
                completed: true
            };
        } else {
            // Add to history when completed
            const historyItem = {
                id: `completed_${sessionId}_${Date.now()}`,
                url: url,
                username: username,
                count: amount,
                target: amount,
                timestamp: new Date().toISOString(),
                completed: true
            };
            
            shareHistory.unshift(historyItem);
        }
        
        if (shareHistory.length > 1000) shareHistory.pop();
        saveHistoryToFile();
        
        // Clean up after completion
        setTimeout(() => {
          total.delete(postId);
          userSessions.delete(sessionId);
          sessionUrls.delete(sessionId);
          sessionDetails.delete(sessionId);
        }, 5000);
      }
    } catch (error) {
      console.error('Share error:', error.message);
      clearInterval(timer);
      activeIntervals.delete(postId);
      total.delete(postId);
      
      // Check if session already exists in history
      const existingIndex = shareHistory.findIndex(item => item.id.includes(`_${sessionId}_`));
      
      if (existingIndex > -1) {
          // Update existing entry
          shareHistory[existingIndex] = {
              id: `error_${sessionId}_${Date.now()}`,
              url: url,
              username: username,
              count: sharedCount,
              target: amount,
              timestamp: new Date().toISOString(),
              completed: false
          };
      } else {
          // Add to history as stopped due to error
          const historyItem = {
              id: `error_${sessionId}_${Date.now()}`,
              url: url,
              username: username,
              count: sharedCount,
              target: amount,
              timestamp: new Date().toISOString(),
              completed: false
          };
          
          shareHistory.unshift(historyItem);
      }
      
      if (shareHistory.length > 1000) shareHistory.pop();
      saveHistoryToFile();
      
      userSessions.delete(sessionId);
      sessionUrls.delete(sessionId);
      sessionDetails.delete(sessionId);
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
      
      // Clean up session details
      userSessions.delete(sessionId);
      sessionUrls.delete(sessionId);
      sessionDetails.delete(sessionId);
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
  console.log(`Access Keys: [HIDDEN]`);
  console.log(`History file: ${HISTORY_FILE}`);
  console.log(`Statistics endpoint: /api/statistics`);
});