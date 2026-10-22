// The web-fill controls moved from a standalone card (which made the operator
// retype a credential name) to the item dialog, plus a bulk classify action on
// the selection bar. The old standalone form must be gone, and every id it used
// must be gone with it, or the page throws on init.
import { uiHtml } from './src/ui.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

// F1: the standalone "网页填充规则" card is gone from the grants page.
{
  const grants = uiHtml.slice(uiHtml.indexOf('id="view-grants"'), uiHtml.indexOf('id="view-logs"'))
  const hasOldCard = grants.includes('网页填充规则')
  if (!hasOldCard) pass('F1 the standalone fill-rule card is gone from the grants page')
  else fail('F1', 'the old card is still in the grants view')
}

// F2: the fill controls now live on the items page.
{
  const items = uiHtml.slice(uiHtml.indexOf('id="view-items"'), uiHtml.indexOf('id="view-agents"'))
  const marks = ['id="fp-list"', 'id="fp-exec-note"']
  const missing = marks.filter((m) => !items.includes(m))
  if (missing.length === 0) pass('F2 the classified-credential table is on the items page')
  else fail('F2', 'missing on the items page: ' + missing.join(','))
}

// F3: bulk classify exists next to the existing bulk share/delete.
{
  const hasButton = uiHtml.includes('id="bulk-kind"')
  const wired = uiHtml.includes("$('bulk-kind').onclick = openBulkKind")
  const defined = uiHtml.includes('function openBulkKind')
  if (hasButton && wired && defined) pass('F3 the bulk bar can classify several credentials at once')
  else fail('F3', JSON.stringify({ hasButton, wired, defined }))
}

// F4: no id from the removed form survives anywhere.
{
  const dead = ['fp-item', 'fp-kind', 'fp-origins', 'fp-actions', 'fp-web-fields', 'fp-read', 'fp-read-row', 'fp-save', 'fp-delete', 'fp-status']
  const alive = dead.filter((id) => uiHtml.includes("$('" + id + "')") || uiHtml.includes('id="' + id + '"'))
  if (alive.length === 0) pass('F4 no id from the removed fill form survives')
  else fail('F4', 'still referenced: ' + alive.join(','))
}

// F5: the per-item editor is rendered inside the item dialog and wired.
{
  const inDialog = uiHtml.includes('fillEditorHtml(item)')
  const defined = uiHtml.includes('function fillEditorHtml')
  const wired = uiHtml.includes('wireFillEditor(item)')
  if (inDialog && defined && wired) pass('F5 the fill editor is rendered per item and wired')
  else fail('F5', JSON.stringify({ inDialog, defined, wired }))
}

// F6: the whole inline script still parses after the restructuring.
{
  const script = /<script>([\s\S]*?)<\/script>/.exec(uiHtml)
  let ok = false
  try { new Function(script[1]); ok = true } catch (error) { console.log('   ' + error.message) }
  if (ok) pass('F6 the inline script parses')
  else fail('F6', 'parse error')
}

// F7: the legacy re-grant panel is gone entirely; unbound grants are repaired
// inside the grants table instead of on their own screen.
{
  const cardGone = !uiHtml.includes('fp-legacy-card')
  const inTable = uiHtml.includes('legacyRows') && uiHtml.includes('data-legacy-regrant')
  const deletable = uiHtml.includes('data-legacy-delete')
  const noBulkRegrant = !uiHtml.includes('data-fp-regrant-all')
  const noPrompt = !uiHtml.includes("prompt('重新授权时长")
  if (cardGone && inTable && deletable && noBulkRegrant && noPrompt) pass('F7 unbound grants are marked in the grants table, not on their own screen')
  else fail('F7', JSON.stringify({ cardGone, inTable, deletable, noBulkRegrant, noPrompt }))
}

// F8: an expired grant is extended from the grants row, which is the flow the
// user asked for instead of a second screen.
{
  const hint = uiHtml.includes('点该行的时长即可延期')
  const pill = uiHtml.includes('data-item-grant')
  if (hint && pill) pass('F8 an expired grant is extended from its own row')
  else fail('F8', JSON.stringify({ hint, pill }))
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== fill ui placement ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
