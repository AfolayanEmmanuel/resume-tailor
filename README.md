# Resume Tailor

An AI-powered web app that takes your personal details, skills, experience and a job description, and generates:

- **A tailored resume.** It is ATS-friendly and reorders and rewrites your real experience around the job.
- **A personalized cover letter.** You can choose a professional, enthusiastic or concise tone.
- **A skills-gap analysis.** It gives you a match score, the skills you already match, the missing skills ranked by importance with ways to close each gap, ATS keywords to add, and specific improvements.

You can download the resume and cover letter as **PDF**, **Word (.docx)** or **plain text**, or copy them to the clipboard.

The app is built with Node.js and Express. It can use either **Claude** (Claude Opus 5.5, the default) or **Google Gemini** to generate the documents. Both return JSON in the same format. The prompt tells the model never to invent experience, metrics or skills. Gaps go in the analysis and stay out of the resume.

## Setup

Requires Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env      # then fill in your API key (see below)
npm start
```

### Choosing the AI provider

Set `AI_PROVIDER` in `.env`:

| Provider | Settings | Notes |
|---|---|---|
| Claude (default) | `AI_PROVIDER=claude`, `ANTHROPIC_API_KEY=...` | Paid API credits from https://console.anthropic.com/ |
| Gemini | `AI_PROVIDER=gemini`, `GEMINI_API_KEY=...` | Free key from https://aistudio.google.com/apikey. The free tier has daily limits, and Google may use free-tier inputs to improve its products. Use a paid key if other people's resumes will go through it. |

Optional: `CLAUDE_MODEL` or `GEMINI_MODEL` change the model (defaults: `claude-opus-5-5`, `gemini-flash-latest`). Restart the server after changing `.env`.

Open http://localhost:3000. Click **Load sample** to fill the form with an example profile and job.

## Deploy to Render

The repo includes a [Render Blueprint](render.yaml) that sets up a free Node web service.

1. Push this folder to a GitHub repository.
2. In the Render dashboard, choose **New → Blueprint** and select the repository.
3. When asked, fill in:
   - `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`: the key for the provider you use (leave the other empty)
   - `APP_PASSWORD`: a shared password visitors must enter (leave it empty only if you want the app open to anyone)
   To use Gemini, also change `AI_PROVIDER` to `gemini` under the service's **Environment** settings after it's created.
4. Click **Apply**. Render builds and starts the app and gives you a `*.onrender.com` URL.

Each visitor (by IP address) is limited to `GENERATIONS_PER_HOUR` generations, 5 by default. You can change it under the service's **Environment** settings. On the free plan the service sleeps after 15 minutes without traffic, so the first visit after a quiet period takes about a minute to load.

## Project layout

```
server.js            Express server: /api/generate and /api/export
src/generate.js      Prompt, output schema, Claude and Gemini calls
src/export.js        PDF (pdfkit), DOCX (docx) and text renderers
public/              Front end (index.html, styles.css, app.js)
```

## Notes

- Form input is autosaved in the browser's localStorage, so a refresh doesn't lose your work.
- A generation usually takes 30–90 seconds.
- Requests use Claude's server-side refusal fallback (`fallbacks: "default"`). If a request is declined, it is retried on a fallback model automatically. If you change `CLAUDE_MODEL` to a model that doesn't support this, remove `betas` and `fallbacks` in `src/generate.js`.
