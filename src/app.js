// Silence deprecation warnings
process.noDeprecation = true;

// Import required modules
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const https = require('https');
const fs = require('fs');
const OAuth = require('oauth');

// Load environment variables from .env file
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });


// Create Express application
const app = express();

// Middleware setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
const publicPath = path.join(__dirname, 'public');
console.log('Public directory path:', publicPath);
app.use(express.static(publicPath));

// Create Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Set up OAuth 2.0 client
const oauth2 = new OAuth.OAuth2(
  process.env.TWITTER_CLIENT_ID,
  process.env.TWITTER_CLIENT_SECRET,
  'https://api.twitter.com/',
  'oauth2/authorize',
  'oauth2/token',
  null
);

// Root route
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  console.log('Attempting to serve:', indexPath);
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

// Twitter OAuth routes
app.get('/auth/twitter', (req, res) => {
  const authorizationUrl = oauth2.getAuthorizeUrl({
      redirect_uri: 'https://theghoom.com/callback',
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      state: 'some-state'
  });
  res.redirect(authorizationUrl);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
      const accessToken = await new Promise((resolve, reject) => {
          oauth2.getOAuthAccessToken(code, {
              grant_type: 'authorization_code',
              redirect_uri: 'https://theghoom.com/callback'
          }, (err, accessToken, refreshToken, results) => {
              if (err) {
                  reject(err);
              } else {
                  resolve({ accessToken, refreshToken, results });
              }
          });
      });

      // Here you would typically save the access token to your database
      // For now, we'll just send it as a response
      res.json({ success: true, accessToken });
  } catch (error) {
      console.error('Error getting access token:', error);
      res.status(500).json({ error: 'Failed to authenticate with Twitter' });
  }
});


// Test database connection
app.get('/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('test_table')
      .select('*');
    
    if (error) throw error;
    
    res.json({ message: 'Database connection successful', data });
  } catch (error) {
    res.status(500).json({ message: 'Error connecting to database', error: error.message });
  }
});

// Sign Up route
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  const { user, error } = await supabase.auth.signUp({ email, password });
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ user });
});

// Login route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { user, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ user });
});

// Route to schedule a new post
app.post('/schedule-post', async (req, res) => {
  const { content, dateTime, platform } = req.body;
  
  if (!content || !dateTime || !platform) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) throw sessionError;
    
    if (!session || !session.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    console.log('Attempting to insert post:', {
      user_id: session.user.id,
      content,
      date_time: dateTime,
      platform
    });

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert([
        { user_id: session.user.id, content, date_time: dateTime, platform }
      ])
      .select();

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    console.log('Post scheduled successfully:', data[0]);
    res.json({ message: 'Post scheduled successfully', post: data[0] });
  } catch (error) {
    console.error('Error scheduling post:', error);
    res.status(500).json({ error: 'An error occurred while scheduling the post', details: error.message });
  }
});

// Route to fetch scheduled posts
app.get('/scheduled-posts', async (req, res) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', user.id)
      .order('date_time', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching scheduled posts:', error);
    res.status(500).json({ error: 'An error occurred while fetching scheduled posts' });
  }
});

// New route to check authentication status
app.get('/auth-status', async (req, res) => {
  console.log('Checking authentication status');
  try {
    const { data, error } = await supabase.auth.getSession();
    console.log('Auth status data:', data);
    if (error) {
      console.error('Auth status error:', error);
      return res.status(500).json({ error: error.message });
    }
    if (data && data.session) {
      console.log('User is authenticated');
      return res.json({ status: 'authenticated', user: data.session.user });
    }
    console.log('User is not authenticated');
    res.json({ status: 'not authenticated' });
  } catch (error) {
    console.error('Unexpected error in auth status check:', error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Set the port for the server to listen on
const PORT = process.env.PORT || 3000;

// Read SSL certificate files
const privateKey = fs.readFileSync('key.pem', 'utf8');
const certificate = fs.readFileSync('cert.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

// Create HTTPS server
const httpsServer = https.createServer(credentials, app);

// Start the HTTPS server
httpsServer.listen(PORT, () => {
  console.log(`HTTPS Server running on port ${PORT}`);
});