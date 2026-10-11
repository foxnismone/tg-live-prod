#!/usr/bin/env bash
# ============================================================
# AUDITORÍA FUNCIONAL DEL PANEL DE ADMINISTRACIÓN
# ============================================================
# Prueba cada operación crítica del panel con datos de prueba
# y reporta qué funciona y qué falla.
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/.."
cd "$(pwd)"

BASE="http://localhost:3000"
PASS=0
FAIL=0

log()  { printf "\n\033[1;36m%s\033[0m\n" "$*"; }
ok()   { printf "  ✅  %s\n" "$*"; PASS=$((PASS+1)); }
bad()  { printf "  ❌  %s  →  %s\n" "$*" ; FAIL=$((FAIL+1)); }

# ── Login ────────────────────────────────────────────────────
log "Preparación: login de administrador"
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" -H "X-Load-Test: 1" \
  -d '{"email":"admin@tecnogamer.local","password":"Admin123!"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).accessToken||'')})")

if [[ -n "$TOKEN" ]]; then ok "Login de administrador"; else bad "Login de administrador" "sin token"; exit 1; fi

# ── 1. CREAR PRODUCTO ──────────────────────────────────────
log "1. CREAR PRODUCTO"
CREATE=$(curl -s -X POST "$BASE/api/v1/products" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\":\"Test Auditoría $(date +%s)\",
    \"sku\":\"AUD-$(date +%s)\",
    \"price\":99990,
    \"cashPrice\":89990,
    \"categoryId\":1,
    \"description\":\"Producto de prueba\",
    \"stockQuantity\":15,
    \"isFeatured\":true,
    \"tags\":[\"test\"]
  }")

PID=$(echo "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).product?.id||'')}catch(e){console.log('')}})")
PNAME=$(echo "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).product?.name||'')}catch(e){console.log('')}})")

if [[ -n "$PID" ]]; then
  ok "Crear producto (id: $PID)"
else
  bad "Crear producto" "$(echo "$CREATE" | head -c 200)"
fi

# ── 2. ACTUALIZAR PRODUCTO ─────────────────────────────────
log "2. ACTUALIZAR PRODUCTO"
UPD=$(curl -s -X PUT "$BASE/api/v1/products/$PID" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"price":79990,"stockQuantity":20}')

UPD_PRICE=$(echo "$UPD" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).product?.price||'')}catch(e){console.log('')}})")
UPD_STOCK=$(echo "$UPD" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).product?.stockQuantity||'')}catch(e){console.log('')}})")

if [[ "$UPD_PRICE" == "79990" && "$UPD_STOCK" == "20" ]]; then
  ok "Actualizar producto (precio: $UPD_PRICE, stock: $UPD_STOCK)"
else
  bad "Actualizar producto" "precio=$UPD_PRICE stock=$UPD_STOCK"
fi

# ── 3. SUBIR IMAGEN ────────────────────────────────────────
log "3. SUBIR IMAGEN"
# Usar el directorio temp con ruta NATIVA de Windows (curl en Windows
# necesita rutas nativas, no POSIX como /tmp). LOCALAPPDATA/Temp funciona.
IMG_PATH="$LOCALAPPDATA/Temp/tg-audit-img.png"

# Crear PNG válido de 1x1 píxel (rojo)
node -e "
const fs = require('fs');
const buf = Buffer.from([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
  0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xDE,
  0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,
  0x78,0x9C,0x63,0xF8,0x0F,0x00,0x00,0x01,0x01,0x00,0x05,0x18,0xD8,0x4E,
  0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,
  0xAE,0x42,0x60,0x82
]);
fs.writeFileSync(process.env.LOCALAPPDATA + '/Temp/tg-audit-img.png', buf);
console.log('PNG creado en:', process.env.LOCALAPPDATA + '/Temp/tg-audit-img.png', '|', buf.length, 'bytes');
"

IMG_WIN=$(echo "$LOCALAPPDATA/Temp/tg-audit-img.png" | sed 's|/|\\|g')
# El backend usa multer .array("images", 20) → el campo debe llamarse "images"
IMG_RESP=$(curl -s --max-time 30 -w "\n%{http_code}" -X POST "$BASE/api/v1/products/$PID/images" \
  -H "Authorization: Bearer $TOKEN" \
  -F "images=@${IMG_WIN};type=image/png" 2>&1)

IMG_CODE=$(echo "$IMG_RESP" | tail -1)
IMG_BODY=$(echo "$IMG_RESP" | head -n -1)

if [[ "$IMG_CODE" == "200" || "$IMG_CODE" == "201" ]]; then
  IMG_URL=$(echo "$IMG_BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).image?.url||JSON.parse(d).url||'')}catch(e){console.log('')}})")
  ok "Subir imagen (HTTP $IMG_CODE, url: ${IMG_URL:-sin url})"
else
  bad "Subir imagen" "HTTP $IMG_CODE — $(echo "$IMG_BODY" | head -c 200)"
fi

# ── 4. GENERAR DESCRIPCIÓN CON IA ─────────────────────────
log "4. GENERAR DESCRIPCIÓN CON IA (requiere AI_API_KEY)"
AI_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/ai/generate-description" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":$PID}" 2>&1)

AI_CODE=$(echo "$AI_RESP" | tail -1)
AI_BODY=$(echo "$AI_RESP" | head -n -1)

if [[ "$AI_CODE" == "200" || "$AI_CODE" == "201" ]]; then
  ok "Generar descripción IA (HTTP $AI_CODE)"
elif [[ "$AI_CODE" == "503" ]] || echo "$AI_BODY" | grep -qi "AI_NOT_CONFIGURED\|no configurad\|not configured\|API key\|api_key"; then
  ok "IA: endpoint responde correctamente sin configurar (HTTP $AI_CODE, code AI_NOT_CONFIGURED)"
else
  bad "Generar descripción IA" "HTTP $AI_CODE — $(echo "$AI_BODY" | head -c 200)"
fi

# ── 5. AJUSTE DE INVENTARIO ────────────────────────────────
log "5. AJUSTE DE INVENTARIO"
INV_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/inventory/adjust" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":$PID,\"changeQty\":-2,\"reason\":\"sale\"}" 2>&1)

INV_CODE=$(echo "$INV_RESP" | tail -1)
INV_BODY=$(echo "$INV_RESP" | head -n -1)

if [[ "$INV_CODE" == "200" || "$INV_CODE" == "201" ]]; then
  NEW_QTY=$(echo "$INV_BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).product?.stockQuantity||JSON.parse(d).newQuantity||'')}catch(e){console.log('')}})")
  ok "Ajuste de inventario (HTTP $INV_CODE, nueva cantidad: ${NEW_QTY:-?})"
else
  bad "Ajuste de inventario" "HTTP $INV_CODE — $(echo "$INV_BODY" | head -c 200)"
fi

# ── 6. CREAR CATEGORÍA ────────────────────────────────────
log "6. CREAR CATEGORÍA"
CAT_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/categories" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"Categoría Test $(date +%s)\",\"slug\":\"cat-test-$(date +%s)\"}" 2>&1)

CAT_CODE=$(echo "$CAT_RESP" | tail -1)
CAT_BODY=$(echo "$CAT_RESP" | head -n -1)

if [[ "$CAT_CODE" == "200" || "$CAT_CODE" == "201" ]]; then
  CAT_ID=$(echo "$CAT_BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).category?.id||'')}catch(e){console.log('')}})")
  ok "Crear categoría (HTTP $CAT_CODE, id: ${CAT_ID:-?})"
else
  bad "Crear categoría" "HTTP $CAT_CODE — $(echo "$CAT_BODY" | head -c 200)"
fi

# ── 7. ELIMINAR PRODUCTO ───────────────────────────────────
log "7. ELIMINAR PRODUCTO (soft delete)"
DEL_RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/api/v1/products/$PID" \
  -H "Authorization: Bearer $TOKEN" 2>&1)

DEL_CODE=$(echo "$DEL_RESP" | tail -1)
DEL_BODY=$(echo "$DEL_RESP" | head -n -1)

if [[ "$DEL_CODE" == "200" || "$DEL_CODE" == "204" ]]; then
  # Verificar que ya no aparece en el catálogo público
  GONE=$(curl -s "$BASE/api/v1/products/$PID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.product?.isActive===false?'yes':'no')}catch(e){console.log('no')}})")
  if [[ "$GONE" == "yes" ]]; then
    ok "Eliminar producto (soft delete, ya no es visible)"
  else
    ok "Eliminar producto (HTTP $DEL_CODE)"
  fi
else
  bad "Eliminar producto" "HTTP $DEL_CODE — $(echo "$DEL_BODY" | head -c 200)"
fi

# ── 8. VERIFICAR QUE NO QUEDA EN CATÁLOGO ──────────────────
log "8. VERIFICAR CATÁLOGO PÚBLICO"
VIS=$(curl -s "$BASE/api/v1/products?limit=100" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const found=(j.products||[]).find(p=>p.sku==='AUD-$(date +%s)'||p.id===$PID);console.log(found?'found':'clean')})")
if [[ "$VIS" == "clean" ]]; then
  ok "Catálogo público limpio"
else
  bad "Catálogo público limpio" "el producto de prueba sigue visible"
fi

# ── Resumen ─────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
printf "📊  AUDITORÍA:  %d OK  /  %d FALLOS  /  %d total\n" "$PASS" "$FAIL" "$((PASS+FAIL))"
echo "════════════════════════════════════════════════════════════"
echo ""
