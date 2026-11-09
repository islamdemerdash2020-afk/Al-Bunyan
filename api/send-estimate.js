// Vercel serverless function: يرسل PDF المقايسة بالإيميل عبر Resend.
// المتغيرات (Vercel > Settings > Environment Variables):
//   RESEND_API_KEY  (مطلوب)  مفتاح Resend
//   MAIL_FROM       (اختياري) عنوان المرسل، الافتراضي onboarding@resend.dev (تجريبي: يرسل لإيميل حسابك فقط)
//   COMPANY_EMAIL   (اختياري) تصله نسخة من كل مقايسة (لا يُسجَّل في النظام)
//   APP_KEY         (اختياري) رمز بسيط يُرسله النظام في الهيدر x-app-key لمنع الاستخدام الخارجي
const RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = s => String(s == null ? '' : s).replace(/[<>"\r\n]/g, ' ').trim().slice(0, 80);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة' });
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'مفتاح RESEND_API_KEY غير مضبوط في إعدادات فيرسيل' });
  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) return res.status(401).json({ error: 'رمز الإرسال غير صحيح' });

  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b); } catch (e) { return res.status(400).json({ error: 'بيانات غير صالحة' }); }
  b = b || {};
  // مستلمو العميل يأتون من النظام، ونسخة الشركة تُضاف هنا من متغير COMPANY_EMAIL (غير مسجّلة في بيانات النظام)
  const to = Array.isArray(b.to) ? b.to.slice(0, 1) : [];
  if (to.some(t => !t || !RE.test(String(t.email || '')))) return res.status(400).json({ error: 'عنوان بريد غير صالح' });
  const co = String(process.env.COMPANY_EMAIL || '').trim();
  if (RE.test(co) && !to.some(t => String(t.email).toLowerCase() === co.toLowerCase())) to.push({ role: 'company', email: co });
  if (!to.length) return res.status(400).json({ error: 'لا يوجد مستلم: سجّل بريد العميل أو أضف COMPANY_EMAIL في فيرسيل' });
  const pdf = String(b.pdf || '');
  if (!pdf.startsWith('JVBER') || pdf.length > 5500000) return res.status(400).json({ error: 'ملف PDF غير صالح أو كبير' });

  const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
  const company = clean(b.company) || 'البنيان للتشطيبات العامة';
  const code = clean(b.code), client = clean(b.client), project = clean(b.project), status = clean(b.status);
  const total = Number(b.total) || 0;
  const money = total.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const subject = `مقايسة ${code} - ${client}`;
  const text = `${company}\n\nمرفق ملف PDF للمقايسة رقم ${code}\nالعميل: ${client}\nالمشروع: ${project}\nالحالة: ${status}\nإجمالي المقايسة: ${money} جنيه مصري`;
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8;color:#14224f"><h3 style="margin:0 0 8px">${esc(company)}</h3><p>مرفق ملف PDF للمقايسة رقم <b>${esc(code)}</b></p><p>العميل: <b>${esc(client)}</b><br>المشروع: ${esc(project)}<br>الحالة: ${esc(status)}<br>إجمالي المقايسة: <b>${esc(money)}</b> جنيه مصري</p></div>`;
  const filename = String(b.filename || 'estimate.pdf').replace(/[^\w.\-]/g, '_').slice(0, 60) || 'estimate.pdf';

  const results = [];
  for (const t of to) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${company.replace(/[,;]/g, ' ')} <${from}>`, to: [t.email], subject, text, html, attachments: [{ filename, content: pdf }] })
      });
      const j = await r.json().catch(() => ({}));
      results.push(r.ok ? { role: t.role, ok: true, id: j.id } : { role: t.role, ok: false, error: j.message || ('Resend ' + r.status) });
    } catch (e) { results.push({ role: t.role, ok: false, error: 'تعذّر الاتصال بـ Resend' }); }
  }
  return res.status(200).json({ results });
};
