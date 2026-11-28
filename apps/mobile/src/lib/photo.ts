import { Platform } from 'react-native';
import { ImageFormat, PaintStyle, Skia, matchFont, type SkCanvas, type SkFont } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { boundedDimensions, compassLabel, fileStem, jpegWithPhotoMetadata, PHOTO_JPEG_QUALITY, wrapPhotoText } from '@toce/shared';

export function fieldDir(executionClientId: string): Directory {
  const dir = new Directory(Paths.document, 'campo', executionClientId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export type ProcessedPhoto = {
  originalPath: string; compressedPath: string; width: number; height: number;
  sizeBytes: number; originalSizeBytes: number;
};

/** Dos archivos <=12 MP: sin rótulo y rotulado JPEG100.
 * compressedPath conserva el nombre del contrato existente; ya NO implica 1600px/JPEG72.
 * Sin recorte ni ampliación. La cámara entrega la orientación procesada (skipProcessing:false).
 */
export async function processPhoto(
  captureUri: string, upright: { width: number; height: number }, stamp: string[],
  executionClientId: string, clientId: string,
  options: { name?: string; bearing?: number | null; metadata?: Record<string, unknown>; exifOrientation?: number | null } = {},
): Promise<ProcessedPhoto> {
  const dir = fieldDir(executionClientId);
  const stem = `${fileStem(options.name ?? 'Foto')}_${clientId}`;
  const original = new File(dir, `${stem}_SIN_ROTULO.jpg`);
  const labelled = new File(dir, `${stem}.jpg`);
  const metadata = { ...options.metadata, width: upright.width, height: upright.height, label: stamp, magneticCameraBearing: options.bearing ?? null };
  const data = await Skia.Data.fromURI(captureUri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error('No se pudo leer la foto');
  const iw = img.width(), ih = img.height();
  // Algunos Android reportan width/height girados o dejan el giro solo en el EXIF.
  // Si las proporciones vienen invertidas, se gira según el EXIF (6 = 90°, 8 = 270°);
  // sin EXIF de giro, la imagen decodificada ya es la correcta.
  const captureRatio = upright.width / upright.height;
  const swapped = Math.abs(iw / ih - captureRatio) > 0.02 && Math.abs(ih / iw - captureRatio) <= 0.02;
  const rotation = swapped && options.exifOrientation === 6 ? 90 : swapped && options.exifOrientation === 8 ? 270 : 0;
  const rw = rotation ? ih : iw, rh = rotation ? iw : ih;
  const { width: W, height: H } = boundedDimensions(rw, rh);
  const surface = Skia.Surface.MakeOffscreen(W, H);
  if (!surface) { img.dispose(); data.dispose(); throw new Error('No hay memoria suficiente para procesar la foto. Intenta de nuevo.'); }
  try {
    const canvas = surface.getCanvas(), paint = Skia.Paint();
    paint.setAntiAlias(true);
    if (rotation) {
      canvas.save();
      if (rotation === 90) { canvas.translate(W, 0); canvas.rotate(90, 0, 0); }
      else { canvas.translate(0, H); canvas.rotate(-90, 0, 0); }
      canvas.drawImageRectCubic(img, Skia.XYWHRect(0, 0, iw, ih), Skia.XYWHRect(0, 0, H, W), 1/3, 1/3, paint);
      canvas.restore();
    } else {
      canvas.drawImageRectCubic(img, Skia.XYWHRect(0, 0, iw, ih), Skia.XYWHRect(0, 0, W, H), 1/3, 1/3, paint);
    }
    if (!rotation && W === iw && H === ih) {
      // Conserva exactamente el JPEG de cámara y sus EXIF cuando ya cumple el límite.
      await new File(captureUri).copy(original);
    } else {
      surface.flush();
      const rawSnapshot = surface.makeImageSnapshot();
      const unlabelled = rawSnapshot.makeNonTextureImage();
      if (!unlabelled) { rawSnapshot.dispose(); throw new Error("No se pudo preparar la foto sin rótulo"); }
      try { await original.write(jpegWithPhotoMetadata(unlabelled.encodeToBytes(ImageFormat.JPEG, PHOTO_JPEG_QUALITY), { ...metadata, width: W, height: H })); }
      finally { unlabelled.dispose(); if (rawSnapshot !== unlabelled) rawSnapshot.dispose(); }
    }
    drawStamp(canvas, W, H, stamp, options.bearing);
    surface.flush();
    const labelledSnapshot = surface.makeImageSnapshot();
    const snapshot = labelledSnapshot.makeNonTextureImage();
    if (!snapshot) { labelledSnapshot.dispose(); throw new Error("No se pudo preparar la foto rotulada"); }
    try { await labelled.write(jpegWithPhotoMetadata(snapshot.encodeToBytes(ImageFormat.JPEG, PHOTO_JPEG_QUALITY), { ...metadata, width: W, height: H })); }
    finally { snapshot.dispose(); if (labelledSnapshot !== snapshot) labelledSnapshot.dispose(); }
    if (!labelled.size || !original.size) throw new Error('No se pudo escribir la foto completa');
    return { originalPath: original.uri, compressedPath: labelled.uri, width: W, height: H,
      sizeBytes: labelled.size, originalSizeBytes: original.size };
  } catch (error) {
    deleteLocalFiles(original.uri, labelled.uri);
    throw error;
  } finally {
    surface.dispose(); img.dispose(); data.dispose();
    deleteLocalFiles(captureUri);
  }
}

const FONT_FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });

/** Texto blanco delineado. Fondo completamente transparente, sin banda ni truncamiento. */
export function drawStamp(canvas: SkCanvas, W: number, H: number, lines: string[], bearing?: number | null) {
  const scale = Math.min(W, H * 4 / 3) / 1600;
  const size = Math.max(10, 24 * scale), pad = Math.max(8, 24 * scale);
  const heading = matchFont({ fontFamily: FONT_FAMILY, fontSize: size * 28/24, fontWeight: 'bold' });
  const font = matchFont({ fontFamily: FONT_FAMILY, fontSize: size, fontWeight: 'normal' });
  const compass = bearing != null && Number.isFinite(bearing);
  const reserve = compass ? 125 * scale : 0;
  const available = W - pad * 2 - reserve;
  const rows = lines.flatMap((line, i) => {
    const f = i === 0 ? heading : font;
    return wrapPhotoText(line, available, (v) => f.measureText(v).width).map((text) => ({ text, font: f }));
  });
  const lh = size * 1.4;
  const white = Skia.Paint(); white.setAntiAlias(true); white.setColor(Skia.Color('white'));
  const outline = Skia.Paint(); outline.setAntiAlias(true); outline.setColor(Skia.Color('black'));
  outline.setStyle(PaintStyle.Stroke); outline.setStrokeWidth(Math.max(1, 2 * scale));
  const text = (value: string, x: number, y: number, f: SkFont) => {
    canvas.drawText(value, x, y, outline, f); canvas.drawText(value, x, y, white, f);
  };
  rows.forEach((r, i) => text(r.text, pad, H - pad - (rows.length - 1 - i) * lh, r.font));
  if (compass) {
    const cx = W - pad - reserve / 2, cy = H - pad - 65 * scale, radius = 27 * scale;
    // Norte magnético orientado respecto del azimut de la cámara, no del desplazamiento GPS.
    const angle = -bearing! * Math.PI / 180;
    const x = cx + Math.sin(angle) * radius, y = cy - Math.cos(angle) * radius;
    outline.setStrokeWidth(4 * scale); white.setStrokeWidth(2 * scale);
    canvas.drawLine(cx, cy, x, y, outline); canvas.drawLine(cx, cy, x, y, white);
    for (const side of [-1, 1]) {
      const bx = x - Math.sin(angle) * 10 * scale + side * Math.cos(angle) * 6 * scale;
      const by = y + Math.cos(angle) * 10 * scale + side * Math.sin(angle) * 6 * scale;
      canvas.drawLine(x, y, bx, by, outline); canvas.drawLine(x, y, bx, by, white);
    }
    text('N', x - size/3, y - size/3, font);
    const label = compassLabel(bearing!);
    text(label, cx - font.measureText(label).width / 2, H - pad, font);
  }
}

/** Borra los archivos de una foto o audio (al reemplazarla antes de subirla). */
export function deleteLocalFiles(...uris: (string | null | undefined)[]) {
  for (const uri of uris) {
    if (!uri) continue;
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      /* ya no existe */
    }
  }
}
