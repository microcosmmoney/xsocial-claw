# 🦞 xSocial Claw

<p align="center">
  <img src="logo.svg" alt="xSocial Claw" width="300">
</p>

<p align="center">
  <b>Chrome Lobster Extension — Refined from OpenClaw</b><br>
  AI-Powered Social Media Automation
</p>

<p align="center">
  <a href="https://xsocial.cc">Website</a> ·
  <a href="https://xsocial.cc/extension/latest">Download</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#installation">Installation</a>
</p>

---

## What is xSocial Claw?

xSocial Claw is a refined and streamlined version built on top of [OpenClaw](https://github.com/anthropics/openclaw). We've distilled the core essence of OpenClaw, removed the unnecessary complexity, and created a leaner, more efficient mini-lobster with less code and higher performance.

## Architecture

```
┌─────────────────────┐         WebSocket          ┌─────────────────────┐
│   Chrome Browser     │  ◄═══════════════════════►  │   xSocial Server     │
│                     │                             │                     │
│   🦞 Lobster Claws   │    Commands / Results       │   🧠 Lobster Brain    │
│                     │                             │                     │
│   · Page perception  │                             │   · AI analysis      │
│   · Click / Type     │                             │   · Social mgmt     │
│   · Scroll / Navigate│                             │   · Human simulation │
│   · Data collection  │                             │   · Task scheduling  │
└─────────────────────┘                             └─────────────────────┘
```

**Browser = Lobster's Claws**: Perceives page content and executes actions (click, type, scroll)

**xSocial = Lobster's Brain**: AI analysis, social circle management, human behavior simulation, interaction decisions

Brain sends commands → Claws execute → Results fed back → Brain decides next action — a complete intelligent loop.

## Features

| Feature | Description |
|---------|-------------|
| 🔄 Auto Browse | Browse Twitter timeline with AI content summary |
| 👤 Identity Detection | Automatically identifies the current Twitter account |
| 🔌 Plug & Play | Reinstall auto-recovery, no reconfiguration needed |
| 🌙 Dark Mode | Light / Dark / Follow System — three theme modes |
| 📊 Task Tracking | Real-time step progress + history records |
| 🔐 Fully Open Source | Transparent code, auditable by anyone |

## Installation

### Option 1: Download Pre-built Package (Recommended)

1. Visit [xsocial.cc](https://xsocial.cc), sign in and go to "My Accounts"
2. Click the "Download Extension" tab
3. Download the latest .zip package
4. Unzip to a permanent folder (don't delete it)
5. Go to `chrome://extensions` in Chrome, enable "Developer mode"
6. Click "Load unpacked" and select the unzipped folder
7. Click the extension icon and sign in with your xSocial account

### Option 2: Build from Source

```bash
git clone https://github.com/XIYOUDADI/xsocial-claw.git
cd xsocial-claw
npm install
npm run build
```

The `dist/` directory is the loadable extension. Follow steps 5-7 above.

## Tech Stack

- Chrome Manifest V3
- React 19 + TypeScript
- Tailwind CSS 3.4
- Webpack 5
- WebSocket (persistent connection)

## Security

- ✅ Runs locally in your browser — **no passwords or sensitive data uploaded**
- ✅ All operations execute locally; the server only sends task instructions
- ✅ Fully open source — anyone can audit the code
- ✅ Communication secured with HMAC-SHA256 signed token authentication

## License

[MIT License](LICENSE)

---

<p align="center">
  <b>Powered by <a href="https://github.com/anthropics/openclaw">OpenClaw</a></b> · Built with ❤️ by <a href="https://xsocial.cc">xSocial</a>
</p>
