'use strict';

require('dotenv').config();

const puppeteer = require('puppeteer');
const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

const TARGET_URL          = process.env.TARGET_URL          || 'https://your-website.com';
const YOUTUBE_KEY         = process.env.YOUTUBE_KEY;
const TWITCH_KEY          = process.env.TWITCH_KEY;
const FPS                 = parseInt(process.env.FPS          || '10',   10);
const WIDTH               = parseInt(process.env.WIDTH        || '1280', 10);
const HEIGHT              = parseInt(process.env.HEIGHT       || '720',  10);
const JPEG_QUALITY        = parseInt(process.env.JPEG_QUALITY || '80',   10);
const CRF                 = process.env.CRF                  || '28';
const AUDIO_BITRATE       = process.env.AUDIO_BITRATE        || '128k';
const LOG_FILE            = process.env.LOG_FILE             || '/var/log/webcam-stream.log';
const RECONNECT_DELAY_MS  = parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10);
const PAGE_TIMEOUT_MS     = parseInt(process.env.PAGE_TIMEOUT_MS    || '30000', 10);
const CHROMIUM_PATH       = process.env.CHROMIUM_PATH        || undefined;

// ─── Logging ──────────────────────────────────────────────────────────────────

let logFileStream;
try {
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  logFileStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
} catch (e) {
  // If we can't write the log file (e.g. no /var/log perms in dev), fall back
  // to a local file so the rest of the process still works.
  logFileStream = fs.createWriteStream(path.join(__dirname, 'stream.log'), { flags: 'a' });
  process.stderr.write(`[WARN] Cannot write to ${LOG_FILE}: ${e.message}. Using ./stream.log\n`);
}

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] ${msg}`;
  process.stdout.write(line + '\n');
  logFileStream.write(line + '\n');
}

const info  = msg => log('INFO',  msg);
const warn  = msg => log('WARN',  msg);
const error = msg => log('ERROR', msg);

// ─── Guard: required env ──────────────────────────────────────────────────────

if (!YOUTUBE_KEY) { error('YOUTUBE_KEY env variable is not set. Exiting.'); process.exit(1); }
if (!TWITCH_KEY)  { error('TWITCH_KEY env variable is not set. Exiting.');  process.exit(1); }

// ─── FFmpeg ───────────────────────────────────────────────────────────────────

/**
 * Spawns FFmpeg with:
 *   - JPEG frames read from stdin (image2pipe / mjpeg codec)
 *   - Silent audio from lavfi anullsrc
 *   - H.264 + AAC encoding
 *   - Tee muxer duplicating the output to both RTMP endpoints (encode once)
 *
 * @returns {ChildProcess}
 */
function spawnFFmpeg() {
  const youtubeRtmp = `rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_KEY}`;
  const twitchRtmp  = `rtmp://live.twitch.tv/app/${TWITCH_KEY}`;
  const teeTarget   = `[f=flv]${youtubeRtmp}|[f=flv]${twitchRtmp}`;

  const args = [
    // ── Input 0: JPEG frames piped from Puppeteer screencast ──────────────────
    '-f',        'image2pipe',
    '-vcodec',   'mjpeg',
    '-framerate', String(FPS),
    '-i',        'pipe:0',

    // ── Input 1: silent stereo audio (required by YouTube/Twitch) ─────────────
    '-f',   'lavfi',
    '-i',   'anullsrc=channel_layout=stereo:sample_rate=44100',

    // ── Encoding ──────────────────────────────────────────────────────────────
    '-c:v',      'libx264',
    '-preset',   'veryfast',
    '-tune',     'zerolatency',
    '-crf',       CRF,
    '-pix_fmt',  'yuv420p',
    '-r',         String(FPS),
    '-g',         String(FPS * 2),   // keyframe every 2 s
    '-c:a',      'aac',
    '-b:a',       AUDIO_BITRATE,
    '-ar',       '44100',

    // ── Map video from input 0, audio from input 1 ────────────────────────────
    '-map', '0:v',
    '-map', '1:a',

    // ── Tee to both RTMP destinations (single encode, two outputs) ────────────
    '-f',   'tee',
    teeTarget,
  ];

  info(`Spawning FFmpeg → YouTube + Twitch  (${WIDTH}x${HEIGHT} @ ${FPS} fps, CRF ${CRF})`);
  info(`  YouTube: ${youtubeRtmp.replace(YOUTUBE_KEY, '****')}`);
  info(`  Twitch : ${twitchRtmp.replace(TWITCH_KEY,  '****')}`);

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  proc.on('error', err => error(`FFmpeg spawn error: ${err.message}`));
  proc.on('close', code => {
    if (code !== 0) warn(`FFmpeg exited with code ${code}`);
  });

  return proc;
}

// ─── Single streaming session ─────────────────────────────────────────────────

async function stream() {
  info(`Launching Chromium — target: ${TARGET_URL}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  // ── Navigate ────────────────────────────────────────────────────────────────
  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
    info('Page loaded successfully');
  } catch (err) {
    error(`Page load failed: ${err.message}`);
    await browser.close().catch(() => {});
    throw err;
  }

  // ── Start FFmpeg ─────────────────────────────────────────────────────────────
  const ffmpeg = spawnFFmpeg();

  let frameCount = 0;
  let active = true;

  // ── Graceful shutdown handler ────────────────────────────────────────────────
  const shutdown = async (signal) => {
    if (!active) return;
    active = false;
    info(`Received ${signal} — shutting down`);
    try { await cdp.send('Page.stopScreencast'); } catch {}
    if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
    await browser.close().catch(() => {});
    process.exit(0);
  };

  process.once('SIGINT',  () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // ── Start CDP screencast (JPEG frames from Chrome) ───────────────────────────
  const cdp = await page.createCDPSession();
  await cdp.send('Page.startScreencast', {
    format:        'jpeg',
    quality:        JPEG_QUALITY,
    maxWidth:       WIDTH,
    maxHeight:      HEIGHT,
    everyNthFrame:  1,
  });

  info(`Screencast started (${JPEG_QUALITY}% JPEG quality)`);

  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    // Acknowledge immediately so Chrome keeps sending frames
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});

    if (!active) return;

    if (!ffmpeg.stdin.writable) {
      if (active) {
        active = false;
        warn('FFmpeg stdin closed — tearing down this session');
        try { await cdp.send('Page.stopScreencast'); } catch {}
        await browser.close().catch(() => {});
      }
      return;
    }

    const buf = Buffer.from(data, 'base64');
    const ok  = ffmpeg.stdin.write(buf);
    frameCount++;

    // Log heartbeat every 5 minutes (at the given FPS)
    if (frameCount % (FPS * 300) === 0) {
      info(`Streaming — frame ${frameCount} (~${Math.round(buf.length / 1024)} KB/frame)`);
    }

    if (!ok) {
      // Back-pressure: pause until FFmpeg stdin drains
      await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    }
  });

  // ── Handle unexpected FFmpeg exit ─────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    ffmpeg.on('close', async (code) => {
      if (!active) { resolve(); return; }
      active = false;
      error(`FFmpeg closed unexpectedly (code ${code})`);
      try { await cdp.send('Page.stopScreencast'); } catch {}
      await browser.close().catch(() => {});
      reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

// ─── Entry point with auto-restart ───────────────────────────────────────────

(async function main() {
  info('='.repeat(60));
  info('webcam-stream starting');
  info(`  URL    : ${TARGET_URL}`);
  info(`  Size   : ${WIDTH}x${HEIGHT}  FPS: ${FPS}`);
  info(`  Log    : ${LOG_FILE}`);
  info('='.repeat(60));

  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts++;
    info(`Attempt ${attempts}: launching stream session`);
    try {
      await stream();
      // stream() only returns if FFmpeg exits cleanly after a shutdown signal —
      // in which case process.exit(0) was already called.
    } catch (err) {
      error(`Session ${attempts} failed: ${err.message}`);
    }
    info(`Waiting ${RECONNECT_DELAY_MS / 1000}s before next attempt…`);
    await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
  }
}());
