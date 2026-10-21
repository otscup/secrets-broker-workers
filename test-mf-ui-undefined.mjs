// Focused scan: strip CSS and string literals first, then look for identifier
// calls that are not declared, imported, or a known browser global.
import fs from 'node:fs'
let code = fs.readFileSync('src/ui.js', 'utf8')
// Remove template literals, then quoted strings, then CSS-heavy blocks.
code = code.replace(/`(?:[^`\\]|\\.)*`/g, '""')
code = code.replace(/'(?:[^'\\]|\\.)*'/g, '""')
code = code.replace(/"(?:[^"\\]|\\.)*"/g, '""')

const declared = new Set()
for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1])
for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*,/g)) declared.add(m[1])
for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) declared.add(p.split(':').pop().trim().replace(/=.*$/, '').trim())
for (const m of code.matchAll(/import\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) declared.add(p.trim())
for (const m of code.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g)) for (const p of m[1].split(',')) { const n = p.split('=')[0].trim(); if (n) declared.add(n) }
for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1])

const globals = new Set(('String Number Boolean Object Array Math JSON Date Promise Set Map WeakMap WeakSet Error RegExp Symbol BigInt ' +
'parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent setTimeout setInterval clearInterval clearTimeout ' +
'queueMicrotask requestAnimationFrame cancelAnimationFrame structuredClone Intl URL URLSearchParams FormData Blob File FileReader ' +
'Image Audio AbortController TextEncoder TextDecoder crypto performance document window navigator localStorage sessionStorage ' +
'console MutationObserver IntersectionObserver ResizeObserver HTMLElement Node Event CustomEvent getComputedStyle matchMedia atob btoa ' +
'Uint8Array Uint32Array ArrayBuffer DataView fetch alert confirm prompt').split(/\s+/))
const keywords = new Set(('if for while switch catch return typeof new function await of in do else try finally throw delete void yield ' +
'case break continue instanceof class extends super this').split(/\s+/))

const bad = new Map()
for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
  const n = m[1]
  if (declared.has(n) || globals.has(n) || keywords.has(n)) continue
  bad.set(n, (bad.get(n) || 0) + 1)
}
if (bad.size === 0) console.log('PASS no undefined function calls in ui.js')
else { for (const [n, c] of bad) console.log('UNDEFINED: ' + n + ' x' + c); process.exit(1) }
