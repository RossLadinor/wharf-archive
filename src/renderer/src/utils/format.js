// Human-readable transfer speed.  Returns '' if no/zero rate.
export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1) return ''
  if (bytesPerSec < 1024)            return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024)     return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  if (bytesPerSec < 1024 ** 3)       return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  return `${(bytesPerSec / (1024 ** 3)).toFixed(2)} GB/s`
}
