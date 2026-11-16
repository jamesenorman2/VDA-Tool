// Word export into the owner's house template (.docx). The template is uploaded on the report page
// and kept in the browser only; it is never part of this public repository.
//
// What happens to the template (owner's choice: no front page, no contents page):
//  - everything in the template body is removed except its final section settings, so the export
//    keeps the standard page formatting (page size, margins, header and footer) and nothing else;
//  - its styles, numbering and theme are used for the assessment content;
//  - its document properties (title, client, date, protective marking, prepared for/by) are set,
//    and Word is told to refresh fields when the file opens, so they flow into the header/footer.
/* global JSZip */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS = `xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
export const xesc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- pure string helpers (tested in node) ----------

// Pick the first style id that exists in the template, so other templates degrade gracefully.
export function styleResolver(stylesXml) {
  const ids = new Set([...String(stylesXml).matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]));
  return (...prefs) => prefs.find((p) => ids.has(p)) || null;
}

// Set (or add) custom document properties. Values are plain text.
export function setCustomProps(customXml, props) {
  let xml = customXml || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';
  let pid = Math.max(1, ...[...xml.matchAll(/pid="(\d+)"/g)].map((m) => +m[1]));
  for (const [name, value] of Object.entries(props)) {
    if (value == null) continue;
    const re = new RegExp(`(<property [^>]*name="${name}"[^>]*>\\s*<vt:\\w+>)([\\s\\S]*?)(</vt:\\w+>)`);
    if (re.test(xml)) xml = xml.replace(re, (_, a, __, c) => `${a}${xesc(value)}${c}`);
    else xml = xml.replace('</Properties>', `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${++pid}" name="${name}"><vt:lpwstr>${xesc(value)}</vt:lpwstr></property></Properties>`);
  }
  return xml;
}

// Ask Word to refresh all fields (cover, headers, footers, contents) when the file is opened.
// The element must sit in the schema's order, before these siblings.
export function addUpdateFields(settingsXml) {
  let xml = settingsXml.replace(/<w:updateFields[^>]*\/>/g, '');
  const tag = '<w:updateFields w:val="true"/>';
  const before = ['<w:hdrShapeDefaults', '<w:footnotePr', '<w:endnotePr', '<w:compat', '<w:docVars', '<w:rsids', '<m:mathPr', '<w:themeFontLang', '<w:clrSchemeMapping', '<w:shapeDefaults', '<w:decimalSymbol', '<w:listSeparator'];
  const at = before.map((b) => xml.indexOf(b)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return at == null ? xml.replace('</w:settings>', `${tag}</w:settings>`) : xml.slice(0, at) + tag + xml.slice(at);
}

export function setCoreTitle(coreXml, title) {
  if (!coreXml) return coreXml;
  return /<dc:title>[\s\S]*?<\/dc:title>/.test(coreXml) ? coreXml.replace(/<dc:title>[\s\S]*?<\/dc:title>/, `<dc:title>${xesc(title)}</dc:title>`)
    : coreXml.replace(/(<cp:coreProperties[^>]*>)/, `$1<dc:title>${xesc(title)}</dc:title>`);
}

const run = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xesc(text)}</w:t></w:r>`;
const para = (style, text, extraPPr = '', rpr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extraPPr}</w:pPr>${text === '' ? '' : run(text, rpr)}</w:p>`;
const TEXT_WIDTH_TWIPS = 9000;

// Blocks (from src/report.js) to WordprocessingML body content, in the template's styles.
// images: [{ rId, cx, cy }] in block order.
export function blocksToBodyXml(blocks, S, images = []) {
  const st = {
    h1: S('Heading1'), h2: S('Heading2'), body: S('BodyText', 'Normal'), note: S('Source', 'BodyText', 'Normal'),
    bullet: S('ListBullet', 'AECOMBullets', 'ListParagraph', 'BodyText'), caption: S('Caption'), table: S('AECOMtable', 'TableGrid'),
    cell: S('Tabletext', 'TableText', 'Normal'), app: S('Appendix'), app2: S('Appendixheading2', 'Heading2'),
    title: S('Heading', 'Title', 'Heading1'),
  };
  let out = '', inAppendix = false, img = 0, figure = 0;
  const table = (headers, rows, numFrom = 99) => {
    const n = headers.length, w = Math.floor(TEXT_WIDTH_TWIPS / n);
    const cell = (text, head, right) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(st.cell, String(text ?? ''), right ? '<w:jc w:val="right"/>' : '', head ? '<w:b/>' : '')}</w:tc>`;
    const rowsXml = [
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h, i) => cell(h, true, i >= numFrom)).join('')}</w:tr>`,
      ...(rows.length ? rows : [headers.map((_, i) => (i ? '' : 'None'))]).map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, false, i >= numFrom)).join('')}</w:tr>`),
    ];
    return `<w:tbl><w:tblPr>${st.table ? `<w:tblStyle w:val="${st.table}"/>` : ''}<w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${headers.map(() => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rowsXml.join('')}</w:tbl>${para(st.body, '')}`;
  };
  for (const b of blocks) {
    if (b.t === 'title') { out += para(st.title, b.text) + para(st.body, b.sub); continue; }
    else if (b.t === 'h2') {
      const m = /^Appendix ([A-Z])\.\s*(.*)$/.exec(b.text);
      if (m) { inAppendix = true; out += st.app ? para(st.app, m[2]) : para(st.h1, b.text); }
      else out += para(st.h1, b.text.replace(/^\d+\.\s*/, ''));
    } else if (b.t === 'h3') out += para(inAppendix ? st.app2 : st.h2, b.text);
    else if (b.t === 'p') out += para(b.cls === 'note' ? st.note : st.body, b.text);
    else if (b.t === 'callout') {
      const warn = b.cls === 'warn';
      out += para(st.body, b.text, `<w:pBdr><w:left w:val="single" w:sz="24" w:space="6" w:color="${warn ? 'D97706' : '3B82F6'}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${warn ? 'FFFBEB' : 'EFF6FF'}"/>`);
    } else if (b.t === 'list') out += b.items.map((x) => para(st.bullet, x)).join('');
    else if (b.t === 'kv') out += table(['Item', 'Detail'], b.rows, 99);
    else if (b.t === 'table') out += table(b.headers, b.rows, b.numFrom);
    else if (b.t === 'image') {
      const im = images[img++]; if (!im) continue;
      figure++;
      out += `<w:p><w:pPr>${st.body ? `<w:pStyle w:val="${st.body}"/>` : ''}<w:keepNext/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${im.cx}" cy="${im.cy}"/><wp:docPr id="${9000 + figure}" name="VDA figure ${figure}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${9000 + figure}" name="vda-figure-${figure}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${im.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${im.cx}" cy="${im.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      out += para(st.caption || st.note, b.caption);
    } else if (b.t === 'break') out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
  return out;
}

// ---------- document editing (browser: DOMParser/XMLSerializer) ----------
// Replace the cached text of simple DOCPROPERTY fields so the right text shows even before Word
// refreshes fields. Nested fields (IF … DOCPROPERTY …) are left to Word's refresh.
function refreshDocPropertyFields(doc, props) {
  for (const fs of [...doc.getElementsByTagNameNS(W, 'fldSimple')]) {
    const m = /DOCPROPERTY\s+(\w+)/.exec(fs.getAttributeNS(W, 'instr') || fs.getAttribute('w:instr') || '');
    if (m && props[m[1]] != null) { const ts = [...fs.getElementsByTagNameNS(W, 't')]; if (ts[0]) { ts[0].textContent = props[m[1]]; ts.slice(1).forEach((t) => { t.textContent = ''; }); } }
  }
  for (const begin of [...doc.getElementsByTagNameNS(W, 'fldChar')].filter((f) => (f.getAttributeNS(W, 'fldCharType') || f.getAttribute('w:fldCharType')) === 'begin')) {
    let r = begin.parentNode.nextSibling, instr = '', nested = false, sep = null;
    while (r) {
      if (r.nodeType === 1) {
        const fc = r.getElementsByTagNameNS(W, 'fldChar')[0];
        const type = fc && (fc.getAttributeNS(W, 'fldCharType') || fc.getAttribute('w:fldCharType'));
        if (type === 'begin') { nested = true; break; }
        if (type === 'separate') { sep = r; break; }
        instr += [...r.getElementsByTagNameNS(W, 'instrText')].map((t) => t.textContent).join('');
      }
      r = r.nextSibling;
    }
    const m = /^\s*DOCPROPERTY\s+(\w+)/.exec(instr);
    if (nested || !sep || !m || props[m[1]] == null) continue;
    let first = true;
    for (let n = sep.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const fc = n.getElementsByTagNameNS(W, 'fldChar')[0];
      if (fc && (fc.getAttributeNS(W, 'fldCharType') || fc.getAttribute('w:fldCharType')) === 'end') break;
      for (const t of n.getElementsByTagNameNS(W, 't')) { t.textContent = first ? props[m[1]] : ''; first = false; }
    }
  }
}

/**
 * @param {Blob} templateBlob the house template (.docx)
 * @param {object[]} blocks report blocks from src/report.js
 * @param {object} info { title, subtitle, client, site, date, marking, assessor, reviewer, issues: [{n, date, by}], locked }
 * @returns {Promise<{ blob: Blob, notes: string[] }>}
 */
export async function fillWordTemplate(templateBlob, blocks, info) {
  const zip = await JSZip.loadAsync(templateBlob);
  const notes = [];
  const read = (p) => zip.file(p)?.async('string');
  const parser = new DOMParser(), ser = new XMLSerializer();

  const dateText = info.date ? new Date(`${info.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const props = {
    DocumentTitle: info.title, HeaderTitle: info.title, Subtitle: info.subtitle, SubTitle: info.subtitle,
    ClientName: info.client || '', HeaderClient: info.client || ' ', PreparedFor: info.client || ' ',
    Date: dateText, ProtectiveMarking: info.marking || '', PreparedBy: info.assessor || '',
    Draft: info.locked ? ' ' : 'DRAFT', DocumentReference: info.reference || '',
  };

  // Document properties, title, field refresh.
  zip.file('docProps/custom.xml', setCustomProps(await read('docProps/custom.xml'), props));
  if (zip.file('docProps/core.xml')) zip.file('docProps/core.xml', setCoreTitle(await read('docProps/core.xml'), info.title));
  if (zip.file('word/settings.xml')) zip.file('word/settings.xml', addUpdateFields(await read('word/settings.xml')));
  for (const name of Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) {
    const d = parser.parseFromString(await read(name), 'application/xml');
    refreshDocPropertyFields(d, props);
    zip.file(name, ser.serializeToString(d));
  }

  // Images: add to the package and relationships.
  const relsName = 'word/_rels/document.xml.rels';
  let rels = await read(relsName);
  const images = [];
  let k = 0;
  for (const b of blocks.filter((x) => x.t === 'image')) {
    k++;
    const rId = `rIdVda${k}`, file = `media/vda-figure-${k}.png`;
    zip.file(`word/${file}`, await b.blob.arrayBuffer());
    rels = rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${file}"/></Relationships>`);
    const bmp = await createImageBitmap(b.blob);
    const cx = 5600000, cy = Math.round((bmp.height / bmp.width) * cx);
    images.push({ rId, cx, cy });
  }
  zip.file(relsName, rels);
  let types = await read('[Content_Types].xml');
  if (!/Extension="png"/i.test(types)) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  zip.file('[Content_Types].xml', types);

  // Body: keep only the final section settings (page size, margins, header and footer), drop the
  // template's front page, contents page and sample text, then add the assessment.
  const S = styleResolver(await read('word/styles.xml'));
  const doc = parser.parseFromString(await read('word/document.xml'), 'application/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const kids = [...body.childNodes];
  const sect = kids.filter((n) => n.nodeType === 1 && n.localName === 'sectPr').pop();
  for (const n of kids) if (n !== sect) body.removeChild(n);
  if (sect) {
    // The final section restarts page numbers at 1, which is what we want; a 'title page' setting
    // would hide the header and footer on page 1, so drop it.
    for (const tp of [...sect.getElementsByTagNameNS(W, 'titlePg')]) sect.removeChild(tp);
  } else notes.push('The template has no section settings, so Word defaults are used for the page.');
  const frag = parser.parseFromString(`<w:body ${NS}>${blocksToBodyXml(blocks, S, images)}</w:body>`, 'application/xml');
  if (frag.getElementsByTagName('parsererror')[0]) throw new Error('Could not build the report content for the template.');
  for (const n of [...frag.documentElement.childNodes]) body.insertBefore(doc.importNode(n, true), sect || null);

  zip.file('word/document.xml', ser.serializeToString(doc));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  return { blob, notes };
}
