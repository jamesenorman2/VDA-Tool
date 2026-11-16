import test from 'node:test';
import assert from 'node:assert/strict';
import { styleResolver, setCustomProps, addUpdateFields, blocksToBodyXml, setCoreTitle } from '../src/wordtemplate.js';

test('style resolver falls back when a template lacks a style', () => {
  const S = styleResolver('<w:style w:styleId="Heading1"/><w:style w:styleId="BodyText"/>');
  assert.equal(S('AECOMtable', 'TableGrid'), null);
  assert.equal(S('Tabletext', 'BodyText'), 'BodyText');
});

test('custom properties are replaced or added, with XML escaping', () => {
  const xml = '<Properties><property fmtid="x" pid="2" name="DocumentTitle"><vt:lpwstr>title</vt:lpwstr></property></Properties>';
  const out = setCustomProps(xml, { DocumentTitle: 'HQ & Annex <A>', ProtectiveMarking: 'OFFICIAL-SENSITIVE' });
  assert.match(out, /name="DocumentTitle"><vt:lpwstr>HQ &amp; Annex &lt;A&gt;<\/vt:lpwstr>/);
  assert.match(out, /pid="3" name="ProtectiveMarking"><vt:lpwstr>OFFICIAL-SENSITIVE</);
});

test('updateFields goes before compat in settings; core title is set', () => {
  const s = addUpdateFields('<w:settings><w:zoom/><w:compat/><w:rsids/></w:settings>');
  assert.ok(s.indexOf('<w:updateFields w:val="true"/>') < s.indexOf('<w:compat'));
  assert.match(setCoreTitle('<cp:coreProperties x="1"><dc:title>old</dc:title></cp:coreProperties>', 'New'), /<dc:title>New<\/dc:title>/);
});

test('blocks become template-styled paragraphs and tables; appendix headings use the Appendix style', () => {
  const S = styleResolver(['Heading', 'Heading1', 'Heading2', 'BodyText', 'ListBullet', 'AECOMtable', 'Tabletext', 'Appendix', 'Appendixheading2', 'Source', 'Caption'].map((s) => `w:styleId="${s}"`).join(' '));
  const xml = blocksToBodyXml([
    { t: 'title', text: 'Test HQ', sub: 'Vehicle dynamics assessment' },
    { t: 'h2', text: '1. Summary' }, { t: 'p', text: 'A & B' }, { t: 'list', items: ['one', 'two'] },
    { t: 'table', headers: ['Section', 'Speed'], rows: [['A', 64]], numFrom: 1 },
    { t: 'break' }, { t: 'h2', text: 'Appendix A. Vector sections' }, { t: 'h3', text: 'G1' },
  ], S);
  assert.match(xml, /<w:pStyle w:val="Heading"\/><\/w:pPr><w:r><w:t xml:space="preserve">Test HQ</);
  assert.match(xml, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Summary</); // number comes from the style
  assert.match(xml, /A &amp; B/);
  assert.equal((xml.match(/w:val="ListBullet"/g) || []).length, 2);
  assert.match(xml, /<w:tblStyle w:val="AECOMtable"\/>/);
  assert.match(xml, /<w:pStyle w:val="Appendix"\/><\/w:pPr><w:r><w:t xml:space="preserve">Vector sections</);
  assert.match(xml, /<w:pStyle w:val="Appendixheading2"\/>/);
  // Tags balance.
  for (const tag of ['w:p', 'w:tbl', 'w:tr', 'w:tc', 'w:r']) assert.equal((xml.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length, (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length, tag);
});
