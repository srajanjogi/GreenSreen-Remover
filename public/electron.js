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
  
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
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
    const os = require('os');
    const tempDir = os.tmpdir();
    const tempFramePath = path.join(tempDir, `frame_${Date.now()}.png`);
    
    // Extract a frame from the middle of the video (1 second in, or middle if video is short)
    // Sample pixels from corners and edges where green screen typically is
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01.000'], // 1 second into video
        filename: path.basename(tempFramePath),
        folder: path.dirname(tempFramePath),
        size: '320x240' // Small size for faster processing
      })
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
          const timestamp = Date.now();
          const pixelPromises = corners.map((corner, index) => {
            return new Promise((resolvePixel) => {
              const tempPixelPath = path.join(tempDir, `pixel_${timestamp}_${index}.raw`);
              ffmpeg(tempFramePath)
                .videoFilters(`crop=1:1:${corner.x}:${corner.y}`)
                .format('rawvideo')
                .outputOptions(['-pix_fmt', 'rgb24', '-frames:v', '1'])
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
                .on('error', () => {
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
    const pixelFormat = isWebM ? 'yuva420p' : 'yuv420p';
    
    // Build chromakey filter string
    // FFmpeg chromakey filter: chromakey=color:similarity:blend
    const chromakeyFilter = `chromakey=${color}:${similarity}:${blend}`;
    
    // Build filters array - chromakey first, then blur if needed
    let filters = [chromakeyFilter];
    
    // Add edge blur AFTER chromakey for better results
    if (edgeBlur > 0) {
      filters.push(`boxblur=${edgeBlur}:${edgeBlur}:chroma_power=1`);
    }

    // Apply filters
    command.videoFilters(filters);
    
    // Set output options
    const outputOpts = ['-c:v', outputCodec];
    
    // Set pixel format - WebM supports transparency, MP4 needs yuv420p
    if (isWebM) {
      outputOpts.push('-pix_fmt', 'yuva420p');
    } else {
      // For MP4, we can't have transparency, but chromakey will still work
      // The removed areas will appear black/transparent in players that support it
      // Or we could use format filter to add black background
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

    command
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg process started:', commandLine);
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
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        event.sender.send('process-progress', { status: 'error', error: err.message });
        reject(err);
      })
      .run();
  });
});
