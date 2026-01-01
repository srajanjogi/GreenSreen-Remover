import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [videoPath, setVideoPath] = useState(null);
  const [originalVideoPath, setOriginalVideoPath] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ status: '', percent: 0 });
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [settings, setSettings] = useState({
    color: '#00ff00',
    strength: 30, // 0-100 range (maps to similarity 0.4-0.01, higher = more aggressive keying)
    edgeBlur: 0 // 0-100 range
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const videoRef = useRef(null);

  useEffect(() => {
    // Listen for progress updates
    if (window.electronAPI) {
      window.electronAPI.onProcessProgress((data) => {
        setProgress(data);
        if (data.status === 'completed' || data.status === 'error') {
          setProcessing(false);
        }
      });
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeProcessProgressListener();
      }
    };
  }, []);

  const handleSelectVideo = async () => {
    if (!window.electronAPI) {
      alert('Electron API not available');
      return;
    }

    const filePath = await window.electronAPI.selectVideoFile();
    if (filePath) {
      setVideoPath(filePath);
      setOriginalVideoPath(filePath);
      setIsPreviewMode(false);
      // Get video URL using IPC (which will use the custom protocol)
      const url = await window.electronAPI.getVideoUrl(filePath);
      setVideoUrl(url);
      
      // Automatically detect green screen color
      try {
        const detectedColor = await window.electronAPI.detectGreenColor(filePath);
        if (detectedColor) {
          setSettings(prev => ({
            ...prev,
            color: detectedColor
          }));
        }
      } catch (error) {
        console.error('Error detecting green color:', error);
        // Continue with default color if detection fails
      }
    }
  };

  const processVideoToPath = async (inputPath, outputPath, isPreview = false) => {
    setProcessing(true);
    setProgress({ status: 'starting', percent: 0 });

    try {
      // Convert hex color to 0xRRGGBB format for FFmpeg
      const hex = settings.color.replace('#', '');
      const colorValue = `0x${hex}`;

      // Convert strength (0-100) to similarity (0.01-0.4) for FFmpeg
      // Higher strength = higher similarity = stronger keying
      // Map: strength 0 -> similarity 0.01, strength 100 -> similarity 0.4
      const similarity = 0.01 + (settings.strength / 100) * 0.39;
      
      // Convert edgeBlur (0-100) to actual blur value (0-10) for FFmpeg
      const edgeBlur = settings.edgeBlur / 10;

      // Set blend value - lower values work better for chromakey
      // Blend controls spill suppression, typically 0.1-0.2 works well
      const blend = 0.1;

      await window.electronAPI.processVideo({
        inputPath: inputPath,
        outputPath: outputPath,
        color: colorValue,
        similarity: similarity,
        blend: blend,
        edgeBlur: edgeBlur
      });

      // Only update the preview if this is a preview operation
      // For exports, keep the current preview (if any) to avoid switching back to original
      if (isPreview) {
        const processedVideoUrl = await window.electronAPI.getVideoUrl(outputPath);
        setVideoUrl(processedVideoUrl);
        setIsPreviewMode(true);
        
        // Force video element to reload with the new source
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, 100);
      }
      // For exports, don't change the videoUrl - keep showing the preview if it exists
    } catch (error) {
      console.error('Processing error:', error);
      alert(`Error processing video: ${error.message}`);
      throw error;
    } finally {
      setProcessing(false);
    }
  };

  const handlePreview = async () => {
    const inputPath = originalVideoPath || videoPath;
    if (!inputPath || !window.electronAPI) {
      alert('Please select a video first');
      return;
    }

    try {
      // Get a temporary file path for preview
      const tempPath = await window.electronAPI.getTempVideoPath();
      await processVideoToPath(inputPath, tempPath, true);
    } catch (error) {
      // Error already handled in processVideoToPath
    }
  };

  const handleExport = async () => {
    const inputPath = originalVideoPath || videoPath;
    if (!inputPath || !window.electronAPI) {
      alert('Please select a video first');
      return;
    }

    const outputPath = await window.electronAPI.saveVideoFile();
    if (!outputPath) {
      return;
    }

    try {
      await processVideoToPath(inputPath, outputPath, false);
      alert('Video exported successfully!');
    } catch (error) {
      // Error already handled in processVideoToPath
    }
  };

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  return (
    <div className="App">
      <div className="container">
        <div className="content">
          <div className="upload-section">
            <div className="video-preview">
              {videoUrl ? (
                <video
                  key={videoUrl}
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="preview-video"
                />
              ) : (
                <div className="upload-placeholder">
                  <div className="upload-icon">📹</div>
                  <p>No video selected</p>
                  <button className="btn btn-primary" onClick={handleSelectVideo}>
                    Select Video File
                  </button>
                </div>
              )}
            </div>

            {videoUrl && (
              <div className="video-controls">
                <button className="btn btn-new-video" onClick={handleSelectVideo}>
                  <span className="btn-icon">↑</span> New Video
                </button>
                <button 
                  className="btn btn-preview" 
                  onClick={handlePreview}
                  disabled={!originalVideoPath || processing}
                >
                  {processing && isPreviewMode ? `Previewing... ${progress.percent?.toFixed(0) || 0}%` : 'Preview'}
                </button>
                <button 
                  className="btn btn-export" 
                  onClick={handleExport}
                  disabled={!originalVideoPath || processing}
                >
                  <span className="btn-icon">↓</span> {processing && !isPreviewMode ? `Exporting... ${progress.percent?.toFixed(0) || 0}%` : 'Export'}
                </button>
              </div>
            )}
          </div>

          <div className="settings-section">
            <div className="chroma-key-header">
              <span className="checkmark">✓</span>
              <h2>Chroma key</h2>
            </div>
            
            <div className="setting-group">
              <label htmlFor="color">
                <div className="label-with-icon">
                  <span className="icon-picker">🎨</span>
                  Color picker
                </div>
                <div className="color-picker-container">
                  <input
                    type="color"
                    id="color"
                    value={settings.color}
                    onChange={(e) => handleSettingChange('color', e.target.value)}
                    disabled={processing}
                    className="color-input"
                  />
                  <span className="color-display" style={{ backgroundColor: settings.color }}></span>
                </div>
                <span className="setting-hint">*First pick the color of the screen, then adj...</span>
              </label>
            </div>

            <div className="setting-group">
              <label htmlFor="strength">
                <div className="label-row">
                  <span>Strength</span>
                  <span className="value-display">{Math.round(settings.strength)}</span>
                </div>
                <input
                  type="range"
                  id="strength"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.strength}
                  onChange={(e) => handleSettingChange('strength', parseInt(e.target.value))}
                  disabled={processing}
                  className="slider"
                />
              </label>
            </div>

            <div className="setting-group">
              <label htmlFor="edgeBlur">
                <div className="label-row">
                  <span>Edge Blur</span>
                  <span className="value-display">{Math.round(settings.edgeBlur)}</span>
                </div>
                <input
                  type="range"
                  id="edgeBlur"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.edgeBlur}
                  onChange={(e) => handleSettingChange('edgeBlur', parseInt(e.target.value))}
                  disabled={processing}
                  className="slider"
                />
              </label>
            </div>

            <button 
              className="btn-advanced"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span className="icon-plus">{showAdvanced ? '−' : '+'}</span>
              Advanced Settings
            </button>

            {processing && (
              <div className="progress-info">
                <p>Status: {progress.status}</p>
                {progress.percent > 0 && (
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
