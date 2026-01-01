const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const isDev = require('electron-is-dev');

// Try to set FFmpeg path from ffmpeg-static, fallback to system FFmpeg
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log('Using bundled FFmpeg:', ffmpegPath);
  }
} catch (error) {
  console.log('ffmpeg-static not found, using system FFmpeg');
}

let mainWindow;

function waitForServer(url, maxAttempts = 30, interval = 1000) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    let attempts = 0;
    
    const checkServer = () => {
      attempts++;
      const req = http.get(url, (res) => {
        resolve();
      });
      
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`Server at ${url} did not become available after ${maxAttempts} attempts`));
        } else {
          setTimeout(checkServer, interval);
        }
      });
    };
    
    checkServer();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`;
  
  if (isDev) {
    // Wait for Vite dev server to be ready
    waitForServer(startUrl)
      .then(() => {
        mainWindow.loadURL(startUrl);
        if (isDev) {
          mainWindow.webContents.openDevTools();
        }
      })
      .catch((err) => {
        console.error('Failed to connect to dev server:', err);
        mainWindow.loadURL(startUrl); // Try anyway
      });
  } else {
    mainWindow.loadURL(startUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  // Register the protocol before creating the window  
  protocol.registerFileProtocol('local-video', (request, callback) => {
    try {
      // Remove 'local-video://' prefix
      let filePath = request.url.replace(/^local-video:\/\//, '');
      
      // Split by / and decode each segment, then join with path.sep
      const segments = filePath.split('/').map(segment => decodeURIComponent(segment));
      const normalizedPath = path.join(...segments);
      
      // Verify file exists
      if (!fs.existsSync(normalizedPath)) {
        console.error('Video file not found:', normalizedPath);
        callback({ error: -2 }); // FILE_NOT_FOUND
        return;
      }
      
      console.log('Loading video from:', normalizedPath);
      callback({ path: normalizedPath });
    } catch (error) {
      console.error('Error in protocol handler:', error);
      console.error('Request URL:', request.url);
      callback({ error: -2 }); // FILE_NOT_FOUND
    }
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('save-video-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'Videos', extensions: ['mp4'] },
      { name: 'WebM', extensions: ['webm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    defaultPath: 'output.mp4'
  });

  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});

ipcMain.handle('get-video-url', async (event, filePath) => {
  // Return a URL that can be used with the custom protocol
  // Use a simpler approach - just use the path directly with minimal encoding
  const encodedPath = filePath.split(path.sep).map(segment => encodeURIComponent(segment)).join('/');
  return `local-video://${encodedPath}`;
});

ipcMain.handle('get-temp-video-path', async () => {
  // Get the OS temp directory and create a temporary file path
  // Use WebM for preview to support transparency
  const os = require('os');
  const tempDir = os.tmpdir();
  const tempFileName = `preview_${Date.now()}.webm`;
  return path.join(tempDir, tempFileName);
});

ipcMain.handle('detect-green-color', async (event, videoPath) => {
  return new Promise((resolve, reject) => {
    // Validate video path
    if (!videoPath || !fs.existsSync(videoPath)) {
      console.error('Video path is invalid or file does not exist:', videoPath);
      resolve('#00ff00'); // Fallback to default green
      return;
    }

    const os = require('os');
    const tempDir = os.tmpdir();
    const tempFramePath = path.join(tempDir, `frame_${Date.now()}.png`);
    
    // Extract a frame from the video using standard FFmpeg command
    // This is more reliable than .screenshots()
    ffmpeg(videoPath)
      .outputOptions([
        '-ss', '00:00:01.000', // Seek to 1 second
        '-vframes', '1',        // Extract 1 frame
        '-vf', 'scale=320:240'  // Scale to small size for faster processing
      ])
      .output(tempFramePath)
      .on('end', async () => {
        try {
          // Read the frame image and sample corner/edge pixels
          // For simplicity, we'll use a basic approach: sample corner regions
          // Use FFmpeg to extract corner pixel values
          const corners = [
            { x: 0, y: 0 },      // Top-left
            { x: 319, y: 0 },    // Top-right
            { x: 0, y: 239 },    // Bottom-left
            { x: 319, y: 239 }   // Bottom-right
          ];
          
          // Use FFmpeg to get pixel values from corners
          // Extract a 1x1 pixel from each corner
          const timestamp = Date.now();
          const pixelPromises = corners.map((corner, index) => {
            return new Promise((resolvePixel) => {
              const tempPixelPath = path.join(tempDir, `pixel_${timestamp}_${index}.raw`);
              ffmpeg(tempFramePath)
                .videoFilters(`crop=1:1:${corner.x}:${corner.y}`)
                .outputOptions([
                  '-pix_fmt', 'rgb24',
                  '-frames:v', '1',
                  '-f', 'rawvideo'
                ])
                .output(tempPixelPath)
                .on('end', () => {
                  try {
                    if (fs.existsSync(tempPixelPath)) {
                      const pixelData = fs.readFileSync(tempPixelPath);
                      if (pixelData.length >= 3) {
                        const r = pixelData[0];
                        const g = pixelData[1];
                        const b = pixelData[2];
                        fs.unlinkSync(tempPixelPath);
                        resolvePixel({ r, g, b });
                      } else {
                        if (fs.existsSync(tempPixelPath)) fs.unlinkSync(tempPixelPath);
                        resolvePixel(null);
                      }
                    } else {
                      resolvePixel(null);
                    }
                  } catch (err) {
                    try {
                      if (fs.existsSync(tempPixelPath)) fs.unlinkSync(tempPixelPath);
                    } catch (e) {}
                    resolvePixel(null);
                  }
                })
                .on('error', (err) => {
                  console.error(`Error extracting pixel at corner ${index}:`, err);
                  try {
                    if (fs.existsSync(tempPixelPath)) fs.unlinkSync(tempPixelPath);
                  } catch (e) {}
                  resolvePixel(null);
                })
                .run();
            });
          });
          
          const pixels = await Promise.all(pixelPromises);
          const validPixels = pixels.filter(p => p !== null);
          
          if (validPixels.length === 0) {
            // Fallback to default green
            fs.unlinkSync(tempFramePath);
            resolve('#00ff00');
            return;
          }
          
          // Find the pixel with highest green value (most likely green screen)
          let maxGreen = 0;
          let bestPixel = validPixels[0];
          for (const pixel of validPixels) {
            // Check if it's green-ish (green > red and green > blue)
            if (pixel.g > pixel.r && pixel.g > pixel.b && pixel.g > maxGreen) {
              maxGreen = pixel.g;
              bestPixel = pixel;
            }
          }
          
          // Convert to hex
          const hexColor = '#' + 
            bestPixel.r.toString(16).padStart(2, '0') +
            bestPixel.g.toString(16).padStart(2, '0') +
            bestPixel.b.toString(16).padStart(2, '0');
          
          // Clean up
          fs.unlinkSync(tempFramePath);
          resolve(hexColor);
        } catch (error) {
          console.error('Error detecting green color:', error);
          // Clean up on error
          try {
            if (fs.existsSync(tempFramePath)) {
              fs.unlinkSync(tempFramePath);
            }
          } catch (e) {}
          resolve('#00ff00'); // Fallback to default green
        }
      })
      .on('error', (err) => {
        console.error('Error extracting frame:', err);
        resolve('#00ff00'); // Fallback to default green
      })
      .run();
  });
});

ipcMain.handle('process-video', async (event, options) => {
  const { inputPath, outputPath, color, similarity, blend, edgeBlur } = options;

  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);
    
    // Determine output format based on file extension
    const isWebM = outputPath.toLowerCase().endsWith('.webm');
    const outputCodec = isWebM ? 'libvpx-vp9' : 'libx264';
    
    // Build filter chain using chromakey
    // Extract RGB values from color (for logging)
    const colorInt = parseInt(color.replace('0x', ''), 16);
    const r = (colorInt >> 16) & 0xFF;
    const g = (colorInt >> 8) & 0xFF;
    const b = colorInt & 0xFF;
    
    let filterString;
    
    if (isWebM) {
      // For WebM, use chromakey which supports transparency (alpha channel)
      let webmFilters = [`chromakey=${color}:${similarity}:${blend}`];
      
      // Add edge blur AFTER chromakey for smoother edges
      if (edgeBlur > 0) {
        webmFilters.push(`boxblur=${edgeBlur}:${edgeBlur}:chroma_power=1`);
      }
      
      // Join filters with comma for simple filter chain
      filterString = webmFilters.join(',');
    } else {
      // For MP4, composite keyed video onto black background
      // MP4/H.264 doesn't support transparency, so we overlay on black
      // Filter chain: [0:v]chromakey[fg]; color[bg]; scale2ref; overlay
      let mp4Filters = [];
      
      // Apply chromakey to input video and optionally blur, label as [fg]
      // [0:v] references the video stream from first input
      let foregroundFilter = `[0:v]chromakey=${color}:${similarity}:${blend}`;
      if (edgeBlur > 0) {
        foregroundFilter += `,boxblur=${edgeBlur}:${edgeBlur}:chroma_power=1`;
      }
      foregroundFilter += '[fg]';
      mp4Filters.push(foregroundFilter);
      
      // Create black background using color filter
      // Use size=2x2 and full parameter names for better compatibility
      mp4Filters.push(`color=c=black:size=2x2:rate=25[bgsrc]`);
      
      // Use scale2ref to scale background to match foreground dimensions
      // Output [bg] (scaled background) and [fg_scaled] (scaled foreground)
      // Do NOT reuse [fg] as output label to avoid conflicts
      mp4Filters.push(`[bgsrc][fg]scale2ref[bg][fg_scaled]`);
      
      // Overlay the scaled foreground on the background
      // shortest=1 ensures output stops when shortest input ends
      mp4Filters.push(`[bg][fg_scaled]overlay=shortest=1[out]`);
      
      // Join with semicolons for complex filter chain
      filterString = mp4Filters.join(';');
    }
    
    console.log('Applying filter chain:', filterString);
    console.log('Output format:', isWebM ? 'WebM' : 'MP4');
    console.log('Color values - R:', r, 'G:', g, 'B:', b);
    console.log('Similarity:', similarity, 'Blend:', blend);
    console.log('Input path:', inputPath);
    console.log('Output path:', outputPath);
    
    // Apply filters using -vf for simple chains, -filter_complex for complex chains
    if (isWebM) {
      command.outputOptions(['-vf', filterString]);
    } else {
      // Use -filter_complex for MP4 since we have multiple labeled inputs
      command.outputOptions(['-filter_complex', filterString]);
      // Map the filtered video output and original audio BEFORE setting codec
      // This ensures FFmpeg knows which streams to encode
      command.outputOptions(['-map', '[out]']);
      // Map audio if present (optional)
      command.outputOptions(['-map', '0:a?']);
    }
    
    // Set output options
    const outputOpts = ['-c:v', outputCodec];
    
    // Set pixel format - WebM supports transparency, MP4 needs yuv420p
    if (isWebM) {
      outputOpts.push('-pix_fmt', 'yuva420p');
    } else {
      // For MP4, use yuv420p (no transparency support)
      outputOpts.push('-pix_fmt', 'yuv420p');
    }
    
    command.outputOptions(outputOpts);

    // Audio and codec options
    if (isWebM) {
      // WebM specific options for transparency
      command.outputOptions([
        '-c:a', 'libopus',  // Opus audio codec for WebM
        '-b:a', '192k',
        '-auto-alt-ref', '0',
        '-lag-in-frames', '0'
      ]);
    } else {
      // H.264 doesn't support transparency, green will be replaced with black
      // For true transparency, user should use WebM format
      command.outputOptions([
        '-c:a', 'aac',
        '-b:a', '192k'
      ]);
    }

    // Add additional options to ensure chromakey works correctly
    command.outputOptions([
      '-avoid_negative_ts', 'make_zero',
      '-fflags', '+genpts'
    ]);
    
    command
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg process started:', commandLine);
        console.log('Filter chain:', filterString);
        console.log('Color:', color, 'Similarity:', similarity, 'Blend:', blend);
        event.sender.send('process-progress', { status: 'started', percent: 0 });
      })
      .on('progress', (progress) => {
        const percent = progress.percent || 0;
        event.sender.send('process-progress', {
          status: 'processing',
          percent: Math.min(percent, 99), // Cap at 99% until end
          time: progress.timemark
        });
      })
      .on('end', () => {
        console.log('FFmpeg process completed');
        event.sender.send('process-progress', { status: 'completed', percent: 100 });
        resolve({ success: true, outputPath });
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err);
        console.error('FFmpeg stderr:', stderr);
        console.error('FFmpeg stdout:', stdout);
        const errorMessage = stderr || err.message || 'Unknown FFmpeg error';
        event.sender.send('process-progress', { status: 'error', error: errorMessage });
        reject(new Error(errorMessage));
      })
      .run();
  });
});
