// Courier labels uploaded for direct, website and partner orders come in the
// courier's own page size. Marketplace labels are label-sized already, so an
// uploaded label is redrawn onto a label-sized page and prints like them.
(function (global) {
  const pointsPerMm = 72 / 25.4;
  const labelWidth = 100 * pointsPerMm;
  const labelHeight = 150 * pointsPerMm;
  const margin = 3 * pointsPerMm;
  // An A6 page (105 x 148 mm) already prints correctly on the label roll.
  const fitsLabelWidth = 105 * pointsPerMm + 2;
  const fitsLabelHeight = labelHeight + 2;

  const pageFitsLabel = (width, height) => width <= fitsLabelWidth && height <= fitsLabelHeight;

  const placement = (width, height) => {
    const scale = Math.min((labelWidth - margin * 2) / width, (labelHeight - margin * 2) / height);
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    return {
      x: (labelWidth - drawnWidth) / 2,
      y: labelHeight - margin - drawnHeight,
      width: drawnWidth,
      height: drawnHeight
    };
  };

  // Resolves to label-sized PDF bytes, or null when the label can print as it is.
  const reshape = async (bytes, pdfLib = global.PDFLib) => {
    if (!pdfLib) return null;
    const source = await pdfLib.PDFDocument.load(bytes);
    const pages = source.getPages();
    if (pages.length === 0) return null;
    if (pages.every((page) => {
      const { width, height } = page.getSize();
      return pageFitsLabel(width, height);
    })) return null;
    // A rotated page would be redrawn sideways, so it is left for the printer to scale.
    if (pages.some((page) => page.getRotation().angle % 360 !== 0)) return null;

    const output = await pdfLib.PDFDocument.create();
    const embedded = await output.embedPages(pages);
    embedded.forEach((page) => {
      output.addPage([labelWidth, labelHeight]).drawPage(page, placement(page.width, page.height));
    });
    return output.save();
  };

  // Layout chosen on the phone: turn the label clockwise and size it, on a
  // 100 x 150 mm page. size 100 fills the label edge to edge (keeping its
  // shape); smaller leaves a border. The phone previews exactly this PDF and
  // the computer prints the same, so what the phone shows is what prints.
  const cleanLayout = (layout) => {
    const rotate = ((Math.round(Number(layout?.rotate || 0) / 90) * 90) % 360 + 360) % 360;
    const size = Math.min(150, Math.max(50, Math.round(Number(layout?.size || 100))));
    // page: 0 prints every page, otherwise only that page (counting from 1).
    const page = Math.min(999, Math.max(0, Math.round(Number(layout?.page || 0)))) || 0;
    return { rotate, size, page };
  };
  const isDefaultLayout = (layout) => {
    const clean = cleanLayout(layout);
    return clean.rotate === 0 && clean.size === 100;
  };

  const applyLayout = async (bytes, layout, pdfLib = global.PDFLib) => {
    if (!pdfLib) throw new Error('Label tools are unavailable.');
    const { rotate, size } = cleanLayout(layout);
    const source = await pdfLib.PDFDocument.load(bytes);
    const pages = source.getPages();
    if (pages.length === 0) throw new Error('The label has no pages.');
    const output = await pdfLib.PDFDocument.create();
    const embedded = await output.embedPages(pages);
    embedded.forEach((page, index) => {
      // Shown turn = the page's own /Rotate plus the phone's; drawPage turns
      // counterclockwise, so use the opposite angle.
      const shown = (pages[index].getRotation().angle + rotate) % 360;
      const angle = (360 - ((shown % 360) + 360) % 360) % 360;
      const sideways = angle % 180 !== 0;
      const boxWidth = sideways ? page.height : page.width;
      const boxHeight = sideways ? page.width : page.height;
      const scale = Math.min(labelWidth / boxWidth, labelHeight / boxHeight) * (size / 100);
      const drawnWidth = boxWidth * scale;
      const drawnHeight = boxHeight * scale;
      const left = (labelWidth - drawnWidth) / 2;
      const bottom = (labelHeight - drawnHeight) / 2;
      // Where the page's own corner lands after turning about it.
      const origin = {
        0: [left, bottom],
        90: [left + drawnWidth, bottom],
        180: [left + drawnWidth, bottom + drawnHeight],
        270: [left, bottom + drawnHeight]
      }[angle];
      output.addPage([labelWidth, labelHeight]).drawPage(page, {
        x: origin[0],
        y: origin[1],
        xScale: scale,
        yScale: scale,
        rotate: pdfLib.degrees(angle)
      });
    });
    return output.save();
  };

  // Keep only one page (counting from 1). Resolves to null when the label
  // doesn't have that page, so it prints whole instead of printing nothing.
  const keepPage = async (bytes, pageNumber, pdfLib = global.PDFLib) => {
    if (!pdfLib) throw new Error('Label tools are unavailable.');
    const source = await pdfLib.PDFDocument.load(bytes);
    const count = source.getPageCount();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > count) return null;
    if (count === 1) return null;
    const output = await pdfLib.PDFDocument.create();
    const [copied] = await output.copyPages(source, [pageNumber - 1]);
    output.addPage(copied);
    return output.save();
  };

  global.JGStoreOpsLabelReshape = { labelWidth, labelHeight, pageFitsLabel, placement, reshape, cleanLayout, isDefaultLayout, applyLayout, keepPage };
})(typeof window !== 'undefined' ? window : globalThis);
