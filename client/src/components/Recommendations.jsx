import { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { getInventory, getRecommendations, updateRecommendationStatus } from '../api';
import RemediationModal from './RemediationModal';

// Renders **bold** markdown as <strong> elements; leaves other text unchanged.
function renderBold(text) {
  if (!text || !text.includes('**')) return text;
  const parts = text.split(/\*\*(.+?)\*\*/gs);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}
const EFFORT_LABEL = { low: 'Low Effort', medium: 'Medium Effort', high: 'High Effort' };
const EFFORT_POINTS = { low: 1, medium: 3, high: 8 };
const GLOBAL_PATTERNS = new Set(['global_description', 'global_inactive']);

function complexityScore(recs) {
  return recs.reduce((sum, r) => sum + (EFFORT_POINTS[r.effort_estimate] || 3), 0);
}

function severityCounts(recs) {
  return recs.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

// ── PDF color palette (mirrors App.css) ─────────────────────────────────────
const PDF_C = {
  dark:   [32, 33, 36],
  mid:    [60, 64, 67],
  muted:  [95, 99, 104],
  rule:   [200, 200, 200],
  bgLt:   [241, 243, 244],
  pathBg: [248, 249, 250],
  pathBd: [218, 220, 224],
  warnBg: [254, 247, 224],
  warnFg: [176, 96, 0],
  severity: {
    error:   { border: [217, 48, 37],  badgeBg: [252, 232, 230], badgeFg: [197, 34, 31]  },
    warning: { border: [242, 153, 0],  badgeBg: [254, 247, 224], badgeFg: [176, 96, 0]   },
    info:    { border: [26, 115, 232], badgeBg: [232, 240, 254], badgeFg: [21, 87, 176]  },
  },
  status: {
    accepted:  { bg: [230, 244, 234], fg: [24, 128, 56]  },
    dismissed: { bg: [241, 243, 244], fg: [95, 99, 104]  },
  },
};

function exportPDF(recs, scan, org, inventory = []) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 14;            // left margin
  const MR = 14;            // right margin
  const BORD = 3;           // left accent border strip width on cards
  const TX = ML + BORD + 4; // card text start x (past border + gap)
  const CW = PW - TX - MR;  // usable card text width
  const FOOTER = 10;        // reserved footer height
  let y = 15;

  // ── Core helpers ────────────────────────────────────────────────────────────

  // Break to new page if less than `need` mm remain
  const guard = (need = 8) => {
    if (y + need > PH - FOOTER - 2) { doc.addPage(); y = 15; }
  };

  // Line height for a given font size
  const lhOf = (size) => size * 0.35 + 1.2;

  // Draw a filled rounded badge; return x coordinate after badge
  const mkBadge = (label, x, atY, bg, fg, size = 7, bold = true) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const tw = doc.getTextWidth(label);
    const bH = lhOf(size) + 1.5;
    const bW = tw + 4;
    doc.setFillColor(...bg);
    doc.roundedRect(x, atY - bH + 0.8, bW, bH, 0.8, 0.8, 'F');
    doc.setTextColor(...fg);
    doc.text(label, x + 2, atY);
    return x + bW + 2;
  };

  // Strip markdown syntax and replace Unicode chars Helvetica cannot render
  const sanitizePdfText = (str) => {
    if (!str) return str;
    let s = String(str);
    s = s.replace(/\*\*(.+?)\*\*/gs, '$1');  // bold
    s = s.replace(/\*(.+?)\*/gs, '$1');       // italic
    s = s.replace(/`([^`]+)`/g, '$1');        // inline code
    s = s.replace(/[→⟶⇒]/g, '->');           // right arrows
    s = s.replace(/[←⟵⇐]/g, '<-');           // left arrows
    s = s.replace(/⚠/g, '[!]');              // warning emoji
    return s;
  };

  // Remove leading "Severity: X" prefix some LLM responses include
  const stripSeverityPrefix = (str) => {
    if (!str) return str;
    return str.replace(/^\*?\*?Severity:\s*\w+\*?\*?[.\s\u2013-]*/i, '').trim();
  };

  // Parse **bold** markdown into [{text, bold}] segments; applies base PDF sanitization
  const parseBoldSegmentsPdf = (str) => {
    if (!str) return [{ text: '', bold: false }];
    let s = String(str);
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/[→⟶⇒]/g, '->');
    s = s.replace(/[←⟵⇐]/g, '<-');
    s = s.replace(/⚠/g, '[!]');
    return s.split(/\*\*(.+?)\*\*/gs).map((part, i) => ({
      text: part.replace(/\*(.+?)\*/g, '$1'),
      bold: i % 2 === 1,
    }));
  };

  // Lay out mixed bold/normal text into lines respecting maxW and forced newlines
  const layoutMixed = (str, maxW, size) => {
    const segments = parseBoldSegmentsPdf(str);
    // Expand segments on \n boundaries so forced line-breaks are preserved
    const subSegs = [];
    for (const seg of segments) {
      seg.text.split('\n').forEach((part, pi) => {
        if (pi > 0) subSegs.push({ text: '', bold: seg.bold, isNewline: true });
        subSegs.push({ text: part, bold: seg.bold });
      });
    }
    // Tokenize on whitespace
    const tokens = [];
    for (const seg of subSegs) {
      if (seg.isNewline) { tokens.push({ text: '', bold: false, isNewline: true }); continue; }
      for (const w of seg.text.split(/(\s+)/)) {
        if (w) tokens.push({ text: w, bold: seg.bold, isSpace: /^\s+$/.test(w) });
      }
    }
    const lines = [];
    let cur = [], curW = 0;
    const flush = () => {
      while (cur.length > 0 && cur[cur.length - 1].isSpace) cur.pop();
      if (cur.length > 0) lines.push([...cur]);
      cur = []; curW = 0;
    };
    for (const tok of tokens) {
      if (tok.isNewline) { flush(); continue; }
      doc.setFontSize(size);
      doc.setFont('helvetica', tok.bold ? 'bold' : 'normal');
      const w = doc.getTextWidth(tok.text);
      if (!tok.isSpace && curW > 0 && curW + w > maxW) {
        flush();
        cur = [tok]; curW = w;
      } else {
        cur.push(tok); curW += w;
      }
    }
    flush();
    return lines;
  };

  // Render pre-laid-out mixed bold/normal lines, advancing y per line
  const renderMixed = (lines, x, size, color, lh) => {
    for (const line of lines) {
      guard(lh + 1);
      let cx = x;
      for (const tok of line) {
        if (!tok.text) continue;
        doc.setFontSize(size);
        doc.setFont('helvetica', tok.bold ? 'bold' : 'normal');
        doc.setTextColor(...color);
        doc.text(tok.text, cx, y);
        cx += doc.getTextWidth(tok.text);
      }
      y += lh;
    }
  };

  // ── COVER PAGE ──────────────────────────────────────────────────────────────

  // Blue header band
  doc.setFillColor(26, 115, 232);
  doc.rect(0, 0, PW, 30, 'F');
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('10K Smart Automation Wizard', ML, 14);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 210, 255);
  doc.text('Recommendations Report', ML, 22);
  y = 38;

  // Metadata row
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_C.muted);
  const metaStr = [
    org?.name ? `Org: ${org.name}` : null,
    `Scan #${scan.id}`,
    `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
  ].filter(Boolean).join('   ·   ');
  doc.text(metaStr, ML, y);
  y += 7;
  doc.setDrawColor(...PDF_C.rule);
  doc.line(ML, y, PW - MR, y);
  y += 8;

  // Overview stat boxes
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_C.dark);
  doc.text('Overview', ML, y);
  y += 6;

  const counts = severityCounts(recs);
  const score = complexityScore(recs);
  const statDefs = [
    { label: 'Total',    value: recs.length.toLocaleString(),                                    bg: PDF_C.bgLt,      fg: PDF_C.dark,      accent: [26, 115, 232]  },
    { label: 'Errors',   value: counts.error.toLocaleString(),                                   bg: [252, 232, 230], fg: [197, 34, 31],   accent: [217, 48, 37]   },
    { label: 'Warnings', value: counts.warning.toLocaleString(),                                 bg: [254, 247, 224], fg: [176, 96, 0],    accent: [242, 153, 0]   },
    { label: 'Info',     value: counts.info.toLocaleString(),                                    bg: [232, 240, 254], fg: [21, 87, 176],   accent: [26, 115, 232]  },
    { label: 'Accepted', value: recs.filter((r) => r.status === 'accepted').length.toLocaleString(), bg: [230, 244, 234], fg: [24, 128, 56], accent: [52, 168, 83] },
  ];
  const BW = 33, BH = 18, BG = 4;
  let sx = ML;
  for (const s of statDefs) {
    doc.setFillColor(...s.bg);
    doc.roundedRect(sx, y, BW, BH, 1.5, 1.5, 'F');
    doc.setFillColor(...s.accent);
    doc.roundedRect(sx, y, BW, 2.5, 0.5, 0.5, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...s.fg);
    doc.text(s.value, sx + BW / 2, y + 10.5, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_C.muted);
    doc.text(s.label, sx + BW / 2, y + 15.5, { align: 'center' });
    sx += BW + BG;
  }
  y += BH + 5;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_C.muted);
  doc.text(`Remediation Complexity Score: ${score.toLocaleString()}`, ML, y);
  y += 9;
  doc.setDrawColor(...PDF_C.rule);
  doc.line(ML, y, PW - MR, y);
  y += 8;

  // Automation inventory breakdown
  if (inventory.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_C.dark);
    doc.text('Automation Inventory', ML, y);
    y += 6;

    const typeTotals = {}, typeActives = {};
    for (const item of inventory) {
      const t = item.automation_type;
      typeTotals[t] = (typeTotals[t] || 0) + 1;
      if (item.is_active) typeActives[t] = (typeActives[t] || 0) + 1;
    }
    const invTypes = Object.keys(typeTotals).sort();
    const COL_ACTIVE = PW - MR - 14;
    const COL_TOTAL  = PW - MR;

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_C.muted);
    doc.text('Automation Type', ML, y);
    doc.text('Active', COL_ACTIVE, y, { align: 'right' });
    doc.text('Total',  COL_TOTAL,  y, { align: 'right' });
    y += 3;
    doc.setDrawColor(...PDF_C.rule);
    doc.line(ML, y, PW - MR, y);
    y += 3.5;

    const rowLh = lhOf(8) + 0.5;
    for (const t of invTypes) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...PDF_C.mid);
      doc.text(t, ML, y);
      doc.setTextColor(...PDF_C.dark);
      doc.text((typeActives[t] || 0).toString(), COL_ACTIVE, y, { align: 'right' });
      doc.text(typeTotals[t].toString(), COL_TOTAL, y, { align: 'right' });
      y += rowLh;
    }
    y += 4;
    doc.setDrawColor(...PDF_C.rule);
    doc.line(ML, y, PW - MR, y);
    y += 8;
  }

  // Table of contents
  const pdfLegacyRecs = recs.filter((r) => r.pattern === 'global_legacy');
  const pdfLegacyItems = pdfLegacyRecs.flatMap((r) => (r.items || []).map((item) => ({ item, parentRec: r })));
  const pdfObjectRecs = recs
    .filter((r) => !GLOBAL_PATTERNS.has(r.pattern) && r.pattern !== 'global_legacy')
    .sort((a, b) => (a.object_name || '').localeCompare(b.object_name || ''));
  const pdfOrgRecs = recs.filter((r) => GLOBAL_PATTERNS.has(r.pattern));

  const tocEntries = [];       // { recId, tocPage, rowY } — object/org recs
  const legacyTocEntries = []; // { itemId, tocPage, rowY } — per-item legacy pages
  const recPageMap = new Map();       // recId  → page number
  const legacyItemPageMap = new Map(); // itemId → page number

  const renderToc = (items, heading) => {
    if (items.length === 0) return;
    guard(8);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_C.dark);
    doc.text(`${heading}  (${items.length})`, ML, y);
    y += 5;
    for (const rec of items) {
      guard(6);
      const rowY = y;
      const sev = PDF_C.severity[rec.severity] || PDF_C.severity.info;
      doc.setFillColor(...sev.border);
      doc.circle(ML + 1.5, y - 1.5, 1.5, 'F');
      let titleX = ML + 6;
      const maxTW = PW - titleX - MR - 44;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...PDF_C.mid);
      doc.text(doc.splitTextToSize(rec.title, maxTW)[0], titleX, y);
      const effortLabel = EFFORT_LABEL[rec.effort_estimate] || rec.effort_estimate;
      doc.setFontSize(7);
      doc.setTextColor(...PDF_C.muted);
      doc.text(effortLabel, PW - MR - 13 - doc.getTextWidth(effortLabel), y);
      tocEntries.push({ recId: rec.id, tocPage: doc.internal.getCurrentPageInfo().pageNumber, rowY });
      y += 5.5;
    }
    y += 3;
  };

  // Legacy TOC: one row per automation item, not per recommendation
  const renderLegacyToc = (items, heading) => {
    if (items.length === 0) return;
    guard(8);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_C.dark);
    doc.text(`${heading}  (${items.length})`, ML, y);
    y += 5;
    for (const { item, parentRec } of items) {
      guard(6);
      const rowY = y;
      const sev = PDF_C.severity[parentRec.severity] || PDF_C.severity.info;
      doc.setFillColor(...sev.border);
      doc.circle(ML + 1.5, y - 1.5, 1.5, 'F');
      let titleX = ML + 6;
      const maxTW = PW - titleX - MR - 44;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...PDF_C.mid);
      doc.text(doc.splitTextToSize(item.api_name, maxTW)[0], titleX, y);
      const effortLabel = EFFORT_LABEL[parentRec.effort_estimate] || parentRec.effort_estimate;
      doc.setFontSize(7);
      doc.setTextColor(...PDF_C.muted);
      doc.text(effortLabel, PW - MR - 13 - doc.getTextWidth(effortLabel), y);
      legacyTocEntries.push({ itemId: item.id, tocPage: doc.internal.getCurrentPageInfo().pageNumber, rowY });
      y += 5.5;
    }
    y += 3;
  };

  renderLegacyToc(pdfLegacyItems, 'Active Legacy Automation');
  renderToc(pdfObjectRecs, 'Object-Level Recommendations');
  renderToc(pdfOrgRecs, 'Org-Level Recommendations');

  // ── RECOMMENDATION CARDS (one per page) ─────────────────────────────────────

  const renderCard = (rec, sectionLabel, showItems = true) => {
    doc.addPage();
    y = 15;
    recPageMap.set(rec.id, doc.internal.getCurrentPageInfo().pageNumber);

    const sev = PDF_C.severity[rec.severity] || PDF_C.severity.info;
    const cardStartY = y;

    // Section crumb + rule
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_C.muted);
    doc.text(sectionLabel.toUpperCase(), TX, y);
    y += 4.5;
    doc.setDrawColor(...PDF_C.rule);
    doc.line(TX, y, PW - MR, y);
    y += 5;

    // Title row: [SEVERITY] Title ... [EFFORT] [STATUS]
    const titleY = y;
    let bx = TX;
    bx = mkBadge(rec.severity.toUpperCase(), bx, titleY, sev.badgeBg, sev.badgeFg, 7);

    const effortLabel = EFFORT_LABEL[rec.effort_estimate] || rec.effort_estimate;
    const statusLabel = rec.status !== 'open'
      ? rec.status.charAt(0).toUpperCase() + rec.status.slice(1)
      : null;
    doc.setFontSize(7);
    let rightW = doc.getTextWidth(effortLabel) + 6;
    if (statusLabel) rightW += doc.getTextWidth(statusLabel) + 6;

    const titleMaxW = PW - bx - MR - rightW - 4;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_C.dark);
    const titleLines = doc.splitTextToSize(rec.title, titleMaxW);
    doc.text(titleLines[0], bx, titleY);

    let rbx = PW - MR - rightW + 2;
    rbx = mkBadge(effortLabel, rbx, titleY, PDF_C.bgLt, PDF_C.muted, 7, false);
    if (statusLabel) {
      const st = PDF_C.status[rec.status] || { bg: PDF_C.bgLt, fg: PDF_C.muted };
      mkBadge(statusLabel, rbx, titleY, st.bg, st.fg, 7);
    }

    const tlh = lhOf(12);
    titleLines.slice(1).forEach((l) => { y += tlh; doc.text(l, TX, y); });
    y += tlh + 5;

    // Rationale (prefer LLM narrative)
    renderMixed(layoutMixed(rec.llm_rationale || rec.rationale, CW, 8.5), TX, 8.5, PDF_C.mid, lhOf(8.5));
    y += 5;

    // Conflict analysis callout
    if (rec.conflict_analysis) {
      const confSev = rec.conflict_severity || 'medium';
      const confColors = {
        high:   { border: [217, 48, 37],  bg: [252, 232, 230], fg: [197, 34, 31] },
        medium: { border: [242, 153, 0],  bg: [254, 247, 224], fg: [176, 96, 0]  },
        low:    { border: [26, 115, 232], bg: [232, 240, 254], fg: [21, 87, 176] },
      };
      const cc = confColors[confSev] || confColors.medium;
      const mixedConfLines = layoutMixed(stripSeverityPrefix(rec.conflict_analysis), CW - 10, 8.5);
      const lhC = lhOf(8.5);
      const confBoxH = 7 + mixedConfLines.length * lhC + 5;
      guard(confBoxH + 2);

      doc.setFillColor(...cc.bg);
      doc.roundedRect(TX, y, CW, confBoxH, 1, 1, 'F');
      doc.setFillColor(...cc.border);
      doc.roundedRect(TX, y, 2.5, confBoxH, 0.3, 0.3, 'F');

      y += 5.5;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...cc.fg);
      const headerLabel = 'CONFLICT ANALYSIS';
      doc.text(headerLabel, TX + 5, y);
      mkBadge(confSev.toUpperCase(), TX + 5 + doc.getTextWidth(headerLabel) + 3, y, cc.bg, cc.fg, 6.5);
      y += 4.5;

      renderMixed(mixedConfLines, TX + 5, 8.5, PDF_C.mid, lhC);
      y += 5;
    }

    // Path box (recommended / alternative)
    const pathRows = [
      { label: 'Recommended:', text: rec.recommended_path, muted: false },
      rec.alternative_path ? { label: 'Alternative:', text: rec.alternative_path, muted: true } : null,
    ].filter(Boolean);

    const lhP = lhOf(8.5);
    let pathBoxH = 3;  // y+=3 after loop is external spacing, not inside the box
    doc.setFontSize(8.5);
    pathRows.forEach((pr) => {
      doc.setFont('helvetica', 'bold');
      const labelW = doc.getTextWidth(pr.label);
      doc.setFont('helvetica', 'normal');
      pathBoxH += doc.splitTextToSize(sanitizePdfText(pr.text) || '', CW - labelW - 8).length * lhP + 2;
    });
    pathBoxH += 2;

    guard(pathBoxH + 4);
    doc.setFillColor(...PDF_C.pathBg);
    doc.setDrawColor(...PDF_C.pathBd);
    doc.roundedRect(TX, y, CW, pathBoxH, 1, 1, 'FD');
    y += 5;

    pathRows.forEach((pr) => {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(pr.muted ? PDF_C.muted : PDF_C.dark));
      const labelW = doc.getTextWidth(pr.label);
      doc.text(pr.label, TX + 3, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...(pr.muted ? PDF_C.muted : PDF_C.mid));
      const textLines = doc.splitTextToSize(sanitizePdfText(pr.text) || '', CW - labelW - 8);
      textLines.forEach((l, li) => {
        if (li === 0) doc.text(l, TX + 3 + labelW + 2, y);
        else { y += lhP; doc.text(l, TX + 3, y); }
      });
      y += lhP + 2;
    });
    y += 3;

    // Implementation steps — when showItems is false (org-level cards), filter out
    // steps that embed inline automation name lists (identified by the `: "` pattern).
    const stepsToShow = showItems
      ? (rec.steps || [])
      : (rec.steps || []).filter((s) => typeof s.text === 'string' && !(/:\s*"/.test(s.text)));

    if (stepsToShow.length > 0) {
      guard(14);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PDF_C.dark);
      doc.text('Implementation Steps', TX, y);
      y += 5;

      const lhS = lhOf(8.5);
      stepsToShow.forEach((s, idx) => {
        const isWarn = typeof s.text === 'string' && s.text.startsWith('⚠');
        const stepLines = layoutMixed(`${idx + 1}.  ${s.text}`, CW - 4, 8.5);
        const blockH = stepLines.length * lhS + (isWarn ? 3 : 1.5);
        guard(blockH + 1);
        if (isWarn) {
          doc.setFillColor(...PDF_C.warnBg);
          doc.roundedRect(TX, y - lhS + 0.5, CW, blockH, 0.5, 0.5, 'F');
        }
        renderMixed(stepLines, TX + 3, 8.5, isWarn ? PDF_C.warnFg : PDF_C.mid, lhS);
        y += (isWarn ? 3 : 1.5) + 0.5;
      });
      y += 3;
    }

    // Affected automations — grouped by type, capped at 8 items total
    const MAX_ITEMS = 8;
    if (showItems && rec.items?.length > 0) {
      guard(14);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PDF_C.dark);
      doc.text(`Affected Automations  (${rec.items.length.toLocaleString()})`, TX, y);
      y += 5;

      const byType = {};
      for (const item of rec.items) {
        const t = item.automation_type || 'Unknown';
        if (!byType[t]) byType[t] = [];
        byType[t].push(item.api_name);
      }

      let totalShown = 0;
      for (const [typeName, names] of Object.entries(byType)) {
        if (totalShown >= MAX_ITEMS) break;
        guard(10);
        const canShow = MAX_ITEMS - totalShown;
        const showing = names.slice(0, canShow);
        totalShown += showing.length;
        const hiddenInType = names.length - showing.length;

        // Type label (bold, muted)
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...PDF_C.muted);
        doc.text(`${typeName}  (${names.length.toLocaleString()})`, TX, y);
        y += lhOf(7.5);

        // Names (normal, indented)
        const nameStr = showing.join(', ') + (hiddenInType > 0 ? `, +${hiddenInType.toLocaleString()} more` : '');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...PDF_C.mid);
        const nameLines = doc.splitTextToSize(nameStr, CW - 6);
        nameLines.forEach((l) => { doc.text(l, TX + 4, y); y += lhOf(8); });
        y += 1.5;
      }

      const totalHidden = rec.items.length - totalShown;
      if (totalHidden > 0) {
        guard(5);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...PDF_C.muted);
        doc.text(`+ ${totalHidden.toLocaleString()} additional automation${totalHidden !== 1 ? 's' : ''} not shown`, TX, y);
        y += 5;
      }
      y += 2;
    }

    // Left severity border strip (drawn last, spans full card height)
    doc.setFillColor(...sev.border);
    doc.rect(ML, cardStartY - 1, BORD, y - cardStartY + 1, 'F');
  };

  // ── Legacy item cards (one page per automation, matching frontend LegacyItemCard) ──
  const renderLegacyItemCard = (item, parentRec) => {
    doc.addPage();
    y = 15;
    legacyItemPageMap.set(item.id, doc.internal.getCurrentPageInfo().pageNumber);

    const sev = PDF_C.severity[parentRec.severity] || PDF_C.severity.info;
    const cardStartY = y;

    // Section crumb + rule
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_C.muted);
    doc.text('ACTIVE LEGACY AUTOMATION', TX, y);
    y += 4.5;
    doc.setDrawColor(...PDF_C.rule);
    doc.line(TX, y, PW - MR, y);
    y += 5;

    // Title: item api_name + severity / effort / status badges
    const titleY = y;
    let bx = TX;
    bx = mkBadge(parentRec.severity.toUpperCase(), bx, titleY, sev.badgeBg, sev.badgeFg, 7);

    const effortLabel = EFFORT_LABEL[parentRec.effort_estimate] || parentRec.effort_estimate;
    const statusLabel = parentRec.status !== 'open'
      ? parentRec.status.charAt(0).toUpperCase() + parentRec.status.slice(1)
      : null;
    doc.setFontSize(7);
    let rightW = doc.getTextWidth(effortLabel) + 6;
    if (statusLabel) rightW += doc.getTextWidth(statusLabel) + 6;

    const titleMaxW = PW - bx - MR - rightW - 4;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_C.dark);
    const titleLines = doc.splitTextToSize(item.api_name, titleMaxW);
    doc.text(titleLines[0], bx, titleY);

    let rbx = PW - MR - rightW + 2;
    rbx = mkBadge(effortLabel, rbx, titleY, PDF_C.bgLt, PDF_C.muted, 7, false);
    if (statusLabel) {
      const st = PDF_C.status[parentRec.status] || { bg: PDF_C.bgLt, fg: PDF_C.muted };
      mkBadge(statusLabel, rbx, titleY, st.bg, st.fg, 7);
    }

    const tlh = lhOf(12);
    titleLines.slice(1).forEach((l) => { y += tlh; doc.text(l, TX, y); });
    y += tlh + 3;

    // Subtitle: automation type · object name
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_C.muted);
    doc.text(item.automation_type + (item.object_name ? `  ·  ${item.object_name}` : ''), TX, y);
    y += 7;

    // Retirement rationale (mirrors LegacyItemCard frontend text)
    const retiredLabel = item.automation_type === 'Workflow Rule' ? 'Workflow Rules' : 'Process Builder';
    const rationaleText =
      `"${item.api_name}" is an active ${item.automation_type}` +
      (item.object_name ? ` on ${item.object_name}` : '') +
      `. Salesforce has announced the retirement of ${retiredLabel} — ` +
      (parentRec.recommended_path
        ? `the recommended migration path is to ${parentRec.recommended_path.charAt(0).toLowerCase() + parentRec.recommended_path.slice(1)}.`
        : 'this automation must be migrated before the retirement deadline.');
    renderMixed(layoutMixed(rationaleText, CW, 8.5), TX, 8.5, PDF_C.mid, lhOf(8.5));
    y += 5;

    // Path box
    const pathRows = [
      { label: 'Recommended:', text: parentRec.recommended_path, muted: false },
      parentRec.alternative_path ? { label: 'Alternative:', text: parentRec.alternative_path, muted: true } : null,
    ].filter(Boolean);

    const lhP = lhOf(8.5);
    let pathBoxH = 3;
    doc.setFontSize(8.5);
    pathRows.forEach((pr) => {
      doc.setFont('helvetica', 'bold');
      const labelW = doc.getTextWidth(pr.label);
      doc.setFont('helvetica', 'normal');
      pathBoxH += doc.splitTextToSize(sanitizePdfText(pr.text) || '', CW - labelW - 8).length * lhP + 2;
    });
    pathBoxH += 2;

    guard(pathBoxH + 4);
    doc.setFillColor(...PDF_C.pathBg);
    doc.setDrawColor(...PDF_C.pathBd);
    doc.roundedRect(TX, y, CW, pathBoxH, 1, 1, 'FD');
    y += 5;

    pathRows.forEach((pr) => {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(pr.muted ? PDF_C.muted : PDF_C.dark));
      const labelW = doc.getTextWidth(pr.label);
      doc.text(pr.label, TX + 3, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...(pr.muted ? PDF_C.muted : PDF_C.mid));
      const textLines = doc.splitTextToSize(sanitizePdfText(pr.text) || '', CW - labelW - 8);
      textLines.forEach((l, li) => {
        if (li === 0) doc.text(l, TX + 3 + labelW + 2, y);
        else { y += lhP; doc.text(l, TX + 3, y); }
      });
      y += lhP + 2;
    });
    y += 3;

    // Implementation steps
    if ((parentRec.steps || []).length > 0) {
      guard(14);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PDF_C.dark);
      doc.text('Implementation Steps', TX, y);
      y += 5;

      const lhS = lhOf(8.5);
      (parentRec.steps || []).forEach((s) => {
        const isWarn = typeof s.text === 'string' && s.text.startsWith('⚠');
        const stepLines = layoutMixed(`${s.step}.  ${s.text}`, CW - 4, 8.5);
        const blockH = stepLines.length * lhS + (isWarn ? 3 : 1.5);
        guard(blockH + 1);
        if (isWarn) {
          doc.setFillColor(...PDF_C.warnBg);
          doc.roundedRect(TX, y - lhS + 0.5, CW, blockH, 0.5, 0.5, 'F');
        }
        renderMixed(stepLines, TX + 3, 8.5, isWarn ? PDF_C.warnFg : PDF_C.mid, lhS);
        y += (isWarn ? 3 : 1.5) + 0.5;
      });
      y += 3;
    }

    // Left severity border strip
    doc.setFillColor(...sev.border);
    doc.rect(ML, cardStartY - 1, BORD, y - cardStartY + 1, 'F');
  };

  pdfLegacyItems.forEach(({ item, parentRec }) => renderLegacyItemCard(item, parentRec));
  pdfObjectRecs.forEach((rec) => renderCard(rec, 'Object-Level Recommendation'));
  pdfOrgRecs.forEach((rec) => renderCard(rec, 'Org-Level Recommendation', false));

  // ── Page numbers & footer (all pages except cover) ───────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...PDF_C.rule);
    doc.line(ML, PH - 8, PW - MR, PH - 8);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_C.muted);
    doc.text(`10K Smart Automation Wizard${org?.name ? `  ·  ${org.name}` : ''}  ·  Scan #${scan.id}`, ML, PH - 4);
    doc.text(`${p} / ${totalPages}`, PW - MR, PH - 4, { align: 'right' });
  }

  // ── TOC page numbers + internal links (post-pass) ────────────────────────────
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  for (const entry of tocEntries) {
    const pageNum = recPageMap.get(entry.recId);
    if (pageNum == null) continue;
    doc.setPage(entry.tocPage);
    doc.setTextColor(...PDF_C.muted);
    doc.text(`p. ${pageNum}`, PW - MR, entry.rowY, { align: 'right' });
    doc.link(ML, entry.rowY - 4.5, PW - ML - MR, 5.5, { pageNumber: pageNum });
  }
  for (const entry of legacyTocEntries) {
    const pageNum = legacyItemPageMap.get(entry.itemId);
    if (pageNum == null) continue;
    doc.setPage(entry.tocPage);
    doc.setTextColor(...PDF_C.muted);
    doc.text(`p. ${pageNum}`, PW - MR, entry.rowY, { align: 'right' });
    doc.link(ML, entry.rowY - 4.5, PW - ML - MR, 5.5, { pageNumber: pageNum });
  }

  doc.save(`10k-smart-automation-wizard-recommendations-scan-${scan.id}.pdf`);
}

// ── Legacy item card — one per automation, shares parent rec metadata ─────────
function LegacyItemCard({ item, parentRec, expandedSteps, toggleSteps, handleStatusChange, onRemediate }) {
  const isExpanded = expandedSteps.has(item.id);

  return (
    <div className={`rec-card${parentRec.status !== 'open' ? ` rec-card--${parentRec.status}` : ''}`}>
      <div className="rec-card-header">
        <div className="rec-card-title-row">
          <h3 className="rec-title">{item.api_name}</h3>
          <span className="effort-badge">{EFFORT_LABEL[parentRec.effort_estimate]}</span>
          {parentRec.status !== 'open' && (
            <span className={`status-badge status-badge--${parentRec.status}`}>
              {parentRec.status}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--c-muted)', marginTop: '0.2rem' }}>
          {item.automation_type}{item.object_name ? ` · ${item.object_name}` : ''}
        </div>
      </div>

      <div className="rec-rationale-block">
        <p className="rec-rationale">
          {`"${item.api_name}" is an active ${item.automation_type}${item.object_name ? ` on ${item.object_name}` : ''}. ` +
           `Salesforce has announced the retirement of ${item.automation_type === 'Workflow Rule' ? 'Workflow Rules' : 'Process Builder'} — ` +
           (parentRec.recommended_path
             ? `the recommended migration path is to ${parentRec.recommended_path.charAt(0).toLowerCase() + parentRec.recommended_path.slice(1)}.`
             : 'this automation must be migrated before the retirement deadline.')}
        </p>
      </div>

      <div className="rec-path-row">
        <div className="rec-path">
          <span className="rec-path-label">Recommended:</span>
          <span className="rec-path-text">{parentRec.recommended_path}</span>
        </div>
        {parentRec.alternative_path && (
          <div className="rec-path rec-path--alt">
            <span className="rec-path-label">Alternative:</span>
            <span className="rec-path-text">{parentRec.alternative_path}</span>
          </div>
        )}
      </div>

      <div className="rec-toggles">
        <button className="rec-toggle-btn" onClick={() => toggleSteps(item.id)}>
          {isExpanded ? '▾' : '▸'} Implementation Steps ({(parentRec.steps || []).length.toLocaleString()})
        </button>
      </div>

      {isExpanded && (
        <ol className="rec-steps">
          {(parentRec.steps || []).map((s, i) => (
            <li
              key={i}
              className={s.text.startsWith('⚠') ? 'rec-step rec-step--warning' : 'rec-step'}
            >
              {renderBold(s.text)}
            </li>
          ))}
        </ol>
      )}

      <div className="rec-actions">
        {parentRec.status !== 'accepted' && (
          <button className="rec-action-btn rec-action-btn--accept" onClick={() => handleStatusChange(parentRec, 'accepted')}>
            Accept
          </button>
        )}
        {parentRec.status !== 'dismissed' && (
          <button className="rec-action-btn rec-action-btn--dismiss" onClick={() => handleStatusChange(parentRec, 'dismissed')}>
            Dismiss
          </button>
        )}
        {parentRec.status !== 'open' && (
          <button className="rec-action-btn" onClick={() => handleStatusChange(parentRec, 'open')}>
            Reopen
          </button>
        )}
        {parentRec.status === 'accepted' && (
          <button className="rec-action-btn rec-action-btn--remediate" onClick={() => onRemediate && onRemediate(parentRec)}>
            Remediate
          </button>
        )}
      </div>
    </div>
  );
}

// ── Reusable card component ───────────────────────────────────────────────────
function RecCard({ rec, expandedSteps, expandedItems, toggleSteps, toggleItems, handleStatusChange, onRemediate }) {
  const stepsExpanded = expandedSteps.has(rec.id);
  const itemsExpanded = expandedItems.has(rec.id);

  return (
    <div className={`rec-card${rec.status !== 'open' ? ` rec-card--${rec.status}` : ''}`}>
      <div className="rec-card-header">
        <div className="rec-card-title-row">
          <h3 className="rec-title">{rec.title}</h3>
          <span className="effort-badge">{EFFORT_LABEL[rec.effort_estimate]}</span>
          {rec.status !== 'open' && (
            <span className={`status-badge status-badge--${rec.status}`}>
              {rec.status}
            </span>
          )}
        </div>
      </div>

      <div className="rec-rationale-block">
        <p className="rec-rationale">{renderBold(rec.llm_rationale || rec.rationale)}</p>
        {rec.llm_rationale && <span className="ai-badge">AI-enhanced</span>}
      </div>

      {rec.conflict_analysis && (
        <div className={`rec-conflict-block rec-conflict-block--${rec.conflict_severity || 'medium'}`}>
          <div className="rec-conflict-header">
            <span className="rec-conflict-icon">⚡</span>
            <span className="rec-conflict-label">Conflict Analysis</span>
            {rec.conflict_severity && (
              <span className={`rec-conflict-severity rec-conflict-severity--${rec.conflict_severity}`}>
                {rec.conflict_severity}
              </span>
            )}
          </div>
          <p className="rec-conflict-text">{renderBold(rec.conflict_analysis)}</p>
        </div>
      )}

      <div className="rec-path-row">
        <div className="rec-path">
          <span className="rec-path-label">Recommended:</span>
          <span className="rec-path-text">{rec.recommended_path}</span>
        </div>
        {rec.alternative_path && (
          <div className="rec-path rec-path--alt">
            <span className="rec-path-label">Alternative:</span>
            <span className="rec-path-text">{rec.alternative_path}</span>
          </div>
        )}
      </div>

      <div className="rec-toggles">
        <button className="rec-toggle-btn" onClick={() => toggleSteps(rec.id)}>
          {stepsExpanded ? '▾' : '▸'} Implementation Steps ({(rec.steps || []).length.toLocaleString()})
        </button>
        {rec.items?.length > 0 && (
          <button className="rec-toggle-btn" onClick={() => toggleItems(rec.id)}>
            {itemsExpanded ? '▾' : '▸'} Affected Automations ({rec.items.length.toLocaleString()})
          </button>
        )}
      </div>

      {stepsExpanded && (
        <ol className="rec-steps">
          {(rec.steps || []).map((s) => (
            <li
              key={s.step}
              className={s.text.startsWith('⚠') ? 'rec-step rec-step--warning' : 'rec-step'}
            >
              {renderBold(s.text)}
            </li>
          ))}
        </ol>
      )}

      {itemsExpanded && rec.items?.length > 0 && (
        <table className="rec-items-table">
          <thead>
            <tr>
              <th>Automation</th>
              <th>Type</th>
              <th>Object</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rec.items.map((item) => (
              <tr key={item.id}>
                <td><code>{item.api_name}</code></td>
                <td>{item.automation_type}</td>
                <td>{item.object_name || '—'}</td>
                <td>{item.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="rec-actions">
        {rec.status !== 'accepted' && (
          <button
            className="rec-action-btn rec-action-btn--accept"
            onClick={() => handleStatusChange(rec, 'accepted')}
          >
            Accept
          </button>
        )}
        {rec.status !== 'dismissed' && (
          <button
            className="rec-action-btn rec-action-btn--dismiss"
            onClick={() => handleStatusChange(rec, 'dismissed')}
          >
            Dismiss
          </button>
        )}
        {rec.status !== 'open' && (
          <button
            className="rec-action-btn"
            onClick={() => handleStatusChange(rec, 'open')}
          >
            Reopen
          </button>
        )}
        {rec.status === 'accepted' && (
          <button
            className="rec-action-btn rec-action-btn--remediate"
            onClick={() => onRemediate && onRemediate(rec)}
          >
            Remediate
          </button>
        )}
      </div>
    </div>
  );
}

export default function Recommendations({ scan, runId, org, onBack, embedded }) {
  const [recs, setRecs] = useState(null);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [activeTab, setActiveTab] = useState('object');
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [expandedSteps, setExpandedSteps] = useState(new Set());
  const [remediatingRec, setRemediatingRec] = useState(null);

  useEffect(() => {
    getRecommendations(scan.id, runId)
      .then(setRecs)
      .catch(() => setError('Failed to load recommendations.'));
  }, [scan.id, runId]);

  const handleStatusChange = async (rec, status) => {
    const updated = await updateRecommendationStatus(rec.id, status);
    setRecs((prev) => prev.map((r) => (r.id === rec.id ? { ...r, ...updated } : r)));
  };

  const toggleItems = (id) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSteps = (id) =>
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const filtered = recs
    ? recs
        .filter((r) => !statusFilter || statusFilter === 'all' || r.status === statusFilter)
        .sort((a, b) => b.priority_score - a.priority_score)
    : [];

  const legacyRecs = filtered.filter((r) => r.pattern === 'global_legacy');
  const objectRecs = filtered
    .filter((r) => !GLOBAL_PATTERNS.has(r.pattern) && r.pattern !== 'global_legacy')
    .sort((a, b) => (a.object_name || '').localeCompare(b.object_name || ''));
  const orgRecs = filtered.filter((r) => GLOBAL_PATTERNS.has(r.pattern));
  const activeRecs = activeTab === 'object' ? objectRecs : orgRecs;
  // Flatten all items across legacy recs for per-item display
  const legacyItems = legacyRecs.flatMap((r) => (r.items || []).map((item) => ({ item, parentRec: r })));

  const counts = recs ? severityCounts(recs) : {};
  const score = recs ? complexityScore(recs) : 0;

  return (
    <div className="recommendations-page">
      {!embedded && (
        <button className="back-btn" onClick={onBack}>
          ← Analysis Run #{runId}
        </button>
      )}

      <div className="scan-header">
        <div>
          <h2>Recommendations</h2>
          {recs && (
            <p style={{ margin: '0.25rem 0 0' }}>
              {recs.length.toLocaleString()} recommendation{recs.length !== 1 ? 's' : ''} —{' '}
              {counts.error > 0 && <span className="severity-error">{counts.error.toLocaleString()} error{counts.error !== 1 ? 's' : ''} </span>}
              {counts.warning > 0 && <span className="severity-warning">{counts.warning.toLocaleString()} warning{counts.warning !== 1 ? 's' : ''} </span>}
              {counts.info > 0 && <span className="severity-info">{counts.info.toLocaleString()} info </span>}
              — Remediation Complexity Score: <strong>{score.toLocaleString()}</strong>
            </p>
          )}
        </div>
        {recs && (
          <button className="primary-btn" onClick={async () => {
            const inv = await getInventory(scan.id);
            exportPDF(recs, scan, org, inv);
          }}>
            Export PDF
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {recs === null && !error && <p>Loading recommendations...</p>}

      {recs !== null && (
        <>
          <div className="rec-tab-bar">
            <div className="rec-tabs">
              <button
                className={`rec-tab${activeTab === 'object' ? ' rec-tab--active' : ''}`}
                onClick={() => setActiveTab('object')}
              >
                Object-Level
                <span className="rec-tab-count">{objectRecs.length.toLocaleString()}</span>
              </button>
              <button
                className={`rec-tab${activeTab === 'org' ? ' rec-tab--active' : ''}`}
                onClick={() => setActiveTab('org')}
              >
                Org-Level
                <span className="rec-tab-count">{orgRecs.length.toLocaleString()}</span>
              </button>
              <button
                className={`rec-tab${activeTab === 'legacy' ? ' rec-tab--active' : ''}`}
                onClick={() => setActiveTab('legacy')}
              >
                Active Legacy
                <span className="rec-tab-count">{legacyItems.length.toLocaleString()}</span>
              </button>
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rec-status-filter">
              <option value="open">Open</option>
              <option value="accepted">Accepted</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All Statuses</option>
            </select>
          </div>

          <p className="rec-tab-desc">
            {activeTab === 'object'
              ? 'Consolidation plans for individual Salesforce objects with complex or conflicting automation stacks.'
              : activeTab === 'org'
              ? 'Org-wide housekeeping and quality improvements that apply across all objects.'
              : 'Workflow Rules and Process Builder are retired by Salesforce and must be migrated to Flow.'}
          </p>

          {activeTab === 'legacy' && (
            <div className="rec-list">
              {legacyItems.length === 0 ? (
                <p>No active legacy automations found.</p>
              ) : (
                legacyItems.map(({ item, parentRec }) => (
                  <LegacyItemCard
                    key={item.id}
                    item={item}
                    parentRec={parentRec}
                    expandedSteps={expandedSteps}
                    toggleSteps={toggleSteps}
                    handleStatusChange={handleStatusChange}
                    onRemediate={setRemediatingRec}
                  />
                ))
              )}
            </div>
          )}

          {activeTab !== 'legacy' && (
            <>
              {activeRecs.length === 0 && (
                <p>No recommendations match the current filters.</p>
              )}
              <div className="rec-list">
                {activeRecs.map((rec) => (
                  <RecCard
                    key={rec.id}
                    rec={rec}
                    expandedSteps={expandedSteps}
                    expandedItems={expandedItems}
                    toggleSteps={toggleSteps}
                    toggleItems={toggleItems}
                    handleStatusChange={handleStatusChange}
                    onRemediate={setRemediatingRec}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {remediatingRec && (
        <RemediationModal
          recommendation={remediatingRec}
          onClose={() => {
            setRemediatingRec(null);
            getRecommendations(scan.id, runId).then(setRecs).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
