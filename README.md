# Agent HQ

A small company of AI agents that runs inside Claude Code, with a live office floor you can watch in the browser.

- **31 agents**: a Chief of Staff plus 8 teams (Research, Scripts, Social, Analytics, Shop, Dev, Inbox, Creative), each with a lead and members.
- **Office MCP server**: the shared tools every agent uses (brain, task board, approval queue, video editing).
- **Brain**: plain Markdown files in `brain/` where agents read the brand rules and write their findings.
- **Task board**: every job an agent takes on, with status and output.
- **Approval queue**: anything that leaves the office (email, posts, publishing, deploys, paid AI video) waits here until you approve it.
- **Dashboard**: a pixel-art office floor showing who is working, the board, the approval queue and a command bar to talk to the Chief.

## How it fits together

```
you ──> dashboard command bar / npm run ask / npm run chief
          │
          ▼
   Chief of Staff (Claude Code, headless)
          │ routes jobs to team leads
          ▼
   team leads ──> spawn members in parallel
          │
          ├─ office MCP server: brain, tasks, approvals, media (ffmpeg, Whisper, Pillow)
          ├─ integration MCP servers: GitHub, Drive, Calendar, Gmail, Slack, shop, analytics (live or mock)
          └─ hooks write every tool call to SQLite ──> dashboard tails it and draws the floor
                                                         │
                                         you approve/reject ──> execute() runs the real action
```

Key folders:

```
.claude/agents/      generated agent definitions (do not edit by hand; run npm run agents)
.claude/settings.json  permissions (allow / ask / deny) and hooks
.mcp.json            the MCP servers Claude Code starts
brain/               shared memory: company/ (brand, voice, niche) and one folder per team
office/src/
  org.ts             the org chart: every team and agent (single source of truth)
  gen-agents.ts      turns org.ts into .claude/agents/*.md
  server.ts          the "office" MCP server
  integrations.ts    GitHub/Google/Slack/shop/analytics servers and the approval executor
  media.ts           ffmpeg / Whisper / thumbnail pipeline
  higgsfield.ts      Higgsfield AI video client (runs only after approval); catalog in higgsfield-models.ts
  chief.ts           runs the Chief of Staff headless
  labels.ts          speech-bubble text for each tool on the dashboard
office/scripts/      thumbnail.py (Pillow)
office/test/         tests (npm test)
hooks/emit.ts        Claude Code hook that records events
dashboard/server/    Express + WebSocket backend
dashboard/web/       React + Vite office floor
data/                SQLite database and outbox (not committed)
media/               clips, outputs, music, published files (not committed)
```

## Requirements

- **Node.js 22.18 or newer** (runs the TypeScript directly, no build step for the server code).
- **ffmpeg with libass** (needed to burn captions in).
  - macOS: `brew install ffmpeg-full`. It is keg-only, so add it to your PATH, e.g. in `~/.zshrc`:
    `export PATH="/opt/homebrew/opt/ffmpeg-full/bin:$PATH"`
  - Linux: your distro's `ffmpeg` package usually includes libass.
  - Check: `ffmpeg -hide_banner -filters | grep -E " subtitles | ass "` must print two lines.
- **Python 3 with Pillow** (thumbnails): `python3 -m pip install --user pillow`
- **Claude Code CLI**, installed and logged in. Run `claude` once in this folder and accept the "trust this folder" prompt, otherwise headless runs refuse to start.

## Quick start

```bash
npm install
npm test             # runs everything in mock mode, about 30 s
npm run build        # builds the dashboard UI
npm run dashboard    # open http://127.0.0.1:4000
```

If port 4000 is busy: `PORT=4010 npm run dashboard`.

Type requests into the command bar at the top of the dashboard, for example:

- `Grab the 3 new clips from Drive and edit them in parallel`
- `Run the morning research scan`
- `Triage my inbox and draft replies`
- `Write two scripts from today's briefing`

You can also ask from the shell: `npm run ask -- "Run the morning research scan"`, or talk to the Chief interactively with `npm run chief`.

## Mock mode and live mode

With no keys, every integration runs in **mock mode** with realistic fake data (sample clips, emails, repos, orders), so the whole office works out of the box. Add keys to `.env` (copy `.env.example`) and that integration switches to **live**.

The switchboard in the dashboard Lobby shows each integration as live or mock. It only checks that the keys are present; it does not test them. Use the "Test your keys" commands below for that.

Shop and analytics are always mock for now.

## Getting your keys, step by step

Copy `.env.example` to `.env` and fill in what you want. Leave the rest empty. Restart the dashboard (and Claude Code) after changing `.env`.

### GitHub

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Repository access: **Public repositories (read-only)**. No extra permissions needed.
3. Put it in `GITHUB_TOKEN`.

### Google (Drive, Calendar, Gmail)

1. Go to https://console.cloud.google.com, create a project.
2. APIs & Services → Library: enable **Google Drive API**, **Google Calendar API** and **Gmail API**.
3. OAuth consent screen: choose External, fill in the app name and your email, and add **yourself as a Test user**.
4. Credentials → Create credentials → OAuth client ID → type **Web application**. Under Authorized redirect URIs add exactly:
   `https://developers.google.com/oauthplayground`
   Copy the client ID and secret.
5. Open https://developers.google.com/oauthplayground, click the gear icon, tick **Use your own OAuth credentials**, and paste the **same** client ID and secret.
6. In "Input your own scopes" paste:
   `https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose`
   Click Authorize APIs and sign in with your test user.
7. Click **Exchange authorization code for tokens** and copy the **refresh token**.
8. Fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
9. Optional: `DRIVE_FOLDER_ID` is the last part of a Drive folder's URL (`drive.google.com/drive/folders/<this part>`). Without it, only videos at the top level of My Drive are found.

### Slack

1. Go to https://api.slack.com/apps → Create New App → **From scratch** (blank app), pick your workspace.
2. OAuth & Permissions → Bot Token Scopes → add `chat:write`.
3. Click **Install to Workspace**, then copy the **Bot User OAuth Token**. It must start with `xoxb-`. Put it in `SLACK_BOT_TOKEN`.
4. Create a channel in Slack (e.g. `#agent-hq`) and type `/invite @Agent HQ` (your app's name) in it.
5. Right-click the channel → Copy link. The ID is the part after `/archives/` and starts with `C`. Put it in `SLACK_CHANNEL`.

### OpenAI (Whisper captions)

1. https://platform.openai.com → Billing: add credit. The smallest top-up ($5) is plenty; Whisper costs about $0.006 per minute of audio.
2. API keys → Create new secret key. It starts with `sk-proj-` or `sk-` (never `sk-ant-`, that is an Anthropic key).
3. Put it in `OPENAI_API_KEY`.

Without a key, Agent HQ uses a local `whisper` command if installed, or else the mock transcripts that ship with the sample clips.

### Optional settings

- `GMAIL_ALLOW_SEND=1`: approved emails are actually sent. Without it they land in Gmail Drafts.
- `WHISPER_MODEL`: model for the local whisper CLI (default `base`).
- `THUMBNAIL_PROVIDER`: leave empty for the local renderer (`canva` is a placeholder hook).
- `PYTHON`: Python to use for thumbnails (default `python3`).
- `CLAUDE_BIN`: path to the `claude` CLI (default `claude`).
- `OFFICE_DB`: where the SQLite database lives (default `data/office.db`).
- `PORT` / `HOST`: dashboard address (default `127.0.0.1:4000`).

## Test your keys

Run these from the repo folder. They read `.env` and print only a status, never a secret.

Google:
```bash
node --input-type=module -e "await import('./office/src/paths.ts'); const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})}); const j = await r.json(); console.log(r.status, j.error ?? 'OK - token works', j.scope ?? '')"
```

Slack (posts a test message to your channel, prints `true` on success):
```bash
node --input-type=module -e "await import('./office/src/paths.ts'); const r = await fetch('https://slack.com/api/chat.postMessage', {method:'POST', headers:{Authorization:'Bearer '+process.env.SLACK_BOT_TOKEN, 'Content-Type':'application/json; charset=utf-8'}, body: JSON.stringify({channel: process.env.SLACK_CHANNEL, text: 'Agent HQ test message'})}); console.log((await r.json()).ok)"
```

OpenAI:
```bash
node --input-type=module -e "await import('./office/src/paths.ts'); const r = await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY}}); console.log(r.status, r.ok ? 'OK - OpenAI key works' : (await r.json()).error?.code)"
```

Which integrations are live:
```bash
node -e "import('./office/src/integrations.ts').then(m=>console.table(m.integrationStatus()))"
```

## What happens when you approve

Agents can only *request* an action. When you click Approve in the dashboard:

| Kind | What happens |
|------|--------------|
| `purchase` (Higgsfield) | Uploads reference files, submits the generation, polls it in the background and downloads the result to `media/out/gen-<id>.*`. See [AI video](#ai-video-higgsfield). |
| `publish` | The video, thumbnail and captions are copied to `media/published/approval-<id>/`, ready to upload. |
| `email` | Gmail live: saved to Gmail Drafts. Sent only if `GMAIL_ALLOW_SEND=1`. |
| `post` / `schedule` | Calendar live: a Google Calendar reminder at the proposed time (no social network API is connected, you post it). |
| anything else | Recorded in `data/outbox.jsonl`. |

When Slack is live, every approval also sends a one-line ping to your channel.

## AI video (Higgsfield)

The Creative team can ask for AI-generated shots through [Higgsfield](https://higgsfield.ai). Agents can only *request* them; every shot is a `purchase` approval that you approve (and pay for) one by one.

**Setup.** Create a key at https://open.higgsfield.ai/api-keys, then put the complete copied key, as-is, in `.env`:

```
HF_API_KEY=<the whole key you copied>
HIGGSFIELD_MAX_USD_PER_DAY=10
```

The key stays on the server: it is read from `.env`, sent only to `api.higgsfield.ai` as `Authorization: Key <key>`, and never logged or shown in the dashboard. Agent HQ is a single-owner local app, so there is no per-user "connect your API key" screen; the `.env` key is the app's key. Without a key, Higgsfield runs in **mock mode**: approving renders a short local test-pattern clip (right length and aspect ratio) so you can try the whole flow for free.

**Ask the Chief**, for example: `Make a 15-second noir AI video about agent cost traps`. The video editor gets a shot list from Scripts/graphic designer, prefers animating a styled still (image to video) for the noir look, and files one approval per shot.

**The approval card** shows the model, the input (prompt, duration, aspect ratio, reference files), the estimated cost and whether the price is listed or estimated. After you approve: live status (submitting, queued, in progress, completed, failed, nsfw, canceled, unknown), the finished video or image, and a **Cancel generation** button while it runs. Higgsfield only accepts a cancel while the job is still queued.

**Cost controls.**
- `HIGGSFIELD_MAX_USD_PER_DAY` (default 10): an approval that would push today's estimated spend over the cap is refused (failed, NSFW-blocked and canceled ones don't count).
- Input is checked against the model's schema before the approval is filed, and again when you approve (in case you edited it).
- A submit is never blindly re-sent. If the network drops mid-submit it is resent once with the same `Idempotency-Key` (Higgsfield then returns the original request instead of charging again); if that fails too the generation is marked `unknown`: check your Higgsfield dashboard.
- Polling backs off from 2 s to 15 s and gives up after 20 minutes (status `unknown`). Generations still running when the dashboard restarts are picked up again.

Known prices (USD per second of output video, from the Higgsfield API pricing page; models without a clear match are estimated with `HIGGSFIELD_UNKNOWN_USD_PER_SEC`, default 0.40):

| Model | $/s | In catalog as |
|-------|-----|---------------|
| Seedance 2.5 text/image to video | 0.1758 | `seedance-2.5-t2v`, `seedance-2.5-i2v` |
| Seedance 2.5 reference to video / video edit | 0.2108 | `seedance-2.5-r2v` |
| Kling 3.0 4K | 0.357 | not mapped (no documented path found) |
| Kling 3.0 Pro | 0.1428 | `kling-3.0-pro-t2v` |
| Kling 3.0 Standard (image to video) | 0.1071 | `kling-3.0-std-i2v` |
| Kling 3.0 Turbo | 0.119 | `kling-3.0-turbo-i2v` |
| Happy Horse 1.1 | 0.153 | not mapped (docs page found is 1.0) |
| Seedance 2.0 text/image to video | 0.1197 | `seedance-2.0-t2v` |
| Seedance 2.0 reference to video | 0.1428 | not mapped |
| MiniMax H3 | 0.1105 | not mapped |

**What is not verified yet.** The docs sites (docs.higgsfield.ai, open.higgsfield.ai) could not be opened directly when this was built, so the catalog in `office/src/higgsfield-models.ts` was assembled from search-engine copies of those pages and the official JS SDK. Every entry is marked `verified: false` with its source page; check the Input JSON Schema there before relying on limits. Any other documented model path can still be requested (basic checks, estimated price). Live calls (auth, submit, status, cancel, file upload) have not been run against a real key. Webhooks are not used (this app has no public URL); it polls.

**Test your key.** There is no documented free "who am I" endpoint. This asks for the status of a made-up request: `401` means the key is wrong, `404` (or another non-401/403 answer) means the key was accepted. It prints no secret and costs nothing:

```bash
node --input-type=module -e "await import('./office/src/paths.ts'); const r = await fetch((process.env.HF_API_BASE_URL||'https://api.higgsfield.ai')+'/requests/00000000-0000-0000-0000-000000000000/status',{headers:{Authorization:'Key '+process.env.HF_API_KEY}}); console.log(r.status, r.status===401||r.status===403 ? 'key rejected' : 'key accepted')"
```

## Safety model

- Agents can only file approval requests. Only you decide, in the dashboard. Paid AI generation has no agent-side submit or upload tool, and a daily USD cap.
- `.claude/settings.json` denies network and publishing commands (curl, ssh, gh, npm publish, cloud CLIs, sending email, posting to Slack directly, editing `.env`) and asks before `git push` and Slack notifications.
- Each agent gets only the tools it needs (least privilege, defined in `office/src/org.ts`).
- Media tools only read and write inside `media/`.
- The dashboard binds to `127.0.0.1` only, because it can approve real actions. Do not expose it to a network.

## Add an agent

1. Add an entry to `AGENTS` in `office/src/org.ts`: `name`, `team`, `title`, `does`, `tools` (only what it needs), `never` (hard rules), and optionally `workflow` and `model`.
2. Run `npm run agents` to regenerate `.claude/agents/`.
3. Restart Claude Code and the dashboard. The new desk appears in its team's room automatically.
4. If you gave it new tools, add a speech-bubble label for them in `office/src/labels.ts`.
5. Tell its lead about it (in the lead's `workflow`) so it actually gets spawned.

## Add a team

1. Add an entry to `TEAMS` in `office/src/org.ts` with `id`, `name`, `room`, `lead` and `mission`, and add its agents to `AGENTS`.
2. Create `brain/<id>/README.md` describing what the team keeps there.
3. Add the lead to the Chief of Staff's routing table (its `workflow` in `org.ts`).
4. Give the team a room in `ROOMS` in `dashboard/web/src/Floor.tsx`. The floor has 8 team rooms, the Chief's office and the lobby around the central atrium, so a 9th team needs a layout change (for example replace the lobby or widen the grid).
5. Run `npm run agents`, `npm run build`, and restart.

## Design notes

- **SQLite via `node:sqlite`**: no native modules to compile.
- **Hooks**: Claude Code hooks (`hooks/emit.ts`) write every tool call and subagent start/stop to SQLite; the dashboard tails the table and pushes updates over WebSocket.
- **`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`**: in headless runs a lead would otherwise finish before its parallel members report back. With it, leads wait.
- **The Chief uses plain `Agent`**: an `Agent(a, b)` allowlist on the Chief would be inherited by every nested subagent and stop leads from spawning their own members.
- **Shop and analytics are mock-only** until a real store/analytics platform is chosen.
- **Canva**: `THUMBNAIL_PROVIDER=canva` is a hook for a future Canva connector; the local Pillow renderer is used by default.
- **Mock clips and transcripts**: the sample clips come with pre-written transcripts so captions work without any key.
- **Whisper language**: if you tell the Chief which language a clip is in ("captions in Korean"), it is passed to Whisper instead of letting it guess.
- **`slack_notify` needs approval** (it is in the `ask` list), so during dashboard runs, which cannot answer prompts, it is refused. Approval pings to Slack still work because the dashboard sends them.

## Troubleshooting

- **`EADDRINUSE`**: the port is taken. Use `PORT=4010 npm run dashboard`, or stop the old server (`lsof -i :4000`, then `kill <pid>`).
- **`No such filter: 'subtitles'`**: your ffmpeg has no libass. Install `ffmpeg-full` (macOS) and put it first on your PATH.
- **Google `unauthorized_client`**: the refresh token was made with a different client. Redo the OAuth Playground steps with the *same* client ID and secret that are in `.env`.
- **Google `redirect_uri_mismatch`**: the OAuth client must be type Web application with redirect URI exactly `https://developers.google.com/oauthplayground`.
- **Slack `not_allowed_token_type`**: wrong token. You need the Bot User OAuth Token that starts with `xoxb-`.
- **Slack `not_in_channel`**: invite the app to the channel with `/invite @Agent HQ`.
- **Whisper `invalid_api_key`**: the OpenAI key is wrong (check it starts with `sk-proj-` or `sk-`). **`insufficient_quota`**: add credit in OpenAI Billing.
- **Gibberish captions**: the clip is mostly music or has no speech, or Whisper guessed the wrong language. Give the captions yourself, or say which language it is.
- **"workspace has not been trusted"**: run `claude` once in this folder and accept the prompt.
