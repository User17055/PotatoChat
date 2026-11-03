import crypto from "node:crypto";

export function rtcConfig(name, env = process.env, now = Date.now()) {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  const urls = String(env.TURN_URLS || "").split(/[\s,]+/).filter((url) => /^turns?:[^\s]+$/.test(url));
  let username = env.TURN_USERNAME || "", credential = env.TURN_PASSWORD || "", expiresAt = 0;
  if (urls.length && env.TURN_SECRET) {
    const ttl = Number(env.TURN_TTL) || 3600;
    expiresAt = (Math.floor(now / 1000) + Math.max(600, Math.min(86400, ttl))) * 1000;
    username = `${expiresAt / 1000}:${crypto.createHash("sha256").update(name).digest("hex").slice(0, 24)}`;
    credential = crypto.createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");
  }
  const turnConfigured = Boolean(urls.length && username && credential);
  if (turnConfigured) iceServers.push({ urls, username, credential });
  return { iceServers, turnConfigured, expiresAt, iceTransportPolicy: turnConfigured && env.TURN_ONLY === "true" ? "relay" : "all" };
}
