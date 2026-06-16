// Send a WhatsApp message via Fonnte. Mirrors the app's proven client code:
// JSON body with countryCode '60', and a guard against sending to Fonnte's own
// sender number (Fonnte returns status:true but can't WhatsApp itself, so the
// message silently never arrives). Fonnte can also return HTTP 200 with
// status:false on real failure, so we inspect the body, not just the status.

let cachedDevice = null;

async function getDeviceNumber(token) {
  if (cachedDevice !== null) return cachedDevice;
  try {
    const res = await fetch("https://api.fonnte.com/device", {
      method: "POST",
      headers: { Authorization: token },
    });
    const body = await res.json();
    cachedDevice = body && body.device ? String(body.device).replace(/\D/g, "") : "";
  } catch {
    cachedDevice = "";
  }
  return cachedDevice;
}

export async function sendWhatsApp(token, target, message) {
  if (!token) return { ok: false, error: "FONNTE_TOKEN not set" };

  const device = await getDeviceNumber(token);
  if (device && target === device) {
    return { ok: false, selfSend: true, error: "recipient is the Fonnte sender number" };
  }

  let res, text;
  try {
    res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ target, message, countryCode: "60" }),
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: "Fonnte unreachable: " + e.message };
  }
  if (!res.ok) return { ok: false, error: `Fonnte HTTP ${res.status}` };

  let body = {};
  try { body = JSON.parse(text); } catch { /* non-JSON body */ }
  if (body.status === false || body.status === "false") {
    return { ok: false, error: body.reason || "Fonnte gagal hantar" };
  }
  return { ok: true };
}
