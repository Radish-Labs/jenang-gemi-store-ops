const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PDFLib = require('../assets/vendor/pdf-lib.min.js');
require('../label-reshape.js');
const { labelWidth, labelHeight, pageFitsLabel, placement, reshape } = globalThis.JGStoreOpsLabelReshape;
const labelScript = fs.readFileSync(path.join(root, 'print-label.js'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'dashboard/print-label/index.php'), 'utf8');

const mm = (value) => value * 72 / 25.4;
const pdfWithPages = async (sizes, rotation = 0) => {
  const doc = await PDFLib.PDFDocument.create();
  sizes.forEach(([width, height]) => {
    const page = doc.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height });
    if (rotation) page.setRotation(PDFLib.degrees(rotation));
  });
  return doc.save();
};

(async () => {
  assert.equal(pageFitsLabel(mm(100), mm(150)), true, 'a 100 x 150 mm label prints as it is');
  assert.equal(pageFitsLabel(mm(105), mm(148)), true, 'an A6 label prints as it is');
  assert.equal(pageFitsLabel(mm(148), mm(210)), false, 'an A5 page is too large for the label');

  const a5 = placement(mm(148), mm(210));
  assert.ok(a5.x >= mm(3) - 0.01 && a5.x + a5.width <= labelWidth - mm(3) + 0.01, 'the redrawn page stays inside the side margins');
  assert.ok(a5.y >= mm(3) - 0.01 && Math.abs(a5.y + a5.height - (labelHeight - mm(3))) < 0.01, 'the redrawn page starts at the top margin');
  assert.ok(Math.abs(a5.width / a5.height - 148 / 210) < 0.001, 'the label keeps its proportions');

  assert.equal(await reshape(await pdfWithPages([[mm(100), mm(150)]]), PDFLib), null, 'a label-sized PDF is left untouched');
  assert.equal(await reshape(await pdfWithPages([[mm(148), mm(210)]], 90), PDFLib), null, 'a rotated page is left for the printer to scale');
  assert.equal(await reshape(await pdfWithPages([[mm(148), mm(210)]]), null), null, 'the label prints as uploaded when the PDF library did not load');

  const reshaped = await PDFLib.PDFDocument.load(await reshape(await pdfWithPages([[mm(148), mm(210)], [mm(210), mm(297)]]), PDFLib));
  assert.equal(reshaped.getPageCount(), 2, 'every page of the upload is kept');
  reshaped.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    assert.ok(Math.abs(width - labelWidth) < 0.01 && Math.abs(height - labelHeight) < 0.01, 'each page becomes label-sized');
  });

  assert.match(labelScript, /const blob = await preparedLabelBlob\(await fetchLabelBlob\(\)\);/, 'the preview and the printer both receive the prepared PDF');
  assert.match(labelScript, /const preparedLabelBlob = async \(raw, layout = chosenLayout\) => \{[\s\S]*?applyLayout[\s\S]*?await labelSizedBlob\(raw\);[\s\S]*?keepPage/, 'without a phone layout the label-sized PDF is used');

  // Layout chosen on the phone: turn clockwise and size, always label-sized.
  const { cleanLayout, isDefaultLayout, applyLayout } = global.JGStoreOpsLabelReshape;
  assert.deepEqual(cleanLayout({ rotate: -90, size: 400 }), { rotate: 270, size: 150, page: 0 }, 'turns wrap and sizes are capped');
  assert.deepEqual(cleanLayout(null), { rotate: 0, size: 100, page: 0 }, 'no layout means unchanged');
  assert.equal(cleanLayout({ page: 2.4 }).page, 2, 'a chosen page is a whole number');
  assert.equal(cleanLayout({ page: -3 }).page, 0, 'a bad page prints every page');
  assert.equal(isDefaultLayout({ page: 2 }), true, 'picking a page alone does not redraw the label');
  const { keepPage } = global.JGStoreOpsLabelReshape;
  const threePages = await pdfWithPages([[mm(100), mm(150)], [mm(210), mm(297)], [mm(100), mm(150)]]);
  const second = await PDFLib.PDFDocument.load(await keepPage(threePages, 2, PDFLib));
  assert.equal(second.getPageCount(), 1, 'only the chosen page is kept');
  assert.ok(Math.abs(second.getPages()[0].getSize().width - mm(210)) < 0.01, 'the chosen page is the second one');
  assert.equal(await keepPage(threePages, 4, PDFLib), null, 'a page the label lacks prints the whole label');
  assert.equal(await keepPage(await pdfWithPages([[mm(100), mm(150)]]), 1, PDFLib), null, 'a one-page label is unchanged');
  assert.equal(isDefaultLayout({ rotate: 360, size: 100 }), true, 'a full turn is unchanged');
  for (const rotate of [0, 90, 180, 270]) {
    const laidOut = await PDFLib.PDFDocument.load(await applyLayout(await pdfWithPages([[mm(210), mm(297)]], 90), { rotate, size: 80 }, PDFLib));
    const [page] = laidOut.getPages();
    const { width, height } = page.getSize();
    assert.ok(Math.abs(width - labelWidth) < 0.01 && Math.abs(height - labelHeight) < 0.01, `a ${rotate} degree layout is label-sized`);
    assert.equal(page.getRotation().angle, 0, 'the turn is drawn in, not left to the printer');
  }
  assert.match(labelScript, /const labelSizedBlob = async \(blob\) => \{[\s\S]*?if \(!hasUploadedLabel \|\| !labelReshape\) return blob;[\s\S]*?catch \(_error\) \{[\s\S]*?return blob;/, 'marketplace labels and unreadable uploads print unchanged');
  const uploadedLabel = new Function('order', 'orderId', `${labelScript.match(/const uploadedLabelPlatforms = [\s\S]*?orderId\);/)[0]} return hasUploadedLabel;`);
  assert.equal(uploadedLabel({ platform: 'whatsapp' }, 'WAEXEC-1'), true, 'a WhatsApp order prints a courier label');
  assert.equal(uploadedLabel({ platform: '' }, 'waexec-1'), true, 'a direct order is recognised from its order number');
  assert.equal(uploadedLabel({ platform: 'partner' }, 'PARTNER-9'), true, 'a partner order prints an uploaded label');
  assert.equal(uploadedLabel({ platform: 'shopee' }, '260805JD3GTNHG'), false, 'a marketplace label is never redrawn');
  assert.match(markup, /pdf-lib\.min\.js[\s\S]*label-reshape\.js[\s\S]*print-label\.js/, 'the label page loads the PDF library and the reshaper before the print script');

  console.log('label-reshape-test: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
