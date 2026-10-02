import type { RequestHandler } from "express";

interface Window {
  count: number;
  resetAt: number;
}

export function perClientRateLimit(max: number, windowMs: number): RequestHandler {
  const windows = new Map<string, Window>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now > w.resetAt) windows.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.clientId ?? req.ip ?? "anonymous";
    const now = Date.now();
    let window = windows.get(key);

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }

    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - window.count - 1));
    res.setHeader("RateLimit-Reset", Math.ceil((window.resetAt - now) / 1000));

    if (window.count >= max) {
      res.setHeader("Retry-After", Math.ceil((window.resetAt - now) / 1000));
      res.status(429).json({ error: "rate_limited", requestId: req.requestId });
      return;
    }

    window.count++;
    next();
  };
}
