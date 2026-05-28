# webcam-stream

Continuously captures a web page with headless Chromium (via Puppeteer) and streams it live to **YouTube** and **Twitch** simultaneously using FFmpeg's `tee` muxer — encoding once, pushing to both destinations.

```
Chromium (CDP screencast)
       │ JPEG frames
       ▼
  stream.js (Node.js)
       │ stdin pipe
       ▼
    FFmpeg
       ├─► rtmp://a.rtmp.youtube.com/live2/<key>
       └─► rtmp://live.twitch.tv/app/<key>
```

---

## Prerequisites

Tested on **Ubuntu 22.04 / 24.04 LTS**.

### 1 — Install Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x or higher
```

### 2 — Install FFmpeg

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
ffmpeg -version | head -1
```

### 3 — Install Xvfb (virtual framebuffer for headless environments)

```bash
sudo apt-get install -y xvfb
```

### 4 — Install Chromium (optional — Puppeteer bundles its own)

If your VPS is resource-constrained or you prefer the system Chromium:

```bash
sudo apt-get install -y chromium-browser
# Then set CHROMIUM_PATH=/usr/bin/chromium-browser in your .env
```

Otherwise Puppeteer downloads a compatible build automatically during `npm install`.

---

## Setup

### 1 — Clone / copy the files

```bash
sudo mkdir -p /opt/webcam-stream
sudo cp -r stream/* /opt/webcam-stream/
# or clone the full repo and cd into the stream/ subdirectory
```

### 2 — Create a dedicated system user

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin streamer
sudo chown -R streamer:streamer /opt/webcam-stream
```

### 3 — Install Node dependencies

```bash
cd /opt/webcam-stream
sudo -u streamer npm install --omit=dev
```

> Puppeteer will download a compatible Chromium binary here (~170 MB).  
> Pass `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` if you want to use the system binary instead.

### 4 — Configure environment variables

```bash
cd /opt/webcam-stream
sudo -u streamer cp .env.example .env
sudo -u streamer nano .env          # or your editor of choice
```

At minimum you must set:

| Variable | Where to find it |
|---|---|
| `YOUTUBE_KEY` | YouTube Studio → Go Live → Stream key |
| `TWITCH_KEY`  | Twitch Dashboard → Settings → Stream → Primary Stream key |
| `TARGET_URL`  | The URL you want to broadcast (default: `https://your-website.com`) |

All other variables have sensible defaults (1280×720, 10 fps, CRF 28).

### 5 — Test the stream manually

```bash
cd /opt/webcam-stream
sudo -u streamer bash start-stream.sh
```

Watch the terminal — you should see `Screencast started` then frame heartbeat lines every 5 minutes.  
Open YouTube Studio / Twitch Dashboard and check that your stream is live.

Press **Ctrl-C** to stop.

---

## Run as a systemd service (auto-start on boot)

### Install the service file

```bash
sudo cp /opt/webcam-stream/webcam-stream.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### Enable and start

```bash
sudo systemctl enable webcam-stream   # start on boot
sudo systemctl start  webcam-stream   # start now
```

### Check status and logs

```bash
# Live status
sudo systemctl status webcam-stream

# Follow journal logs
sudo journalctl -u webcam-stream -f

# Tail the flat log file
sudo tail -f /var/log/webcam-stream.log
```

### Stop / restart

```bash
sudo systemctl stop    webcam-stream
sudo systemctl restart webcam-stream
```

---

## Environment variable reference

| Variable | Default | Description |
|---|---|---|
| `YOUTUBE_KEY` | *(required)* | YouTube live stream key |
| `TWITCH_KEY` | *(required)* | Twitch stream key |
| `TARGET_URL` | `https://your-website.com` | Page to capture |
| `WIDTH` | `1280` | Capture / stream width (px) |
| `HEIGHT` | `720` | Capture / stream height (px) |
| `FPS` | `10` | Frames per second (10 is plenty for a webpage; raise for video-heavy pages) |
| `JPEG_QUALITY` | `80` | Chrome screencast JPEG quality 1–100 |
| `CRF` | `28` | H.264 CRF (18–51; lower = better quality + higher bitrate) |
| `AUDIO_BITRATE` | `128k` | AAC audio bitrate |
| `RECONNECT_DELAY_MS` | `5000` | Milliseconds to wait before restarting after a crash |
| `PAGE_TIMEOUT_MS` | `30000` | Navigation timeout |
| `CHROMIUM_PATH` | *(Puppeteer bundled)* | Override path to a system Chromium binary |
| `LOG_FILE` | `/var/log/webcam-stream.log` | Absolute path to the flat log file |
| `DISPLAY_NUM` | `99` | Xvfb display number (used by `start-stream.sh`) |

---

## Architecture notes

- **Single encode, dual output** — FFmpeg's `tee` muxer encodes the H.264+AAC stream once and pushes the identical MPEG-TS/FLV packets to both RTMP endpoints. This halves CPU usage vs. two separate FFmpeg processes.
- **Back-pressure** — The CDP `Page.screencastFrameAck` handshake is sent immediately so Chrome never stalls, but the Node write loop waits for FFmpeg's stdin `drain` event if FFmpeg can't keep up.
- **Auto-restart** — Both `stream.js` (inner loop) and `start-stream.sh` (outer loop) restart on any crash. The systemd `Restart=always` policy adds a third layer for OS-level failures.
- **No audio capture** — Web-page audio capture through headless Chrome requires additional flags and is unreliable on a VPS. A silent `anullsrc` stream keeps YouTube/Twitch happy. If you need real audio, replace the `anullsrc` input with `-f pulse -i default` (PulseAudio).

---

## Troubleshooting

**`YOUTUBE_KEY / TWITCH_KEY is not set`**  
→ Make sure `/opt/webcam-stream/.env` exists and contains both keys. The systemd `EnvironmentFile=` directive reads this file; it must be readable by the `streamer` user.

**`Failed to load page: Navigation timeout`**  
→ The target URL took longer than `PAGE_TIMEOUT_MS` to load. Increase the value or check connectivity from the VPS.

**FFmpeg exits immediately with `Connection refused`**  
→ Double-check your stream keys. YouTube keys are invalidated after 12 hours of inactivity; generate a new one in YouTube Studio.

**High CPU usage**  
→ Lower `FPS` (try `5`) or raise `CRF` (try `32`). `veryfast` preset already trades quality for speed.

**Black screen / blank stream**  
→ The page may rely on JavaScript that's blocked in headless mode. Add `--disable-web-security` is already included; try also setting `CHROMIUM_PATH` to a full (non-headless) Chrome install.
