import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post('/api/extract', async (req, res) => {
    const { url: rawUrl, customInstance } = req.body;
    
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Extract URL from string (handles cases where users paste text with a link)
    const urlRegex = /(https?:\/\/[^\s]+)/;
    const match = rawUrl.match(urlRegex);
    
    if (!match) {
      return res.status(400).json({ error: 'No valid link found. Please paste a direct link starting with https://' });
    }

    const url = match[0];

    try {
      console.log('Extracting video from:', url);
      if (customInstance) console.log('Using custom instance:', customInstance);
      
      // Basic platform detection for UI
      let platform = 'Video';
      const lowUrl = url.toLowerCase();
      if (lowUrl.includes('instagram.com')) platform = 'Instagram';
      else if (lowUrl.includes('facebook.com') || lowUrl.includes('fb.watch')) platform = 'Facebook';
      else if (lowUrl.includes('twitter.com') || lowUrl.includes('x.com')) platform = 'Twitter';
      else if (lowUrl.includes('tiktok.com')) platform = 'TikTok';
      else if (lowUrl.includes('youtube.com') || lowUrl.includes('youtu.be')) platform = 'YouTube';
      else if (lowUrl.includes('reddit.com')) platform = 'Reddit';

      // Use user instance first, then fallback to public list
      const instances = customInstance ? [customInstance] : [
        'https://cobalt.hyons.xyz',
        'https://cobalt.smartit-now.com',
        'https://co.eepy.moe',
        'https://cobalt.api.0x0.moe',
        'https://cobalt.hyper.pwn.ovh',
        'https://cobalt.unbounded.live',
        'https://cobalt.q69.it',
        'https://cobalt.peris.dev',
        'https://cobalt.fancube.org',
        'https://cobalt.phreax.dev',
        'https://cobalt.shite.xyz'
      ];

      let cobaltData = null;
      let lastError = null;

      // Create a custom agent to ignore some certificate issues
      const https = await import('https');
      const agent = new https.Agent({ rejectUnauthorized: false });

      for (const baseEndpoint of instances) {
        // Try /api/json (preferred) then root endpoint
        const endpoints = [`${baseEndpoint}/api/json`, baseEndpoint];
        
        for (const endpoint of endpoints) {
          try {
            console.log(`Checking Node: ${endpoint}`);
            const cobaltResponse = await axios.post(endpoint, {
              url: url
            }, {
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              },
              httpsAgent: agent,
              timeout: 5000 // Fast fail
            });

            const responseData = cobaltResponse.data;
            
            // Success detection
            const isSuccess = responseData && (
              ['stream', 'redirect', 'picker', 'tunnel'].includes(responseData.status) || 
              (responseData.status !== 'error' && (responseData.url || responseData.stream))
            );

            if (isSuccess) {
              console.log(`Success with Node: ${endpoint}`);
              cobaltData = responseData;
              break; 
            }
            
            if (responseData && responseData.status === 'error') {
              lastError = new Error(responseData.text || responseData.error?.code || 'Node error');
            }
            
            // Ensure cobaltData is null so we continue to the next endpoint/node
            cobaltData = null;
          } catch (innerError: any) {
             // Silently continue to next node
             cobaltData = null;
          }
        }
        if (cobaltData) break;
      }

      if (!cobaltData) {
        throw new Error('All service nodes are currently busy or the URL is restricted. Please try again with a different link or check if the video is public.');
      }

      const data = cobaltData;

      // Cobalt v10 statuses: 'redirect', 'stream', 'picker', 'tunnel', 'error'
      const downloadUrl = data.url || data.stream;

      if (['stream', 'redirect', 'tunnel'].includes(data.status) || downloadUrl) {
        return res.json({
          success: true,
          platform,
          title: data.filename || `Video from ${platform}`,
          thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=300&auto=format&fit=crop',
          formats: [{ quality: 'High Quality', url: downloadUrl || data.url, size: 'Auto' }]
        });
      } else if (data.status === 'picker') {
        return res.json({
          success: true,
          platform,
          title: `Gallery Content`,
          thumbnail: data.picker[0]?.thumb || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=300&auto=format&fit=crop',
          formats: data.picker.map((item: any, i: number) => ({
            quality: `File ${i + 1}`,
            url: item.url,
            size: 'Auto'
          }))
        });
      } else {
        throw new Error(data.text || `Service returned status: ${data.status}`);
      }
    } catch (error: any) {
      console.error('Extraction error:', error.message);
      // Return the actual error message to the user for better troubleshooting
      const errorMessage = error.message.includes('busy') 
        ? error.message 
        : `Extraction failed: ${error.message}`;
        
      res.status(500).json({ 
        error: errorMessage,
        details: error.message 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
