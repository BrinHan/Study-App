// Writes text-based sample PDFs from samples/cell-biology.md, with no dependencies.
//   node scripts/make-sample-pdf.mjs            -> samples/cell-biology.pdf (about 3 pages)
//   node scripts/make-sample-pdf.mjs --pages 50 -> samples/cell-biology-50p.pdf (content repeated, for timing)
// Each page gets a running header and a "Page N" footer, so header/footer removal is exercised too.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const want = process.argv.includes('--pages') ? Number(process.argv[process.argv.indexOf('--pages') + 1]) : 0
const md = readFileSync(join(root, 'samples/cell-biology.md'), 'utf8')

// Layout: US Letter, 11pt Helvetica body, 14pt bold headings.
const W = 612, H = 792, M = 72, LINE = 15, WRAP = 88
const blocks = md.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean)

function wrap(text) {
  const out = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > WRAP) { out.push(line); line = w } else line = (line + ' ' + w).trim()
  }
  if (line) out.push(line)
  return out
}

const pages = []
let ops = []
let y = H - M
const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = H - M - 20 }
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '')
const text = (font, size, x, yy, s) => ops.push(`BT /${font} ${size} Tf ${x} ${yy} Td (${esc(s)}) Tj ET`)

newPage()
let unit = 0
do {
  unit++
  for (const b of blocks) {
    const heading = b.startsWith('#')
    const lines = heading ? [(want ? `${unit}. ` : '') + b.replace(/^#+\s*/, '').trim()] : wrap(b)
    const need = (lines.length + 1) * LINE + (heading ? 10 : 0)
    if (y - need < M + 30) newPage()
    if (heading) { y -= 10; text('F2', 14, M, y, lines[0]); y -= LINE + 6; continue }
    for (const l of lines) { text('F1', 11, M, y, l); y -= LINE }
    y -= LINE * 0.8
  }
} while (want && pages.length + 1 < want)
newPage()
if (want) pages.length = Math.min(pages.length, want)

// Running header + footer on every page.
pages.forEach((p, i) => {
  p.unshift(`BT /F1 9 Tf ${M} ${H - 40} Td (Cell Biology - study notes) Tj ET`)
  p.push(`BT /F1 9 Tf ${W / 2 - 15} 40 Td (Page ${i + 1}) Tj ET`)
})

// Assemble PDF objects: 1 catalog, 2 pages, 3-4 fonts, then page + content per page.
const objs = []
const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
pages.forEach((p, i) => {
  const stream = p.join('\n')
  objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`
  objs[6 + i * 2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
})

let pdf = '%PDF-1.4\n'
const offsets = []
for (let n = 1; n < objs.length; n++) {
  offsets[n] = Buffer.byteLength(pdf)
  pdf += `${n} 0 obj\n${objs[n]}\nendobj\n`
}
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
for (let n = 1; n < objs.length; n++) pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

const out = join(root, want ? `samples/cell-biology-${want}p.pdf` : 'samples/cell-biology.pdf')
writeFileSync(out, pdf, 'latin1')
console.log(`Wrote ${out} (${pages.length} pages, ${(Buffer.byteLength(pdf) / 1024).toFixed(0)} KB)`)
