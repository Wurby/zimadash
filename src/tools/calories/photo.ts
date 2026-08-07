/**
 * Shrink a photo before it leaves the phone.
 *
 * A modern phone camera produces 3–8MB, which is slow to send on mobile data
 * and costs a great deal of tokens to look at — for no benefit, because
 * judging a plate of food doesn't need twelve megapixels. A long edge of 1024
 * at JPEG 0.8 lands around 200KB and reads just as well.
 *
 * EXIF orientation is handled by `createImageBitmap`, which applies it for us;
 * drawing the raw file to a canvas by hand would land sideways photos sideways.
 */

const MAX_EDGE = 1024
const QUALITY = 0.8

export async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('could not read that photo')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}
