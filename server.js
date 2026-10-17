import express from "express";
import { rateLimit } from "express-rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { generateApplication, parseInput, GenerationError, PROVIDER } from "./src/generate.js";
import { letterToDocx, letterToPdf, letterToText, resumeToDocx, resumeToPdf, resumeToText } from "./src/export.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const GENERATIONS_PER_HOUR = Number(process.env.GENERATIONS_PER_HOUR) || 5;

// Render (and most hosts) sit behind one proxy; needed so rate limiting sees the real client IP.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

app.get("/healthz", (_req, res) => res.send("ok"));

// ---------- optional shared password ----------

const digest = (s) => createHash("sha256").update(String(s)).digest();
const passwordOk = (given) => !APP_PASSWORD || timingSafeEqual(digest(given ?? ""), digest(APP_PASSWORD));

function requirePassword(req, res, next) {
  if (passwordOk(req.get("x-app-password"))) return next();
  res.status(401).json({ error: "Password required", code: "password_required" });
}

const unlockLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/api/config", (_req, res) => res.json({ passwordRequired: Boolean(APP_PASSWORD) }));
app.post("/api/unlock", unlockLimiter, (req, res) => {
  if (passwordOk(req.body?.password)) return res.json({ ok: true });
  res.status(401).json({ error: "Wrong password", code: "password_required" });
});

app.use("/api/generate", requirePassword);
app.use("/api/export", requirePassword);

// ---------- rate limit on the expensive call ----------

const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: GENERATIONS_PER_HOUR,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: `Limit reached: ${GENERATIONS_PER_HOUR} generations per hour. Please try again later.` },
});

app.post("/api/generate", generateLimiter, async (req, res) => {
  try {
    const input = parseInput(req.body);
    const result = await generateApplication(input);
    res.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.issues.map((i) => i.message).join(". ") });
    }
    if (err instanceof GenerationError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong generating your documents." });
  }
});

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
};

app.post("/api/export", async (req, res) => {
  const { doc, format, resume, coverLetter } = req.body || {};
  if (!MIME[format] || !["resume", "coverLetter"].includes(doc) || !resume) {
    return res.status(400).json({ error: "Invalid export request" });
  }
  if (doc === "coverLetter" && !coverLetter) {
    return res.status(400).json({ error: "Missing cover letter" });
  }
  try {
    const builders = {
      resume: { pdf: () => resumeToPdf(resume), docx: () => resumeToDocx(resume), txt: () => resumeToText(resume) },
      coverLetter: {
        pdf: () => letterToPdf(coverLetter, resume),
        docx: () => letterToDocx(coverLetter, resume),
        txt: () => letterToText(coverLetter, resume),
      },
    };
    const body = await builders[doc][format]();
    const base = (resume.name || "candidate").replace(/[^\w-]+/g, "_");
    const filename = `${base}_${doc === "resume" ? "Resume" : "Cover_Letter"}.${format}`;
    res.setHeader("Content-Type", MIME[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not build the file." });
  }
});

app.listen(PORT, () => {
  console.log(`Resume & cover letter tailor running at http://localhost:${PORT}`);
  const keyVar = PROVIDER === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  console.log(`AI provider: ${PROVIDER}`);
  if (!process.env[keyVar]) {
    console.warn(`Warning: ${keyVar} is not set. Copy .env.example to .env and add your key.`);
  }
  if (!APP_PASSWORD) console.log("APP_PASSWORD is not set: the app is open to anyone who can reach it.");
});
