import { Platform } from 'react-native';
import { ImageFormat, Skia, matchFont, type SkCanvas, type SkFont } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { PHOTO_COMPRESSED_MAX, PHOTO_COMPRESSED_QUALITY } from '@toce/shared';

/** Carpeta de un registro de campo en el teléfono (fotos y audios hasta que se suben). */
export function fieldDir(executionClientId: string): Directory {
  const dir = new Directory(Paths.document, 'campo', executionClientId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export type ProcessedPhoto = {
  originalPath: string;
  compressedPath: string;
  width: number;
  height: number;
  sizeBytes: number;
  originalSizeBytes: number;
};

/**
 * Guarda la foto tomada:
 * - el original tal cual sale de la cámara (alta resolución, con sus datos EXIF);
 * - una copia comprimida (lado mayor 1600 px) con el sello visible en la parte inferior.
 * `upright` son las medidas que informa la cámara ya orientadas: si la imagen decodificada
 * viene girada, se rota al dibujar.
 */
export async function processPhoto(
  captureUri: string,
  upright: { width: number; height: number },
  stamp: string[],
  executionClientId: string,
  clientId: string,
): Promise<ProcessedPhoto> {
  const dir = fieldDir(executionClientId);
  const original = new File(dir, `${clientId}-original.jpg`);
  await new File(captureUri).move(original);

  const data = await Skia.Data.fromURI(original.uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error('No se pudo leer la foto');
  const iw = img.width();
  const ih = img.height();
  const rotate = (upright.width > upright.height) !== (iw > ih) && upright.width !== upright.height;
  const uw = rotate ? ih : iw;
  const uh = rotate ? iw : ih;

  const scale = Math.min(1, PHOTO_COMPRESSED_MAX / Math.max(uw, uh));
  const W = Math.round(uw * scale);
  const H = Math.round(uh * scale);
  const surface = Skia.Surface.MakeOffscreen(W, H);
  if (!surface) throw new Error('No se pudo preparar la foto');
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);

  canvas.save();
  if (rotate) {
    // Gira 90° a la derecha: la imagen decodificada estaba acostada.
    canvas.translate(W, 0);
    canvas.rotate(90, 0, 0);
    canvas.drawImageRect(img, Skia.XYWHRect(0, 0, iw, ih), Skia.XYWHRect(0, 0, H, W), paint);
  } else {
    canvas.drawImageRect(img, Skia.XYWHRect(0, 0, iw, ih), Skia.XYWHRect(0, 0, W, H), paint);
  }
  canvas.restore();

  drawStamp(canvas, W, H, stamp);

  surface.flush();
  const snapshot = surface.makeImageSnapshot().makeNonTextureImage();
  if (!snapshot) throw new Error('No se pudo generar la foto');
  const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, PHOTO_COMPRESSED_QUALITY);
  const compressed = new File(dir, `${clientId}.jpg`);
  await compressed.write(bytes);

  return {
    originalPath: original.uri,
    compressedPath: compressed.uri,
    width: W,
    height: H,
    sizeBytes: bytes.length,
    originalSizeBytes: original.size ?? 0,
  };
}

const FONT_FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });

/** Banda semitransparente con el texto del sello (UTM, fecha, lugar, estación y unidad). */
function drawStamp(canvas: SkCanvas, W: number, H: number, lines: string[]) {
  const size = Math.max(14, Math.round(Math.min(W, H) * 0.032));
  const bold = matchFont({ fontFamily: FONT_FAMILY, fontSize: size * 1.12, fontWeight: 'bold' });
  const font = matchFont({ fontFamily: FONT_FAMILY, fontSize: size, fontWeight: 'normal' });
  const pad = Math.round(size * 0.7);
  const lh = Math.round(size * 1.38);
  const boxH = pad * 2 + lh * lines.length;

  const bg = Skia.Paint();
  bg.setColor(Skia.Color('rgba(0,0,0,0.55)'));
  canvas.drawRect(Skia.XYWHRect(0, H - boxH, W, boxH), bg);

  const fg = Skia.Paint();
  fg.setColor(Skia.Color('white'));
  fg.setAntiAlias(true);
  lines.forEach((line, i) => {
    const f = i === 0 ? bold : font;
    canvas.drawText(fit(line, f, W - pad * 2), pad, H - boxH + pad + lh * (i + 1) - Math.round(lh * 0.28), fg, f);
  });
}

/** Recorta con "…" si la línea no entra en el ancho de la foto. */
function fit(text: string, font: SkFont, max: number): string {
  if (font.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 4 && font.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
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
