// src/middleware/requireIntParam.js
export const requireIntParam = (name = "id") => {
  return (req, res, next) => {
    const v = req.params?.[name];

    // ✅ Debug (احذفها بعد ما تتأكد)
    // console.log("requireIntParam:", name, v, "url:", req.originalUrl);

    if (!v || !/^\d+$/.test(String(v))) {
      return res.status(400).json({ message: "المعرّف يجب أن يكون رقمًا" });
    }

    // اختياري: خليه رقم جاهز
    req.params[name] = String(parseInt(v, 10));
    next();
  };
};
