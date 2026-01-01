# Green Screen Remover

A desktop application built with Electron, React, and FFmpeg to remove green screen backgrounds from videos using chroma key technology.

## Features

- 🎬 Remove green screen backgrounds from videos
- 🎨 Adjustable chroma key settings (color, similarity, blend, edge blur)
- 📹 Support for multiple video formats (MP4, MOV, AVI, MKV, WebM)
- 🎯 Real-time video preview
- 💾 Export in MP4 or WebM format (WebM supports transparency)
- 🚀 Fast processing with FFmpeg

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v16 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

## Usage

### Development Mode

To run the application in development mode:

```bash
npm run dev:electron
```

This will:
- Start the Vite development server (port 5173)
- Launch the Electron app
- Enable hot-reloading for development

Or run them separately:

```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Electron
npm run electron-dev
```

### Production Build

To build and run the production version:

```bash
npm run build
npm run electron
```

### Package for Distribution

To create a distributable package:

```bash
npm run electron-pack
```

## How to Use

1. **Select a Video**: Click "Select Video File" to choose a video with a green screen background
2. **Adjust Settings**:
   - **Green Screen Color**: Pick the color of your green screen (default: #00ff00)
   - **Similarity**: Adjust how similar colors should be to the key color (0-1)
   - **Blend**: Control spill suppression amount (0-1)
   - **Edge Blur**: Add blur for smoother edges (0-10)
3. **Process Video**: Click "Process Video" and choose where to save the output
4. **Export Format**: 
   - Choose **WebM** for transparent backgrounds (best for web use)
   - Choose **MP4** for compatibility (note: MP4 doesn't support transparency well, green will be replaced with black)

## Tips for Best Results

- Use a bright, evenly lit green screen background
- Avoid shadows and wrinkles on the green screen
- Keep subjects away from the green screen to reduce spill
- Higher resolution videos (1080p, 4K) produce better results
- For transparency, always export as WebM format

## Technical Details

- **Electron**: Cross-platform desktop app framework
- **React**: UI library for building the interface
- **Vite**: Fast build tool and dev server
- **FFmpeg**: Video processing library for chroma key removal
- **fluent-ffmpeg**: Node.js wrapper for FFmpeg

## Project Structure

```
GreenScreen/
├── public/
│   ├── electron.js      # Main Electron process
│   ├── preload.js       # Preload script for secure IPC
│   └── index.html       # HTML template
├── src/
│   ├── App.js           # Main React component
│   ├── App.css          # Styles
│   ├── index.js         # React entry point
│   └── index.css        # Global styles
├── package.json         # Project dependencies and scripts
└── README.md           # This file
```

## Troubleshooting

### FFmpeg not found

If you encounter FFmpeg errors:
- The app uses `ffmpeg-static` which bundles FFmpeg automatically
- If issues persist, ensure FFmpeg is installed on your system

### Video processing fails

- Ensure your video file is not corrupted
- Check that you have enough disk space for the output file
- Try adjusting the similarity and blend settings

### Transparency not working

- Make sure you're exporting as **WebM** format
- MP4/H.264 doesn't support transparency (alpha channel)
- Use WebM VP9 codec for true transparency

## License

MIT

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Video processing powered by [FFmpeg](https://ffmpeg.org/)
- Inspired by online green screen removal tools
