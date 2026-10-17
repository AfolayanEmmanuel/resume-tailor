import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ApiError, GoogleGenAI } from "@google/genai";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// ---------- Output schema (structured outputs guarantee this shape) ----------

const ResumeSchema = z.object({
  name: z.string(),
  headline: z.string().describe("Short professional title aligned to the target job"),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.string()),
  }),
  summary: z.string().describe("3-4 sentence professional summary tailored to the job"),
  skills: z.array(
    z.object({
      category: z.string(),
      items: z.array(z.string()),
    })
  ),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      dates: z.string(),
      bullets: z.array(z.string()),
    })
  ),
  education: z.array(
    z.object({
      degree: z.string(),
      school: z.string(),
      dates: z.string(),
      details: z.string(),
    })
  ),
  projects: z.array(z.object({ name: z.string(), description: z.string() })),
  certifications: z.array(z.string()),
});

const CoverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  closing: z.string().describe("e.g. 'Sincerely,'"),
  signature: z.string(),
});

const AnalysisSchema = z.object({
  matchScore: z.number().describe("0-100 estimate of how well the candidate matches the job as-is"),
  verdict: z.string().describe("One sentence overall assessment"),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(
    z.object({
      skill: z.string(),
      importance: z.enum(["critical", "important", "nice-to-have"]),
      howToClose: z.string().describe("Concrete way to gain or demonstrate this skill"),
    })
  ),
  keywordsToAdd: z.array(z.string()).describe("ATS keywords from the job description the candidate could truthfully add"),
  improvements: z.array(
    z.object({
      area: z.string(),
      suggestion: z.string(),
    })
  ),
});

const OutputSchema = z.object({
  resume: ResumeSchema,
  coverLetter: CoverLetterSchema,
  analysis: AnalysisSchema,
});

const outputFormat = zodOutputFormat(OutputSchema);

// ---------- Input validation ----------

const InputSchema = z.object({
  fullName: z.string({ error: "Full name is required" }).trim().min(1, "Full name is required"),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  location: z.string().trim().default(""),
  links: z.string().trim().default(""),
  about: z.string().trim().default(""),
  skills: z.string().trim().default(""),
  experience: z
    .array(
      z.object({
        title: z.string().trim().default(""),
        company: z.string().trim().default(""),
        location: z.string().trim().default(""),
        dates: z.string().trim().default(""),
        description: z.string().trim().default(""),
      })
    )
    .default([]),
  education: z
    .array(
      z.object({
        degree: z.string().trim().default(""),
        school: z.string().trim().default(""),
        dates: z.string().trim().default(""),
        details: z.string().trim().default(""),
      })
    )
    .default([]),
  extras: z.string().trim().default(""),
  companyName: z.string().trim().default(""),
  hiringManager: z.string().trim().default(""),
  tone: z.enum(["professional", "enthusiastic", "concise"]).default("professional"),
  jobDescription: z.string({ error: "Please paste the full job description" }).trim().min(30, "Please paste the full job description"),
});

export function parseInput(body) {
  return InputSchema.parse(body);
}

// ---------- Prompt ----------

const SYSTEM_PROMPT = `You are an expert career coach and resume writer who tailors application materials to a specific job.

Given a candidate's background and a job description, you produce three things:
1. A tailored, ATS-friendly resume.
2. A personalized cover letter.
3. A skills-gap analysis with improvement suggestions.

Honesty is the most important rule. Only present skills, tools, employers, titles, dates, degrees and accomplishments the candidate actually provided. You may rephrase, reorder, emphasise, and quantify where the candidate's own text supports it, and you may use the job description's vocabulary for things the candidate genuinely did. Never invent metrics, employers, certifications, or skills. Anything the job asks for that the candidate does not show belongs in the analysis as a missing skill, not in the resume or cover letter.

Resume guidance:
- Order skills and experience so the most job-relevant material comes first; group skills into a few sensible categories.
- Write 3-5 achievement-oriented bullets per role, starting with strong action verbs, focused on impact relevant to this job.
- Leave a field as an empty string or empty array when the candidate gave nothing for it.

Cover letter guidance:
- 3-4 paragraphs, under ~350 words, addressed to the hiring manager if named (otherwise "Dear Hiring Manager,").
- Reference the company and role specifically, connect 2-3 of the candidate's real experiences to the job's top requirements, and close with a confident call to action.
- Match the requested tone.

Analysis guidance:
- matchScore reflects the candidate as they are today against the stated requirements, not the polished resume.
- missingSkills lists requirements from the job description that the candidate's input does not demonstrate, ranked by importance, each with a concrete way to close the gap (course, project idea, how to surface adjacent experience).
- improvements are specific, actionable suggestions for the candidate's materials and profile (e.g. "Add a metric to the Acme migration bullet — how many users or how much time saved?").`;

function formatCandidate(input) {
  const exp = input.experience
    .filter((e) => e.title || e.company || e.description)
    .map(
      (e, i) =>
        `Role ${i + 1}: ${e.title || "(title not given)"} at ${e.company || "(company not given)"}` +
        `${e.location ? `, ${e.location}` : ""}${e.dates ? ` (${e.dates})` : ""}\n${e.description}`
    )
    .join("\n\n");
  const edu = input.education
    .filter((e) => e.degree || e.school)
    .map((e) => `${e.degree}${e.school ? `, ${e.school}` : ""}${e.dates ? ` (${e.dates})` : ""}${e.details ? ` - ${e.details}` : ""}`)
    .join("\n");

  return `<candidate>
Name: ${input.fullName}
Email: ${input.email}
Phone: ${input.phone}
Location: ${input.location}
Links: ${input.links}

About / summary:
${input.about || "(none given)"}

Skills:
${input.skills || "(none given)"}

Work experience:
${exp || "(none given)"}

Education:
${edu || "(none given)"}

Projects, certifications and other:
${input.extras || "(none given)"}
</candidate>

<job>
Company: ${input.companyName || "(not given — infer from the description if possible)"}
Hiring manager: ${input.hiringManager || "(not given)"}

${input.jobDescription}
</job>

Cover letter tone: ${input.tone}.

Produce the tailored resume, cover letter, and skills-gap analysis.`;
}

export class GenerationError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export const PROVIDER = (process.env.AI_PROVIDER || "claude").toLowerCase();
if (!["claude", "gemini"].includes(PROVIDER)) {
  throw new Error(`Unknown AI_PROVIDER "${PROVIDER}". Use "claude" or "gemini".`);
}

export async function generateApplication(input) {
  const text = PROVIDER === "gemini" ? await callGemini(input) : await callClaude(input);
  let result;
  try {
    const parsed = OutputSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "unexpected shape");
    result = parsed.data;
  } catch (err) {
    throw new GenerationError(`Could not read the model's response: ${err.message}`, 502);
  }
  result.analysis.matchScore = Math.max(0, Math.min(100, Math.round(result.analysis.matchScore)));
  return result;
}

// ---------- Claude ----------

let anthropic;

async function callClaude(input) {
  anthropic ??= new Anthropic();
  let message;
  try {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      // Re-run on a fallback model server-side if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: outputFormat },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: formatCandidate(input) }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new GenerationError("Claude API authentication failed. Set ANTHROPIC_API_KEY in your .env file.", 401);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new GenerationError("Rate limited by the Claude API. Wait a moment and try again.", 429);
    }
    if (err instanceof Anthropic.APIError) {
      throw new GenerationError(`Claude API error: ${err.message}`, 502);
    }
    if (err instanceof Error && /api key|apiKey|authToken/i.test(err.message)) {
      throw new GenerationError("No Claude API key found. Copy .env.example to .env and set ANTHROPIC_API_KEY.", 401);
    }
    throw err;
  }

  if (message.stop_reason === "refusal") {
    throw new GenerationError("The request was declined. Please review the inputs and try again.", 422);
  }
  if (message.stop_reason === "max_tokens") {
    throw new GenerationError("The response was cut off. Try shortening the inputs.", 502);
  }
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---------- Gemini ----------

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// Same schema as Claude's structured output, as plain JSON Schema.
const { $schema, ...geminiSchema } = z.toJSONSchema(OutputSchema);
let gemini;

async function callGemini(input) {
  if (!process.env.GEMINI_API_KEY) {
    throw new GenerationError("No Gemini API key found. Set GEMINI_API_KEY in your .env file.", 401);
  }
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let response;
  try {
    response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: formatCandidate(input),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: geminiSchema,
        maxOutputTokens: 32000,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) {
        throw new GenerationError("Gemini rate limit or free-tier quota reached. Wait a bit and try again.", 429);
      }
      if (err.status === 400 && /api key/i.test(err.message)) {
        throw new GenerationError("Gemini rejected the API key. Check GEMINI_API_KEY in your .env file.", 401);
      }
      if (err.status === 401 || err.status === 403) {
        throw new GenerationError("Gemini API authentication failed. Check GEMINI_API_KEY in your .env file.", 401);
      }
      throw new GenerationError(`Gemini API error: ${err.message}`, 502);
    }
    throw err;
  }

  const finish = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason || finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
    throw new GenerationError("The request was declined. Please review the inputs and try again.", 422);
  }
  if (finish === "MAX_TOKENS") {
    throw new GenerationError("The response was cut off. Try shortening the inputs.", 502);
  }
  if (!response.text) {
    throw new GenerationError("Gemini returned an empty response. Please try again.", 502);
  }
  return response.text;
}
