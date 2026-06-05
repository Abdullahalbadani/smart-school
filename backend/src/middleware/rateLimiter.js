// src/middleware/rateLimiter.js

const rateLimitStore = new Map();

// تنظيف دوري كل ساعة لحذف عناوين IP المنتهية لمنع تسرب الذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}, 60 * 60 * 1000).unref();

export function rateLimiter({ windowMs, max, message }) {
  return function (req, res, next) {
    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const now = Date.now();

    if (!rateLimitStore.has(ip)) {
      rateLimitStore.set(ip, {
        resetTime: now + windowMs,
        count: 1
      });
      return next();
    }

    const rateData = rateLimitStore.get(ip);

    if (now > rateData.resetTime) {
      rateData.resetTime = now + windowMs;
      rateData.count = 1;
      return next();
    }

    rateData.count += 1;

    if (rateData.count > max) {
      return res.status(429).json({
        success: false,
        message: message || "لقد تجاوزت الحد المسموح به من الطلبات. يرجى المحاولة لاحقاً."
      });
    }

    next();
  };
}
