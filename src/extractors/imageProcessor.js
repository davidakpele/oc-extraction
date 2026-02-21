'use strict';

const sharp = require('sharp');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Preprocess an image for better OCR accuracy:
 * - Convert to grayscale
 * - Normalize (enhance contrast)
 * - Sharpen
 * - Remove noise (median filter via sharp)
 * - Output as high-quality PNG
 */
async function preprocessImage(inputPath) {
  const outputPath = inputPath.replace(/(\.[^.]+)$/, '_processed.png');

  try {
    await sharp(inputPath)
      .grayscale()
      .normalize()      // stretch histogram to full range
      .median(1)        // light denoise
      .sharpen({
        sigma: 1.0,
        m1: 0.5,
        m2: 0.5,
      })
      .png({ compressionLevel: 0 }) // no compression for OCR quality
      .toFile(outputPath);

    logger.debug({ msg: 'Image preprocessed', input: inputPath, output: outputPath });
    return outputPath;
  } catch (err) {
    logger.warn({ msg: 'Image preprocessing failed, using original', error: err.message });
    return inputPath;
  }
}

/**
 * Auto-rotate image based on EXIF orientation
 */
async function autoRotate(inputPath) {
  const outputPath = inputPath.replace(/(\.[^.]+)$/, '_rotated.png');
  await sharp(inputPath).rotate().png().toFile(outputPath);
  return outputPath;
}

/**
 * Get image dimensions
 */
async function getImageMeta(imagePath) {
  const meta = await sharp(imagePath).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

module.exports = { preprocessImage, autoRotate, getImageMeta };
