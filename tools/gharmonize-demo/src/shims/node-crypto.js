const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
export function randomBytes(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return { toString: (enc) => (enc === 'hex' ? hex(bytes) : btoa(String.fromCharCode(...bytes))), length: n, bytes }
}
export function randomUUID() { return crypto.randomUUID() }
export function randomInt(a, b) {
  const [min, max] = b === undefined ? [0, a] : [a, b]
  return min + Math.floor(Math.random() * (max - min))
}
export default { randomBytes, randomUUID, randomInt }
