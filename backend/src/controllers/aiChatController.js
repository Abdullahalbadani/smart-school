// import Groq from "groq-sdk";

// const client = new Groq({
//   apiKey: process.env.GROQ_API_KEY,
// });

// export const aiChatController = {
//   async chat(req, res) {
//     try {
//       const { message, role } = req.body;

//       if (!message) {
//         return res.json({ answer: "الرسالة مطلوبة." });
//       }

//       const systemPrompt = `
//         أنت مساعد ذكي داخل نظام Smart School.
//         أجب باللغة العربية الفصحى بطريقة بسيطة وواضحة.
//         ساعد الطلاب والمعلمين على فهم أي موضوع.
//         دور المستخدم: ${role || "student"}
//       `;

//       const response = await client.chat.completions.create({
// model: "llama-3.1-8b-instant",
//         messages: [
//           { role: "system", content: systemPrompt },
//           { role: "user", content: message },
//         ],
//       });

//       const answer = response.choices[0].message.content;
//       return res.json({ answer });

//     } catch (err) {
//       console.error("AI Chat Error:", err);
//       return res.status(500).json({
//         answer: "حدث خطأ أثناء الاتصال بالمساعد.",
//       });
//     }
//   },
// };
