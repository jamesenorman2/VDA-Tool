// Copy outputs into a report. Tables go on the clipboard as HTML (pastes into Word as a real
// table) plus tab-separated text (pastes into Excel or plain editors). Charts and sketches go as
// PNG images on a white background. Copied content is always styled for print, whatever the
// page theme.
import { VERSION } from './version.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CELL = 'border:1px solid #999;padding:3pt 6pt;';

export const sourceLine = () => `Source: VDA Tool v${VERSION}, ${new Date().toISOString().slice(0, 10)}.`;

/**
 * @param {{ title?:string, headers:string[], rows:(string|number)[][], notes?:string[], numericFrom?:number }} t
 * @returns {{ html:string, text:string }}
 */
export function reportTable({ title, headers, rows, notes = [], numericFrom = 1 }) {
  const align = (i) => (i >= numericFrom ? 'right' : 'left');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000">`
    + (title ? `<p style="margin:0 0 4pt;font-weight:bold">${esc(title)}</p>` : '')
    + `<table style="border-collapse:collapse;font-size:10pt"><thead><tr>${headers.map((h, i) => `<th style="${CELL}background:#e8e8e8;text-align:${align(i)}">${esc(h)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="${CELL}text-align:${align(i)}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    + [...notes, sourceLine()].map((n) => `<p style="margin:4pt 0 0;font-size:8pt;color:#444">${esc(n)}</p>`).join('')
    + '</div>';
  const text = [title, [headers, ...rows].map((r) => r.join('\t')).join('\n'), ...notes, sourceLine()].filter(Boolean).join('\n');
  return { html, text };
}

export async function copyRich({ html, text }) {
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      return true;
    }
  } catch { /* fall through */ }
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  // Last resort: select rendered HTML and use the legacy copy command.
  const div = document.createElement('div');
  div.innerHTML = html; div.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff';
  document.body.appendChild(div);
  const range = document.createRange(); range.selectNodeContents(div);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const ok = document.execCommand('copy');
  sel.removeAllRanges(); div.remove();
  return ok;
}

// Render an SVG element to a PNG blob on white. `prepare(clone)` may set print colours.
export function svgToPng(svg, { width = 1600, prepare } = {}) {
  const clone = svg.cloneNode(true);
  const vb = (svg.getAttribute('viewBox') || `0 0 ${svg.clientWidth} ${svg.clientHeight}`).split(/[\s,]+/).map(Number);
  const height = Math.round((width * vb[3]) / vb[2]);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width); clone.setAttribute('height', height);
  clone.querySelectorAll('[fill="currentColor"]').forEach((n) => n.setAttribute('fill', '#000'));
  clone.querySelectorAll('[stroke="currentColor"]').forEach((n) => n.setAttribute('stroke', '#000'));
  if (prepare) prepare(clone);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, width, height); g.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not draw the image')); };
    img.src = url;
  });
}

export async function copyImage(blob) {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; } catch { return false; }
}

// Show a short confirmation next to a copy button.
export function flash(button, ok, okText = 'Copied', failText = 'Copy failed') {
  const old = button.dataset.label || button.textContent;
  button.dataset.label = old;
  button.textContent = ok ? okText : failText;
  setTimeout(() => { button.textContent = old; }, 1600);
}
