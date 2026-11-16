// Assessment report: built from the saved map project as a list of blocks, then rendered as
// printable HTML (save as PDF from the print dialog) and as a Word document (docx library).
/* global docx */
import { VEHICLES, KPH_PER_MPH, MASS_KG, nextTestSpeed, buildRouteSpeeds, startArg } from './maths.js';
import { resolveVector, pathLength } from './model.js';
import { requiredProtection, draftDesignation } from './summary.js';
import { VERSION } from './version.js';
import { loadJSON, getBlob } from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const project = loadJSON('vda-map-project-v1');

// ---------- data ----------
function analyse(p) {
  const unit = p.settings?.unit === 'MPH' ? 'mph' : 'km/h';
  const conv = (kph) => (p.settings?.unit === 'MPH' ? kph / KPH_PER_MPH : kph);
  const results = new Map();
  for (const v of p.vectors) {
    const r = resolveVector(p, v);
    if (r.errors.length || !r.sections.length || !r.crossing) { results.set(v.id, { ...r, speeds: null }); continue; }
    const row = buildRouteSpeeds(r.sections, startArg(v.start, v.entryKph))[0].exitSpeeds;
    const speeds = Object.fromEntries(VEHICLES.map((c) => [c.id, row.get(c.id).speed]));
    results.set(v.id, { ...r, speeds, worst: Math.max(...Object.values(speeds)), runUp: pathLength(r.crossing.points) });
  }
  const sections = requiredProtection(p.lops, p.vectors.map((v) => ({ vector: v, result: results.get(v.id) })));
  const firm = p.vectors.filter((v) => v.status !== 'suggested' && v.status !== 'rejected' && results.get(v.id)?.speeds);
  const sectionOf = (v) => { const r = results.get(v.id); return sections.find((s) => s.lopId === r.crossing.lopId && s.edges.includes(r.crossing.lopSegment)); };
  return { unit, conv, results, sections, firm, sectionOf, pending: p.vectors.filter((v) => v.status === 'suggested'), rejected: p.vectors.filter((v) => v.status === 'rejected') };
}

const startText = (v, A) => (v.start === 'STANDING' ? 'Standing' : v.start === 'ENTRY' ? (v.entryKph > 0 ? `Entry ${Math.round(A.conv(v.entryKph))} ${A.unit}` : 'Standing') : 'Rolling');
const CAP_NAMES = { stop: 'forced stop', gate: 'gate or barrier arm', chicane: 'chicane', hump: 'speed table or hump', other: 'speed limit' };
const capsText = (v, A) => (v.caps || []).map((c) => (c.type === 'stop' ? 'forced stop' : `${CAP_NAMES[c.type] || 'limit'} ≤${Math.round(A.conv(c.kph))} ${A.unit}`)).join('; ') || '–';
const SECTION_NAME = { STRAIGHT: 'Straight', CURVE_LEFT: 'Left curve', CURVE_RIGHT: 'Right curve' };

// ---------- blocks ----------
function buildBlocks(p, A, mapImage) {
  const d = p.details || {};
  const issue = (p.issues || [])[p.issues?.length - 1];
  const B = [];
  const h = (level, text) => B.push({ t: `h${level}`, text });
  const para = (text, cls) => B.push({ t: 'p', text, cls });
  const table = (headers, rows, numFrom = 1) => B.push({ t: 'table', headers, rows, numFrom });
  const list = (items) => B.push({ t: 'list', items });

  B.push({ t: 'title', text: p.title || 'Vehicle dynamics assessment', sub: 'Vehicle dynamics assessment for hostile vehicle mitigation' });
  B.push({ t: 'kv', rows: [
    ['Site', d.site || '–'], ['Client', d.client || '–'], ['Assessor', d.assessor || '–'], ['Reviewer', d.reviewer || '–'],
    ['Assessment date', d.date || '–'],
    ['Version', issue ? (p.locked ? `${issue.n}, issued ${issue.date}` : `Draft of version ${issue.n + 1} (version ${issue.n} issued ${issue.date})`) : 'Draft (not issued)'],
    ['Protective marking', p.marking || 'None'], ...(d.handling ? [['Handling', d.handling]] : []),
    ['Prepared with', `VDA Tool v${VERSION}`],
  ] });

  // 1 Summary
  h(2, '1. Summary');
  const assets = p.assets.map((a) => a.name).join(', ') || 'the asset';
  para(`This assessment estimates the highest speeds that six classes of hostile vehicle could reach where they meet the line of protection around ${assets}, from the acceleration and cornering each class can achieve along the possible approach routes.`);
  if (A.firm.length) {
    const top = A.firm.map((v) => ({ v, r: A.results.get(v.id) })).sort((a, b) => b.r.worst - a.r.worst)[0];
    const cls = VEHICLES.find((c) => top.r.speeds[c.id] === top.r.worst);
    const sec = A.sectionOf(top.v);
    B.push({ t: 'callout', text: `The highest impact speed is ${Math.round(A.conv(top.r.worst))} ${A.unit} (${cls.name})${sec ? ` at section ${sec.label}` : ''}, by vector ${top.v.name}: ${startText(top.v, A).toLowerCase()} start, ${Math.round(top.r.runUp)} m run-up, impact angle ${Math.round(top.r.crossing.angle)}°.` });
    h(3, 'Highest impact speed by vehicle class');
    table(['Vehicle class', `Impact speed (${A.unit})`, 'Lowest test speed at or above it (km/h)', 'Section', 'Vector'], VEHICLES.map((c) => {
      const best = A.firm.map((v) => ({ v, s: A.results.get(v.id).speeds[c.id] })).sort((a, b) => b.s - a.s)[0];
      return [c.name, Math.round(A.conv(best.s)), nextTestSpeed(best.s) ?? '> 112', A.sectionOf(best.v)?.label || '–', best.v.name];
    }), 1);
  } else para('No vectors have been accepted or drawn yet, so there are no results.', 'warn');
  const issues = [];
  if (A.pending.length) issues.push(`${A.pending.length} automatically found vector${A.pending.length === 1 ? ' has' : 's have'} not been reviewed and ${A.pending.length === 1 ? 'is' : 'are'} not included.`);
  const uncovered = A.sections.filter((s) => !s.governing).map((s) => s.label);
  if (uncovered.length) issues.push(`No accepted vector crosses section${uncovered.length === 1 ? '' : 's'} ${uncovered.join(', ')}.`);
  if (p.plan && !p.plan.scale) issues.push('The site plan has not been scaled.');
  if (p.plan?.check && Math.abs(p.plan.check.errPct) > 2) issues.push(`The site plan scale check is out by ${p.plan.check.errPct.toFixed(1)} %.`);
  if (issues.length) B.push({ t: 'callout', cls: 'warn', text: `Open points: ${issues.join(' ')}` });

  // 2 Map
  h(2, '2. Site and attack vectors');
  if (mapImage?.all) B.push({ t: 'image', blob: mapImage.all, caption: `Figure 1. Site overview: the asset (blue, hatched), the line of protection in lettered sections labelled with the highest impact speed each must resist, the accepted and drawn attack vectors coloured by impact speed, and speed-limiting features. Speeds in ${A.unit}.` });
  if (mapImage?.site) B.push({ t: 'image', blob: mapImage.site, caption: `Figure ${mapImage.all ? 2 : 1}. Close-up of the asset and the line of protection sections.` });
  if (!mapImage?.all && !mapImage?.site) para('No map image was captured. Use "Create report" on the map page to include one.', 'note');

  // 3 Required protection
  h(2, '3. Required protection by section');
  para('Each line of protection is divided into sections at its corners. The figures for a section come from the fastest accepted or drawn vector crossing it. The test speed is the lowest standard vehicle impact test speed (16, 32, 48, 64, 80, 96 or 112 km/h) at or above the impact speed.');
  table(['Section', 'Line', 'Length (m)', 'Governing vector', 'Angle (°)', ...VEHICLES.map((c) => `${c.name} ${A.unit} (test km/h)`)],
    A.sections.map((s) => [s.label, s.lopName, Math.round(s.length), s.governing?.name || 'none', s.governing ? Math.round(s.governing.angle) : '–', ...VEHICLES.map((c) => (s.speeds[c.id] == null ? '–' : `${Math.round(A.conv(s.speeds[c.id]))} (${s.tests[c.id] ?? '>112'})`))]), 2);

  h(3, 'Draft barrier performance requirements');
  B.push({ t: 'callout', cls: 'warn', text: 'Draft only. The mapping of this tool\'s vehicle classes to the test vehicles of ISO 22343, IWA 14-1, PAS 68 and ASTM F2656 has not yet been confirmed. The designations below use this tool\'s class codes and nominal masses at a 90° impact; confirm them against the standard before specifying products.' });
  table(['Section', ...VEHICLES.map((c) => c.name)], A.sections.filter((s) => s.governing).map((s) => [s.label, ...VEHICLES.map((c) => draftDesignation(c.id, s.tests[c.id]))]), 99);

  // 4 Vectors
  h(2, '4. Attack vectors');
  para(`Vectors are approach routes a hostile vehicle could take to the line of protection. ${p.vectors.some((v) => v.source === 'generated') ? 'Some were found automatically and reviewed by the assessor; others were drawn by the assessor.' : 'They were drawn by the assessor.'}`);
  table(['Vector', 'Origin', 'Section', 'Start', 'Run-up (m)', 'Angle (°)', 'Speed-limiting features', ...VEHICLES.map((c) => `${c.name} (${A.unit})`)],
    A.firm.map((v) => { const r = A.results.get(v.id); return [v.name, v.source === 'generated' ? 'found, accepted' : 'drawn', A.sectionOf(v)?.label || '–', startText(v, A), Math.round(r.runUp), Math.round(r.crossing.angle), capsText(v, A), ...VEHICLES.map((c) => Math.round(A.conv(r.speeds[c.id])))]; }), 4);
  const notes = A.firm.filter((v) => v.note).map((v) => `${v.name}: ${v.note}`);
  if (notes.length) { h(3, 'How the found vectors run'); list(notes); }
  if (A.rejected.length) { h(3, 'Vectors considered and rejected'); table(['Vector', 'Reason'], A.rejected.map((v) => [v.name, v.statusReason || '–']), 99); }

  // 5 Method
  h(2, '5. Method');
  list([
    'Speeds come from fitted acceleration curves for six vehicle classes (1.5 t car, 2.5 t pick-up, 3.5 t flatbed, 7.5 t, 18 t and 30 t rigid). Each class reaches its top speed after 440 m and never exceeds it.',
    'In bends, speed is limited to v = √(μ·r·g) for each class\'s tyre friction μ, capped at its slip speed. Bends wider than 150 m do not limit speed.',
    'Start conditions: a standing start is from rest at the start of the vector; an entry speed starts at that speed; a rolling start is already at top speed, as if the run-up before the vector were unlimited.',
    'Speed-limiting features cap the speed at that point (a forced stop restarts vehicles from rest); vehicles then accelerate again.',
    'Drawn vectors follow the assessor\'s route, with each bend given the largest radius that fits between its neighbouring points (the fastest line) unless the assessor fixed a radius.',
    ...(p.vectors.some((v) => v.source === 'generated') ? ['Found vectors come from an automatic search of straight runs over open ground, runs round building corners and routes along the road network within the study radius. Bends use the largest radius that keeps clear of obstacles; routes keep 1 m clear. Each was accepted or rejected by the assessor.'] : []),
    p.osm ? `Buildings, mapped walls and roads come from OpenStreetMap (loaded ${String(p.osm.at || '').slice(0, 10)}). Anything else counts as drivable.` : 'Obstacles are those drawn by the assessor. Anything else counts as drivable.',
    'Impact angle is between the vehicle\'s final heading and the line of protection (90° is head-on). Impact energy uses nominal class masses.',
  ]);

  // 6 Assumptions
  h(2, '6. Assumptions and limitations');
  list([
    'Flat, level, dry surfaces and a driver achieving the maximum possible acceleration and cornering; no gradient, camber or surface effects.',
    'Braking into a bend is instant and the bend speed is held through it.',
    'Grass, verges, footways and kerbs are treated as drivable at road grip, which overstates speed there.',
    'Vehicle width is not modelled for drawn vectors.',
    'The acceleration curves are empirical fits; the results are only as good as their source data. The engine is designed to match the NPSA HOVVA tool and can be checked against it with the verification pack supplied with the tool.',
    'Missing or out-of-date buildings in OpenStreetMap change the results; the assessor should confirm the site on the ground.',
    'Barrier designations are drafts until the vehicle class mapping to each standard is confirmed.',
    'These results support, but do not replace, a competent specialist assessment.',
  ]);

  // 7 Plan
  if (p.plan) {
    h(2, '7. Site plan and scale');
    const pl = p.plan;
    B.push({ t: 'kv', rows: [
      ['Plan', pl.name], ['Scale', pl.scale ? `${(pl.placement.s * 1000).toFixed(2)} mm per pixel, set from ${pl.scale.metres} m between two points` : 'Not set'],
      ['Scale check', pl.check ? `${pl.check.measured.toFixed(2)} m measured against ${pl.check.known} m known (${pl.check.errPct > 0 ? '+' : ''}${pl.check.errPct.toFixed(1)} %)` : 'Not checked'],
      ['Alignment to map', pl.align ? `${pl.align.residuals.length} control points, worst residual ${Math.max(...pl.align.residuals).toFixed(2)} m` : 'Not aligned'],
    ] });
  }
  if (d.notes) { h(2, `${p.plan ? 8 : 7}. Notes`); para(d.notes); }

  // Appendices
  B.push({ t: 'break' });
  h(2, 'Appendix A. Vector sections in HOVVA order');
  para('Each vector\'s sections listed from the asset back to the start of the route, the order the NPSA HOVVA tool uses, so the results can be checked in it. Left and right are the driver\'s, driving towards the asset.');
  for (const v of A.firm) {
    const r = A.results.get(v.id);
    h(3, `${v.name} (${startText(v, A).toLowerCase()} start)`);
    table(['No.', 'Type', 'Length (m)', 'Radius (m)', 'Speed limit at end'], r.sections.map((s, i) => [i + 1, SECTION_NAME[s.sType], (Math.round(s.sLength * 10) / 10).toFixed(1), s.sType === 'STRAIGHT' ? '' : (Math.round(s.radius * 10) / 10).toFixed(1), s.capAfter == null ? '' : s.capAfter === 0 ? 'stop' : `${Math.round(A.conv(s.capAfter))} ${A.unit}`]), 2);
  }
  h(2, 'Appendix B. Version history');
  table(['Version', 'Issued', 'By'], (p.issues || []).length ? p.issues.map((x) => [x.n, x.date, x.by || '–']) : [['–', 'Not issued', '–']], 99);
  B.push({ t: 'p', cls: 'note', text: `Speeds in ${A.unit}. Impact energies for reference: ${VEHICLES.map((c) => `${c.name} ${(MASS_KG[c.id] / 1000).toFixed(1)} t`).join(', ')}.` });
  return B;
}

// ---------- HTML ----------
async function renderHTML(B) {
  let html = '';
  for (const b of B) {
    if (b.t === 'title') html += `<h1>${esc(b.text)}</h1><p class="subtitle">${esc(b.sub)}</p>`;
    else if (b.t === 'h2' || b.t === 'h3') html += `<${b.t}>${esc(b.text)}</${b.t}>`;
    else if (b.t === 'p') html += `<p class="${b.cls === 'note' ? 'note' : ''}">${esc(b.text)}</p>`;
    else if (b.t === 'callout') html += `<div class="callout ${b.cls || ''}">${esc(b.text)}</div>`;
    else if (b.t === 'kv') html += `<dl class="kv">${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    else if (b.t === 'list') html += `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    else if (b.t === 'table') html += `<div class="tablewrap"><table><thead><tr>${b.headers.map((x, i) => `<th class="${i >= b.numFrom ? 'num' : ''}">${esc(x)}</th>`).join('')}</tr></thead><tbody>${b.rows.length ? b.rows.map((r) => `<tr>${r.map((x, i) => `<td class="${i >= b.numFrom ? 'num' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${b.headers.length}">None</td></tr>`}</tbody></table></div>`;
    else if (b.t === 'image') html += `<figure><img src="${URL.createObjectURL(b.blob)}" alt="Site map with attack vectors"><figcaption>${esc(b.caption)}</figcaption></figure>`;
    else if (b.t === 'break') html += '<div class="page-break"></div>';
  }
  $('report').innerHTML = html;
}

// ---------- Word ----------
async function buildDocx(B, p) {
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, Header, Footer, AlignmentType, PageNumber, ShadingType, BorderStyle } = D;
  const children = [];
  const cellPara = (text, bold, right) => new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(text ?? ''), bold, size: 16 })] });
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9CED6' };
  const borders = { top: border, bottom: border, left: border, right: border };
  for (const b of B) {
    if (b.t === 'title') { children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(b.text)] }), new Paragraph({ children: [new TextRun({ text: b.sub, italics: true, color: '4B5563' })] })); }
    else if (b.t === 'h2') children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280 }, children: [new TextRun(b.text)] }));
    else if (b.t === 'h3') children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] }));
    else if (b.t === 'p') children.push(new Paragraph({ children: [new TextRun({ text: b.text, size: b.cls === 'note' ? 16 : 20, color: b.cls === 'note' ? '4B5563' : undefined })] }));
    else if (b.t === 'callout') children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: b.cls === 'warn' ? 'FFFBEB' : 'EFF6FF' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: b.cls === 'warn' ? 'D97706' : '3B82F6' } }, children: [new TextRun({ text: b.text, size: 20 })] }));
    else if (b.t === 'list') b.items.forEach((x) => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: x, size: 20 })] })));
    else if (b.t === 'kv') children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map(([k, v]) => new TableRow({ children: [new TableCell({ borders, width: { size: 30, type: WidthType.PERCENTAGE }, children: [cellPara(k, true)] }), new TableCell({ borders, children: [cellPara(v)] })] })) }));
    else if (b.t === 'table') children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ tableHeader: true, children: b.headers.map((x, i) => new TableCell({ borders, shading: { type: ShadingType.CLEAR, fill: 'EEF1F6' }, children: [cellPara(x, true, i >= b.numFrom)] })) }),
      ...(b.rows.length ? b.rows : [b.headers.map((_, i) => (i ? '' : 'None'))]).map((r) => new TableRow({ cantSplit: true, children: r.map((x, i) => new TableCell({ borders, children: [cellPara(x, false, i >= b.numFrom)] })) })),
    ] }), new Paragraph(''));
    else if (b.t === 'image') {
      const buf = await b.blob.arrayBuffer();
      const bmp = await createImageBitmap(b.blob);
      const w = 640, hgt = Math.round((bmp.height / bmp.width) * w);
      children.push(new Paragraph({ children: [new ImageRun({ data: buf, transformation: { width: w, height: hgt } })] }), new Paragraph({ children: [new TextRun({ text: b.caption, size: 16, color: '4B5563' })] }));
    } else if (b.t === 'break') children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  }
  const mark = [p.marking, p.details?.handling].filter(Boolean).join(' – ');
  const doc = new Document({
    creator: `VDA Tool v${VERSION}`, title: p.title || 'Vehicle dynamics assessment',
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: mark, bold: true, size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${mark ? mark + '   ·   ' : ''}${p.title || 'Vehicle dynamics assessment'}   ·   Page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: ' of ', size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 })] })] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

// ---------- start ----------
async function main() {
  if (!project || !Array.isArray(project.vectors)) { $('report').innerHTML = '<p>No assessment found. Open the map page, build the assessment, then choose "Create report".</p>'; return; }
  const A = analyse(project);
  const img = { all: await getBlob(`report-map:${project.id}`), site: await getBlob(`report-map-site:${project.id}`) };
  const B = buildBlocks(project, A, img);
  document.title = `${project.title || 'Assessment'} – report`;
  const mark = [project.marking, project.details?.handling].filter(Boolean).join(' – ');
  $('mark-top').textContent = mark; $('mark-bottom').textContent = mark;
  await renderHTML(B);
  $('print').onclick = () => window.print();
  $('docx').onclick = async () => {
    if (!window.docx) { $('status').textContent = 'The Word library did not load.'; return; }
    $('status').textContent = 'Building the Word document…';
    try {
      const blob = await buildDocx(B, project);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(project.title || 'vda-assessment').replace(/[^\w.-]+/g, '-')}${project.locked && project.issues?.length ? `-v${project.issues.length}` : '-draft'}.docx`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('status').textContent = 'Word document downloaded. It uses a plain default layout; send your house template to have it used instead.';
    } catch (e) { $('status').textContent = `Could not build the Word document: ${e.message}`; }
  };
}
if (typeof document !== 'undefined') main();

export { analyse, buildBlocks };
