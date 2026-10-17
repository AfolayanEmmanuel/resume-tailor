import PDFDocument from "pdfkit";
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";

const ACCENT = "1F4E79";
const MUTED = "555555";

const clean = (arr) => (arr || []).map((s) => (typeof s === "string" ? s.trim() : s)).filter(Boolean);
const contactLine = (c = {}) => clean([c.email, c.phone, c.location, ...(c.links || [])]).join("  |  ");

// ---------------------------------------------------------------- plain text

export function resumeToText(r) {
  const out = [r.name.toUpperCase()];
  if (r.headline) out.push(r.headline);
  const contact = contactLine(r.contact);
  if (contact) out.push(contact);
  const section = (title) => out.push("", title.toUpperCase(), "-".repeat(title.length));

  if (r.summary) { section("Summary"); out.push(r.summary); }
  if (r.skills?.length) {
    section("Skills");
    r.skills.forEach((s) => out.push(`${s.category}: ${s.items.join(", ")}`));
  }
  if (r.experience?.length) {
    section("Experience");
    r.experience.forEach((e, i) => {
      if (i) out.push("");
      out.push(clean([e.title, e.company]).join(" — ") + (e.dates ? `  (${e.dates})` : ""));
      if (e.location) out.push(e.location);
      e.bullets.forEach((b) => out.push(`  • ${b}`));
    });
  }
  if (r.projects?.length) {
    section("Projects");
    r.projects.forEach((p) => out.push(`${p.name}: ${p.description}`));
  }
  if (r.education?.length) {
    section("Education");
    r.education.forEach((e) =>
      out.push(clean([e.degree, e.school]).join(", ") + (e.dates ? ` (${e.dates})` : "") + (e.details ? ` — ${e.details}` : ""))
    );
  }
  if (r.certifications?.length) {
    section("Certifications");
    r.certifications.forEach((c) => out.push(`• ${c}`));
  }
  return out.join("\n") + "\n";
}

export function letterToText(l, r) {
  const header = clean([r?.name, contactLine(r?.contact)]);
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return [...header, "", date, "", l.greeting, "", ...l.paragraphs.flatMap((p) => [p, ""]), l.closing, l.signature].join("\n") + "\n";
}

// ---------------------------------------------------------------- PDF

function pdfToBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 54, left: 60, right: 60 } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

function pdfSection(doc, title) {
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(`#${ACCENT}`).text(title.toUpperCase(), { characterSpacing: 1 });
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.75).strokeColor(`#${ACCENT}`).stroke();
  doc.moveDown(0.4);
  doc.fillColor("#000000");
}

function pdfBullet(doc, text) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.y;
  doc.font("Helvetica").fontSize(10).text("•", x + 6, y);
  doc.text(text, x + 18, y, { width: width - 18, lineGap: 1.5 });
  doc.x = x;
  doc.moveDown(0.15);
}

export function resumeToPdf(r) {
  return pdfToBuffer((doc) => {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(22).fillColor(`#${ACCENT}`).text(r.name, { align: "center" });
    if (r.headline) doc.font("Helvetica").fontSize(11.5).fillColor("#333333").text(r.headline, { align: "center" });
    const contact = contactLine(r.contact);
    if (contact) doc.moveDown(0.2).fontSize(9).fillColor(`#${MUTED}`).text(contact, { align: "center" });
    doc.fillColor("#000000");

    if (r.summary) {
      pdfSection(doc, "Summary");
      doc.font("Helvetica").fontSize(10).text(r.summary, { lineGap: 1.5 });
    }
    if (r.skills?.length) {
      pdfSection(doc, "Skills");
      r.skills.forEach((s) => {
        doc.font("Helvetica-Bold").fontSize(10).text(`${s.category}: `, { continued: true });
        doc.font("Helvetica").text(s.items.join(", "), { lineGap: 1.5 });
      });
    }
    if (r.experience?.length) {
      pdfSection(doc, "Experience");
      r.experience.forEach((e, i) => {
        if (i) doc.moveDown(0.5);
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(10.5).text(e.title || e.company, left, y, { width: width - 140 });
        const afterTitle = doc.y;
        if (e.dates) doc.font("Helvetica").fontSize(9.5).fillColor(`#${MUTED}`).text(e.dates, left, y, { width, align: "right" });
        doc.fillColor("#000000").x = left;
        doc.y = afterTitle;
        const sub = clean([e.title ? e.company : "", e.location]).join(" · ");
        if (sub) doc.font("Helvetica-Oblique").fontSize(10).fillColor("#333333").text(sub).fillColor("#000000");
        doc.moveDown(0.2);
        e.bullets.forEach((b) => pdfBullet(doc, b));
      });
    }
    if (r.projects?.length) {
      pdfSection(doc, "Projects");
      r.projects.forEach((p) => {
        doc.font("Helvetica-Bold").fontSize(10).text(`${p.name}: `, { continued: true });
        doc.font("Helvetica").text(p.description, { lineGap: 1.5 });
        doc.moveDown(0.2);
      });
    }
    if (r.education?.length) {
      pdfSection(doc, "Education");
      r.education.forEach((e) => {
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(10.5).text(clean([e.degree, e.school]).join(", "), left, y, { width: width - 120 });
        const after = doc.y;
        if (e.dates) doc.font("Helvetica").fontSize(9.5).fillColor(`#${MUTED}`).text(e.dates, left, y, { width, align: "right" });
        doc.fillColor("#000000").x = left;
        doc.y = after;
        if (e.details) doc.font("Helvetica").fontSize(10).text(e.details);
        doc.moveDown(0.3);
      });
    }
    if (r.certifications?.length) {
      pdfSection(doc, "Certifications");
      r.certifications.forEach((c) => pdfBullet(doc, c));
    }
  });
}

export function letterToPdf(l, r) {
  return pdfToBuffer((doc) => {
    doc.font("Helvetica-Bold").fontSize(18).fillColor(`#${ACCENT}`).text(r?.name || l.signature);
    const contact = contactLine(r?.contact);
    if (contact) doc.font("Helvetica").fontSize(9).fillColor(`#${MUTED}`).text(contact);
    doc.fillColor("#000000").moveDown(1.5);
    doc.font("Helvetica").fontSize(10.5);
    doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
    doc.moveDown(1);
    doc.text(l.greeting).moveDown(0.8);
    l.paragraphs.forEach((p) => doc.text(p, { lineGap: 2.5, align: "justify" }).moveDown(0.8));
    doc.text(l.closing).moveDown(1.5).font("Helvetica-Bold").text(l.signature);
  });
}

// ---------------------------------------------------------------- DOCX

const run = (text, opts = {}) => new TextRun({ text, font: "Calibri", ...opts });

function docxSection(title) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 2 } },
    children: [run(title.toUpperCase(), { bold: true, size: 22, color: ACCENT, characterSpacing: 20 })],
  });
}

const bullet = (text) =>
  new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: [run(text, { size: 20 })] });

// Right-aligned tab at the text width (8.5in - 2 x 0.9in margins = 6.7in = 9648 twips)
const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: 9648 }];

function packDocx(children) {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1000, bottom: 1000, left: 1296, right: 1296 } } },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export function resumeToDocx(r) {
  const c = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [run(r.name, { bold: true, size: 44, color: ACCENT })] }),
  ];
  if (r.headline) c.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(r.headline, { size: 23, color: "333333" })] }));
  const contact = contactLine(r.contact);
  if (contact) c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [run(contact, { size: 18, color: MUTED })] }));

  if (r.summary) c.push(docxSection("Summary"), new Paragraph({ children: [run(r.summary, { size: 20 })] }));
  if (r.skills?.length) {
    c.push(docxSection("Skills"));
    r.skills.forEach((s) =>
      c.push(new Paragraph({ spacing: { after: 40 }, children: [run(`${s.category}: `, { bold: true, size: 20 }), run(s.items.join(", "), { size: 20 })] }))
    );
  }
  if (r.experience?.length) {
    c.push(docxSection("Experience"));
    r.experience.forEach((e, i) => {
      c.push(
        new Paragraph({
          tabStops: RIGHT_TAB,
          spacing: { before: i ? 160 : 0 },
          children: [run(e.title || e.company, { bold: true, size: 21 }), run(`\t${e.dates || ""}`, { size: 19, color: MUTED })],
        })
      );
      const sub = clean([e.title ? e.company : "", e.location]).join(" · ");
      if (sub) c.push(new Paragraph({ spacing: { after: 40 }, children: [run(sub, { italics: true, size: 20, color: "333333" })] }));
      e.bullets.forEach((b) => c.push(bullet(b)));
    });
  }
  if (r.projects?.length) {
    c.push(docxSection("Projects"));
    r.projects.forEach((p) =>
      c.push(new Paragraph({ spacing: { after: 60 }, children: [run(`${p.name}: `, { bold: true, size: 20 }), run(p.description, { size: 20 })] }))
    );
  }
  if (r.education?.length) {
    c.push(docxSection("Education"));
    r.education.forEach((e) => {
      c.push(
        new Paragraph({
          tabStops: RIGHT_TAB,
          children: [run(clean([e.degree, e.school]).join(", "), { bold: true, size: 21 }), run(`\t${e.dates || ""}`, { size: 19, color: MUTED })],
        })
      );
      if (e.details) c.push(new Paragraph({ spacing: { after: 60 }, children: [run(e.details, { size: 20 })] }));
    });
  }
  if (r.certifications?.length) {
    c.push(docxSection("Certifications"));
    r.certifications.forEach((x) => c.push(bullet(x)));
  }
  return packDocx(c);
}

export function letterToDocx(l, r) {
  const p = (text, opts = {}) => new Paragraph({ spacing: { after: 200, line: 300 }, ...opts, children: [run(text, { size: 22 })] });
  const c = [new Paragraph({ children: [run(r?.name || l.signature, { bold: true, size: 36, color: ACCENT })] })];
  const contact = contactLine(r?.contact);
  if (contact) c.push(new Paragraph({ spacing: { after: 360 }, children: [run(contact, { size: 18, color: MUTED })] }));
  c.push(p(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })));
  c.push(p(l.greeting));
  l.paragraphs.forEach((x) => c.push(p(x, { alignment: AlignmentType.JUSTIFIED })));
  c.push(new Paragraph({ spacing: { after: 480 }, children: [run(l.closing, { size: 22 })] }));
  c.push(new Paragraph({ children: [run(l.signature, { bold: true, size: 22 })] }));
  return packDocx(c);
}
