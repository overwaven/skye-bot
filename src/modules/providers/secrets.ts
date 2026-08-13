import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "v1";

function encryptionKey(fallbackSecret: string): Buffer {
  const secret = process.env.SKYE_PROVIDER_SECRET || fallbackSecret;
  return createHash("sha256").update(`skye-provider:${secret}`).digest();
}

export function encryptProviderSecret(value: string, fallbackSecret: string): string {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(fallbackSecret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptProviderSecret(value: string, fallbackSecret: string): string {
  if (!value) return "";
  const [version, iv, tag, payload] = value.split(":");
  if (version !== PREFIX || !iv || !tag || !payload) {
    throw new Error("Unsupported provider credential format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(fallbackSecret),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
