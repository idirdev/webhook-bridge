import crypto from 'crypto';

/**
 * Webhook signature validator.
 * Supports HMAC-SHA256 signature verification for securing webhook endpoints.
 */

/**
 * Supported hash algorithms for signature generation/verification.
 */
export type HashAlgorithm = 'sha256' | 'sha1' | 'sha512';

/**
 * Verify an HMAC signature against a payload.
 *
 * @param payload - The raw request body (string or Buffer)
 * @param signature - The signature from the request header
 * @param secret - The shared secret key
 * @param algorithm - Hash algorithm to use (default: sha256)
 * @returns true if the signature is valid
 */
export function verifySignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
  algorithm: HashAlgorithm = 'sha256'
): boolean {
  if (!payload || !signature || !secret) {
    return false;
  }

  const expectedSignature = generateSignature(payload, secret, algorithm);

  // Strip algorithm prefix if present (e.g., "sha256=abc123")
  const cleanSignature = stripAlgorithmPrefix(signature);
  const cleanExpected = stripAlgorithmPrefix(expectedSignature);

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(cleanSignature, 'hex');
    const expectedBuffer = Buffer.from(cleanExpected, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generate an HMAC signature for a payload.
 *
 * @param payload - The data to sign
 * @param secret - The secret key
 * @param algorithm - Hash algorithm (default: sha256)
 * @returns The hex-encoded signature with algorithm prefix
 */
export function generateSignature(
  payload: string | Buffer,
  secret: string,
  algorithm: HashAlgorithm = 'sha256'
): string {
  const hmac = crypto.createHmac(algorithm, secret);
  hmac.update(typeof payload === 'string' ? payload : payload);
  const hash = hmac.digest('hex');
  return `${algorithm}=${hash}`;
}

/**
 * Strip the algorithm prefix from a signature string.
 * "sha256=abc123" -> "abc123"
 * "abc123" -> "abc123"
 */
function stripAlgorithmPrefix(signature: string): string {
  const prefixes = ['sha256=', 'sha1=', 'sha512='];
  for (const prefix of prefixes) {
    if (signature.startsWith(prefix)) {
      return signature.slice(prefix.length);
    }
  }
  return signature;
}

/**
 * Validate that a signature header value has the expected format.
 */
export function isValidSignatureFormat(signature: string): boolean {
  // Must be hex characters, optionally prefixed with algorithm
  const pattern = /^(sha256=|sha1=|sha512=)?[0-9a-f]+$/i;
  return pattern.test(signature);
}

/**
 * Parse a webhook provider's signature header into its components.
 * Handles formats like:
 *   - "sha256=hexdigest"
 *   - "t=1234567890,v1=hexdigest"  (Stripe-style)
 *   - Plain hex digest
 */
export function parseSignatureHeader(
  header: string
): { algorithm?: string; signature: string; timestamp?: string } {
  // Stripe-style: "t=timestamp,v1=signature"
  if (header.includes(',')) {
    const parts: Record<string, string> = {};
    for (const segment of header.split(',')) {
      const [key, value] = segment.split('=', 2);
      if (key && value) {
        parts[key.trim()] = value.trim();
      }
    }
    return {
      algorithm: 'sha256',
      signature: parts['v1'] || parts['v0'] || '',
      timestamp: parts['t'],
    };
  }

  // Standard: "algorithm=hexdigest"
  const match = header.match(/^(sha256|sha1|sha512)=(.+)$/i);
  if (match) {
    return {
      algorithm: match[1].toLowerCase(),
      signature: match[2],
    };
  }

  // Plain hex digest
  return { signature: header };
}
