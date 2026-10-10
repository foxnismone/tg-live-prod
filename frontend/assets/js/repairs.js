/**
 * ============================================================
 * REPARACIONES — Seguimiento de taller (lado del cliente)
 * ============================================================
 * Consulta el estado de un equipo con orden de trabajo + RUT +
 * número de serie. Todo el trabajo de validación ocurre en el
 * servidor; aquí solo se valida el formato para dar feedback rápido.
 * ============================================================
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  /* ─── Utilidades de formato ─────────────────────────────── */
  const money = (n) =>
    "$ " + Number(n || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      // SQLite devuelve "YYYY-MM-DD HH:MM:SS" en UTC
      const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
      return d.toLocaleString("es-CL", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch (_) {
      return iso;
    }
  }

  /* ─── Validación en cliente (solo formato) ──────────────── */
  function normalizeRut(v) {
    return String(v || "").replace(/[.\-\s]/g, "").toUpperCase();
  }

  function isValidRutFormat(v) {
    const rut = normalizeRut(v);
    if (rut.length < 8 || rut.length > 9) return false;
    const body = rut.slice(0, -1);
    const dv = rut.slice(-1);
    if (!/^\d+$/.test(body)) return false;

    let sum = 0, mult = 2;
    for (let i = body.length - 1; i >= 0; i--) {
      sum += parseInt(body[i], 10) * mult;
      mult = mult === 7 ? 2 : mult + 1;
    }
    const rem = 11 - (sum % 11);
    const expected = rem === 11 ? "0" : rem === 10 ? "K" : String(rem);
    return dv === expected;
  }

  /* ─── Manejo de errores por campo ───────────────────────── */
  function setFieldError(inputId, message) {
    const input = $("#" + inputId);
    const errEl = $("#rp-err-" + inputId.replace("rp-", ""));
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
    if (errEl) errEl.textContent = message || "";
  }

  function clearErrors() {
    ["rp-workorder", "rp-rut", "rp-serial"].forEach((id) => setFieldError(id, ""));
    const box = $("#rp-error-box");
    if (box) { box.hidden = true; box.textContent = ""; }
  }

  function showBoxError(msg) {
    const box = $("#rp-error-box");
    if (!box) return;
    box.className = "rp-notice";
    box.textContent = msg;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ─── Carga de información del taller ───────────────────── */
  async function loadInfo() {
    try {
      const res = await fetch("/api/v1/repairs/info");
      if (res.status === 404) {
        // Módulo desactivado
        $("#rp-form-card").hidden = true;
        $("#rp-disabled").hidden = false;
        return;
      }
      if (!res.ok) return;

      const info = await res.json();

      if (info.name) {
        $("#rp-shop-name").textContent = info.name.replace(/^Taller\s*/i, "") || "TecnoGamer";
      }
      if (info.intro) $("#rp-intro").textContent = info.intro;

      // Pie con datos de contacto
      const parts = [info.name, info.address, info.phone, info.hours].filter(Boolean);
      $("#rp-footer-info").textContent = parts.join(" · ");
    } catch (err) {
      console.error("No se pudo cargar la información del taller:", err);
    }
  }

  /* ─── Render del resultado ──────────────────────────────── */
  const STAGE_ORDER = ["received", "diagnosing", "waiting_parts", "in_repair", "testing", "ready", "delivered"];

  const STAGE_TEXT = {
    received:      ["Recibido", "Registramos tu equipo en el taller."],
    diagnosing:    ["En diagnóstico", "Un técnico está evaluando la falla."],
    waiting_parts: ["Esperando repuestos", "El diagnóstico está listo y esperamos los repuestos."],
    in_repair:     ["En reparación", "El técnico está trabajando en tu equipo."],
    testing:       ["En pruebas", "Verificamos que todo funcione antes de entregarlo."],
    ready:         ["Listo para retiro", "Tu equipo está listo. Puedes venir a retirarlo."],
    delivered:     ["Entregado", "Equipo entregado al cliente."],
  };

  function statusPillClass(status) {
    if (["cancelled", "unrepairable"].includes(status)) return "rp-status-pill--stop";
    if (["ready", "delivered"].includes(status)) return "rp-status-pill--done";
    if (["waiting_parts"].includes(status)) return "rp-status-pill--wait";
    return "";
  }

  function renderStages(currentStatus) {
    const isStopped = ["cancelled", "unrepairable"].includes(currentStatus);
    const currentIdx = STAGE_ORDER.indexOf(currentStatus);

    return STAGE_ORDER.map((key, i) => {
      const [title, desc] = STAGE_TEXT[key];
      let cls = "rp-stage--pending";
      let dot = String(i + 1);

      if (isStopped) {
        cls = i <= 0 ? "rp-stage--done" : "rp-stage--pending";
      } else if (i < currentIdx) {
        cls = "rp-stage--done";
        dot = "✓";
      } else if (i === currentIdx) {
        cls = "rp-stage--current";
        dot = "●";
      }

      return `
        <div class="rp-stage ${cls}">
          <div class="rp-stage__dot" aria-hidden="true">${dot}</div>
          <div class="rp-stage__body">
            <div class="rp-stage__title">${esc(title)}</div>
            <div class="rp-stage__desc">${esc(desc)}</div>
          </div>
        </div>`;
    }).join("");
  }

  function renderResult(repair) {
    const p = repair.progress || { percent: 0, step: 0, total: 7 };
    const deviceLabel = [repair.device?.brand, repair.device?.model].filter(Boolean).join(" ")
      || repair.device?.type || "Equipo";

    // Aviso de costo (solo si hay algo que informar)
    let costBlock = "";
    const finalCost = Number(repair.finalCost || 0);
    const estCost = Number(repair.estimatedCost || 0);
    if (finalCost > 0) {
      costBlock = `
        <div class="rp-cost">
          <p class="rp-cost__title">💰 Costo final de la reparación</p>
          <p class="rp-cost__text">${money(finalCost)} · Garantía de ${repair.warrantyDays || 90} días sobre la reparación.</p>
        </div>`;
    } else if (estCost > 0) {
      costBlock = `
        <div class="rp-cost">
          <p class="rp-cost__title">💰 Presupuesto estimado</p>
          <p class="rp-cost__text">${money(estCost)} — es un estimado. El valor final se confirma al terminar el diagnóstico.</p>
        </div>`;
    }

    // Historial de eventos
    const timeline = (repair.timeline || []).length
      ? `
        <h2 class="rp-section-title">Historial del equipo</h2>
        <div class="rp-timeline">
          ${repair.timeline.map((e) => `
            <div class="rp-event">
              <span class="rp-event__icon" aria-hidden="true">${esc(e.icon || "•")}</span>
              <div>
                <div class="rp-event__title">${esc(e.label || e.status)}</div>
                ${e.note ? `<div class="rp-event__note">${esc(e.note)}</div>` : ""}
                <div class="rp-event__meta">
                  ${formatDate(e.date)}${e.technician ? " · Técnico: " + esc(e.technician) : ""}
                </div>
              </div>
            </div>`).join("")}
        </div>`
      : "";

    $("#rp-result").innerHTML = `
      <div class="rp-card">
        <div class="rp-result-head">
          <div>
            <div class="rp-result-head__order">Orden ${esc(repair.workOrder)}</div>
            <h2 class="rp-result-head__device">${esc(deviceLabel)}</h2>
            <p class="rp-result-head__customer">
              ${esc(repair.customerName)} · RUT ${esc(repair.rutMasked)}
            </p>
          </div>
          <span class="rp-status-pill ${statusPillClass(repair.status)}">
            <span aria-hidden="true">${esc(repair.statusIcon || "•")}</span>
            ${esc(repair.statusLabel)}
          </span>
        </div>

        <div class="rp-progress">
          <div class="rp-progress__meta">
            <span>Progreso de la reparación</span>
            <span>${p.percent}% · Etapa ${p.step} de ${p.total}</span>
          </div>
          <div class="rp-progress__track" role="progressbar"
               aria-valuenow="${p.percent}" aria-valuemin="0" aria-valuemax="100"
               aria-label="Progreso de la reparación">
            <div class="rp-progress__fill" style="width:${p.percent}%"></div>
          </div>
        </div>

        <div class="rp-stages">${renderStages(repair.status)}</div>

        <div class="rp-details">
          <div class="rp-detail">
            <div class="rp-detail__key">N° de serie</div>
            <div class="rp-detail__val">${esc(repair.device?.serialNumber || "—")}</div>
          </div>
          <div class="rp-detail">
            <div class="rp-detail__key">Recibido</div>
            <div class="rp-detail__val">${formatDate(repair.receivedAt)}</div>
          </div>
          ${repair.promisedAt ? `
          <div class="rp-detail">
            <div class="rp-detail__key">Entrega estimada</div>
            <div class="rp-detail__val">${formatDate(repair.promisedAt)}</div>
          </div>` : ""}
          ${repair.technician ? `
          <div class="rp-detail">
            <div class="rp-detail__key">Técnico asignado</div>
            <div class="rp-detail__val">${esc(repair.technician)}</div>
          </div>` : ""}
          <div class="rp-detail">
            <div class="rp-detail__key">Última actualización</div>
            <div class="rp-detail__val">${formatDate(repair.lastUpdate)}</div>
          </div>
        </div>

        ${repair.reportedIssue ? `
          <h2 class="rp-section-title">Falla reportada</h2>
          <p style="font-size:.88rem;color:var(--pcf-gray-mid,#666);line-height:1.6;margin:0 0 var(--sp-4,16px)">
            ${esc(repair.reportedIssue)}
          </p>` : ""}

        ${repair.diagnosis ? `
          <h2 class="rp-section-title">Diagnóstico del técnico</h2>
          <p style="font-size:.88rem;color:var(--pcf-gray-mid,#666);line-height:1.6;margin:0 0 var(--sp-4,16px)">
            ${esc(repair.diagnosis)}
          </p>` : ""}

        ${costBlock}
        ${timeline}

        <div class="rp-actions">
          <button class="rp-btn rp-btn--ghost" id="rp-again">Consultar otra orden</button>
          <button class="rp-btn rp-btn--primary" id="rp-contact">Consultar al taller</button>
        </div>
      </div>
    `;

    $("#rp-result").hidden = false;
    $("#rp-result").scrollIntoView({ behavior: "smooth", block: "start" });

    // Acciones
    $("#rp-again")?.addEventListener("click", resetView);
    $("#rp-contact")?.addEventListener("click", () => showContactForm(repair));
  }

  /* ─── Formulario de contacto ────────────────────────────── */
  function showContactForm(repair) {
    const msg = window.prompt(
      "Escribe tu consulta y te contactaremos a la brevedad:\n\n(por ejemplo: ¿cuánto costará finalmente? / ¿puedo retirarlo hoy?)"
    );
    if (msg === null) return;
    if (!msg.trim()) return;

    // Reutilizamos los datos ya validados del formulario
    const payload = {
      workOrder: repair.workOrder,
      rut: $("#rp-rut").value,
      serialNumber: $("#rp-serial").value,
      message: msg.trim().slice(0, 1000),
      contactPreference: "phone",
    };

    fetch("/api/v1/repairs/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          window.alert(j.error);
        } else {
          window.alert("✅ Recibimos tu consulta. Te contactaremos a la brevedad.");
        }
      })
      .catch(() => window.alert("No pudimos enviar tu consulta. Intenta más tarde."));
  }

  function resetView() {
    $("#rp-result").hidden = true;
    $("#rp-result").innerHTML = "";
    $("#rp-form-card").hidden = false;
    $("#rp-form").reset();
    clearErrors();
    $("#rp-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ─── Envío del formulario ──────────────────────────────── */
  async function onSubmit(e) {
    e.preventDefault();
    clearErrors();

    const workOrder = $("#rp-workorder").value.trim();
    const rutRaw = $("#rp-rut").value.trim();
    const serial = $("#rp-serial").value.trim();
    const name = $("#rp-name").value.trim();

    /* Validación en cliente */
    let hasError = false;

    if (!workOrder) {
      setFieldError("rp-workorder", "Escribe tu número de orden de trabajo.");
      hasError = true;
    }
    if (!rutRaw) {
      setFieldError("rp-rut", "Escribe tu RUT.");
      hasError = true;
    } else if (!isValidRutFormat(rutRaw)) {
      setFieldError("rp-rut", "El RUT no es válido. Revísalo (ejemplo: 12.345.678-9).");
      hasError = true;
    }
    if (!serial) {
      setFieldError("rp-serial", "Escribe el número de serie del equipo.");
      hasError = true;
    }

    if (hasError) {
      const first = $("[aria-invalid='true']");
      if (first) first.focus();
      return;
    }

    /* Envío */
    const btn = $("#rp-submit");
    const txt = $("#rp-submit-text");
    const spin = $("#rp-spinner");

    btn.disabled = true;
    txt.textContent = "Consultando…";
    spin.hidden = false;

    try {
      const res = await fetch("/api/v1/repairs/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrder, rut: rutRaw, serialNumber: serial,
          customerName: name || undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        // Errores por campo del servidor
        if (json.code === "INVALID_RUT") {
          setFieldError("rp-rut", json.error);
          $("#rp-rut").focus();
          return;
        }
        if (json.code === "MISSING_FIELDS" && Array.isArray(json.missing)) {
          const map = {
            "número de orden": "rp-workorder",
            "RUT": "rp-rut",
            "número de serie": "rp-serial",
          };
          json.missing.forEach((m) => {
            const id = map[m];
            if (id) setFieldError(id, "Este dato es obligatorio.");
          });
          const first = $("[aria-invalid='true']");
          if (first) first.focus();
          return;
        }
        if (json.code === "REPAIR_RATE_LIMITED") {
          showBoxError(json.error);
          return;
        }
        if (json.code === "NOT_FOUND") {
          showBoxError(json.error);
          return;
        }
        showBoxError(json.error || "No pudimos consultar tu orden. Intenta más tarde.");
        return;
      }

      renderResult(json.repair);

    } catch (err) {
      console.error("Error consultando:", err);
      showBoxError("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    } finally {
      btn.disabled = false;
      txt.textContent = "Consultar estado";
      spin.hidden = true;
    }
  }

  /* ─── Inicialización ────────────────────────────────────── */
  function init() {
    loadInfo();
    $("#rp-form")?.addEventListener("submit", onSubmit);

    // Limpiar el error de un campo al escribir
    ["rp-workorder", "rp-rut", "rp-serial"].forEach((id) => {
      $("#" + id)?.addEventListener("input", () => setFieldError(id, ""));
    });

    // Formato automático del RUT mientras se escribe
    $("#rp-rut")?.addEventListener("blur", (e) => {
      const v = normalizeRut(e.target.value);
      if (v.length < 2) return;
      const body = v.slice(0, -1);
      const dv = v.slice(-1);
      e.target.value = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
    });

    // Mayúsculas automáticas en orden y serie
    ["rp-workorder", "rp-serial"].forEach((id) => {
      $("#" + id)?.addEventListener("input", (e) => {
        const pos = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(pos, pos);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
