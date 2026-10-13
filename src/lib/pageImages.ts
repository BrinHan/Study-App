// Renders scanned PDF pages and photos to compressed JPEG page images for AI transcription.
export const OCR = { minCharsPerPage: 30, maxPages: 20, maxSide: 1600, quality: 0.8, fallbackSide: 1200, fallbackQuality: 0.6, maxBytes: 1_400_000, maxPhotoBytes: 15 * 1024 * 1024 } as const

export interface PageImage { page: number; blob: Blob; mimeType: 'image/jpeg' }

export class ScanError extends Error {
  code: 'heic' | 'unreadable' | 'too-many' | 'too-big'
  constructor(code: ScanError['code'], message = code) {
    super(message)
    this.name = 'ScanError'
    this.code = code
  }
}

/** 1-based numbers of pages with too little text to trust. */
export function pagesNeedingOcr(pages: string[][]): number[] {
  const out: number[] = []
  pages.forEach((lines, i) => {
    if (lines.join('').replace(/\s/g, '').length < OCR.minCharsPerPage) out.push(i + 1)
  })
  return out
}

export function fitWithin(w: number, h: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void | Promise<void>

async function encode(draw: Draw, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ScanError('unreadable')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  await draw(ctx, w, h)
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new ScanError('unreadable'))), 'image/jpeg', quality)
    })
  } finally {
    canvas.width = canvas.height = 0 // Safari keeps detached canvas backing stores alive
  }
}

/** `draw` paints into the given ctx at the given size (the caller scales its drawing to w/h). */
export async function canvasToJpeg(draw: Draw, srcW: number, srcH: number): Promise<Blob> {
  const a = fitWithin(srcW, srcH, OCR.maxSide)
  const blob = await encode(draw, a.w, a.h, OCR.quality)
  if (blob.size <= OCR.maxBytes) return blob
  const b = fitWithin(srcW, srcH, OCR.fallbackSide)
  return encode(draw, b.w, b.h, OCR.fallbackQuality)
}

export async function photoToPage(file: File, page: number): Promise<PageImage> {
  if (file.size > OCR.maxPhotoBytes) throw new ScanError('too-big')
  const heic = /\.(heic|heif)$/i.test(file.name) || file.type.startsWith('image/hei')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ScanError(heic ? 'heic' : 'unreadable')
  }
  try {
    const blob = await canvasToJpeg((ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h), bitmap.width, bitmap.height)
    return { page, blob, mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}
