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

  global.JGStoreOpsLabelReshape = { labelWidth, labelHeight, pageFitsLabel, placement, reshape };
})(typeof window !== 'undefined' ? window : globalThis);
