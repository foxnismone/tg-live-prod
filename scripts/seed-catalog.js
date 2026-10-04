#!/usr/bin/env node
/**
 * ============================================================
 * SEED — Catálogo real de TecnoGamer
 * ============================================================
 * Inserta productos reales (hardware, gaming, periféricos) con
 * categorías, imágenes SVG generadas localmente, stock y precios.
 * Idempotente: no duplica si el SKU ya existe.
 *
 * Uso:  node scripts/seed-catalog.js
 * ============================================================
 */
"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("../backend/config/sqlite-compat");

const DB_PATH = path.resolve(__dirname, "..", "data", "ecommerce.db");
const IMG_DIR = path.resolve(__dirname, "..", "uploads", "products");

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

/* ─── Generador de imagen de producto (SVG → archivo) ──── */
function makeImage(slug, emoji, colorFrom, colorTo, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colorFrom}"/>
      <stop offset="100%" stop-color="${colorTo}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="#0b1120"/>
  <rect x="30" y="30" width="540" height="540" rx="28" fill="url(#g)" opacity="0.14"/>
  <rect x="30" y="30" width="540" height="540" rx="28" fill="none" stroke="${colorFrom}" stroke-width="2" opacity="0.35"/>
  <text x="300" y="300" font-size="200" text-anchor="middle" dominant-baseline="central">${emoji}</text>
  <text x="300" y="470" font-size="26" font-family="Inter,sans-serif" font-weight="700"
        fill="#f1f5f9" text-anchor="middle">${label}</text>
  <text x="300" y="508" font-size="17" font-family="Inter,sans-serif"
        fill="#94a3b8" text-anchor="middle">TecnoGamer</text>
</svg>`;
  const file = path.join(IMG_DIR, `${slug}.svg`);
  fs.writeFileSync(file, svg, "utf8");
  return `/uploads/products/${slug}.svg`;
}

/* ─── Catálogo ─────────────────────────────────────────── */
const CATEGORIES = [
  { slug: "componentes-pc",  name: "Componentes PC",  icon: "🧩" },
  { slug: "consolas",        name: "Consolas",        icon: "🎮" },
  { slug: "videojuegos",     name: "Videojuegos",     icon: "🕹️" },
  { slug: "perifericos",     name: "Periféricos",     icon: "⌨️" },
  { slug: "notebooks",       name: "Notebooks",       icon: "💻" },
  { slug: "monitores",       name: "Monitores",       icon: "🖥️" },
  { slug: "almacenamiento",  name: "Almacenamiento",  icon: "💾" },
  { slug: "audio",           name: "Audio",           icon: "🎧" },
];

const PRODUCTS = [
  // Componentes PC
  { sku: "CPU-RYZEN7-7800X3D", name: "AMD Ryzen 7 7800X3D", cat: "componentes-pc", price: 429990, was: 499990, stock: 24, emoji: "🧠", c1: "#ef4444", c2: "#f59e0b",
    desc: "Procesador de 8 núcleos y 16 hilos con 3D V-Cache de 96 MB. El rey indiscutible del gaming en AM5, con un rendimiento excepcional por vatio.",
    tags: ["gaming","am5","8-nucleos"] },
  { sku: "GPU-RTX4070S-12G", name: "NVIDIA GeForce RTX 4070 Super 12GB", cat: "componentes-pc", price: 649990, was: 729990, stock: 12, emoji: "🎴", c1: "#10b981", c2: "#3b82f6",
    desc: "Tarjeta gráfica con DLSS 3.5 y trazado de rayos de tercera generación. Ideal para 1440p a alto refresco y creadores de contenido.",
    tags: ["gaming","rtx","1440p","dlss"] },
  { sku: "MB-B650-TOMAHAWK", name: "MSI MAG B650 Tomahawk WiFi", cat: "componentes-pc", price: 219990, stock: 18, emoji: "🔌", c1: "#8b5cf6", c2: "#3b82f6",
    desc: "Placa madre AM5 con VRM robusto de 14+2+1 fases, WiFi 6E, PCIe 4.0 y disipadores M.2. Base sólida para cualquier build de alto rendimiento.",
    tags: ["am5","wifi6e","pcie4"] },
  { sku: "RAM-DDR5-32-6000", name: "Kingston Fury Beast DDR5 32GB (2x16) 6000MHz", cat: "componentes-pc", price: 129990, was: 149990, stock: 35, emoji: "⚡", c1: "#f59e0b", c2: "#ef4444",
    desc: "Kit de memoria DDR5 con perfil EXPO/XMP a 6000 MT/s CL30. Latencia baja para exprimir los procesadores de última generación.",
    tags: ["ddr5","6000mhz","expo"] },
  { sku: "PSU-850W-GOLD", name: "Corsair RM850x 850W 80+ Gold Full Modular", cat: "componentes-pc", price: 149990, stock: 22, emoji: "🔋", c1: "#10b981", c2: "#059669",
    desc: "Fuente totalmente modular con certificación 80+ Gold, modo silencioso Zero-RPM y condensadores japoneses de 105 °C. 10 años de garantía.",
    tags: ["80plus-gold","modular","850w"] },
  { sku: "CASE-LIANLI-O11", name: "Lian Li O11 Dynamic EVO", cat: "componentes-pc", price: 179990, stock: 9, emoji: "🗄️", c1: "#64748b", c2: "#8b5cf6",
    desc: "Gabinete de doble cámara con panel de vidrio templado, excelente flujo de aire y soporte para radiadores de 360 mm. Configurable en tres orientaciones.",
    tags: ["atx","vidrio-templado","watercooling"] },

  // Consolas
  { sku: "CON-PS5-SLIM", name: "PlayStation 5 Slim Digital", cat: "consolas", price: 549990, was: 599990, stock: 15, emoji: "🎮", c1: "#3b82f6", c2: "#8b5cf6",
    desc: "Consola de nueva generación con SSD ultra rápido, trazado de rayos y audio 3D. Incluye un juego digital a elección.",
    tags: ["sony","4k","ssd"] },
  { sku: "CON-XBOX-SERIES-X", name: "Xbox Series X 1TB", cat: "consolas", price: 529990, stock: 11, emoji: "🟩", c1: "#10b981", c2: "#059669",
    desc: "La consola más potente de Xbox con 12 teraflops, 4K nativo a 120 fps y Quick Resume. Compatible con Game Pass Ultimate.",
    tags: ["microsoft","4k","120fps"] },
  { sku: "CON-NINTENDO-OLED", name: "Nintendo Switch OLED Blanca", cat: "consolas", price: 349990, stock: 20, emoji: "🍄", c1: "#ef4444", c2: "#f59e0b",
    desc: "Pantalla OLED de 7 pulgadas con colores vivos, soporte ajustable y 64 GB de almacenamiento. Híbrida: juega en TV o portátil.",
    tags: ["nintendo","oled","portatil"] },

  // Videojuegos
  { sku: "GAME-ELDENRING", name: "Elden Ring — Shadow of the Erdtree Edition", cat: "videojuegos", price: 59990, was: 69990, stock: 45, emoji: "⚔️", c1: "#f59e0b", c2: "#ef4444",
    desc: "La obra maestra de FromSoftware con su expansión completa. Mundo abierto, combate exigente y una dirección artística memorable.",
    tags: ["rpg","soulslike","goty"] },
  { sku: "GAME-CYBERPUNK", name: "Cyberpunk 2077: Ultimate Edition", cat: "videojuegos", price: 49990, stock: 60, emoji: "🌆", c1: "#f59e0b", c2: "#8b5cf6",
    desc: "Incluye el juego base y la expansión Phantom Liberty. Night City en todo su esplendor con la tecnología de trazado de rayos completa.",
    tags: ["rpg","open-world","raytracing"] },
  { sku: "GAME-TOTK", name: "The Legend of Zelda: Tears of the Kingdom", cat: "videojuegos", price: 54990, stock: 38, emoji: "🗡️", c1: "#10b981", c2: "#3b82f6",
    desc: "La secuela de Breath of the Wild lleva la exploración y la construcción a un nivel nunca visto en la saga.",
    tags: ["nintendo","aventura","exclusivo"] },
  { sku: "GAME-SPIDERMAN2", name: "Marvel's Spider-Man 2", cat: "videojuegos", price: 59990, stock: 0, emoji: "🕷️", c1: "#ef4444", c2: "#3b82f6",
    desc: "Balancea entre Peter Parker y Miles Morales en una Nueva York expandida con nuevas habilidades simbióticas.",
    tags: ["accion","exclusivo","ps5"] },

  // Periféricos
  { sku: "KB-LOGITECH-G915", name: "Logitech G915 TKL Lightspeed", cat: "perifericos", price: 199990, was: 229990, stock: 16, emoji: "⌨️", c1: "#3b82f6", c2: "#8b5cf6",
    desc: "Teclado mecánico inalámbrico con interruptores GL de perfil bajo, iluminación RGB LIGHTSYNC y 40 horas de batería.",
    tags: ["mecanico","inalambrico","rgb"] },
  { sku: "MS-LOGITECH-GPRO", name: "Logitech G Pro X Superlight 2", cat: "perifericos", price: 149990, stock: 28, emoji: "🖱️", c1: "#64748b", c2: "#3b82f6",
    desc: "Mouse inalámbrico de 60 gramos con sensor HERO 2 de 32K DPI. El estándar de los jugadores profesionales de esports.",
    tags: ["esports","inalambrico","60g"] },
  { sku: "MB-CONTROL-XBOX", name: "Xbox Elite Series 2 Controller", cat: "perifericos", price: 179990, stock: 14, emoji: "🎯", c1: "#10b981", c2: "#3b82f6",
    desc: "Control pro con palancas intercambiables, gatillos ajustables y perfiles guardables. Acabado premium y estuche de carga incluido.",
    tags: ["pro","inalambrico","personalizable"] },

  // Notebooks
  { sku: "NB-ASUS-ROG-G14", name: "ASUS ROG Zephyrus G14 (2024)", cat: "notebooks", price: 1599990, was: 1799990, stock: 7, emoji: "💻", c1: "#ef4444", c2: "#f59e0b",
    desc: "Notebook gamer de 14\" con OLED 3K 120Hz, Ryzen 9 y RTX 4070. Potencia de escritorio en un chasis de 1.5 kg.",
    tags: ["gaming","oled","rtx4070"] },
  { sku: "NB-MACBOOK-AIR-M3", name: "MacBook Air 13\" M3 256GB", cat: "notebooks", price: 1199990, stock: 13, emoji: "🍎", c1: "#64748b", c2: "#8b5cf6",
    desc: "Chip M3 con CPU de 8 núcleos, hasta 18 horas de batería y diseño sin ventilador. Silencioso, ligero y muy potente.",
    tags: ["apple","m3","ultrabook"] },
  { sku: "NB-LENOVO-LOQ", name: "Lenovo LOQ 15 RTX 4050", cat: "notebooks", price: 899990, was: 999990, stock: 10, emoji: "💻", c1: "#3b82f6", c2: "#10b981",
    desc: "Notebook gamer de entrada con pantalla 144Hz, RTX 4050 y teclado retroiluminado. La mejor relación precio/rendimiento.",
    tags: ["gaming","rtx4050","144hz"] },

  // Monitores
  { sku: "MON-LG-27-OLED", name: "LG UltraGear 27\" OLED 240Hz", cat: "monitores", price: 899990, was: 999990, stock: 8, emoji: "🖥️", c1: "#8b5cf6", c2: "#3b82f6",
    desc: "Monitor OLED QHD con 240 Hz, 0.03 ms de respuesta y DisplayHDR True Black 400. Colores perfectos para gaming y creación.",
    tags: ["oled","240hz","qhd"] },
  { sku: "MON-SAMSUNG-ODYSSEY-G9", name: "Samsung Odyssey G9 49\" Curvo", cat: "monitores", price: 1299990, stock: 5, emoji: "🌌", c1: "#3b82f6", c2: "#8b5cf6",
    desc: "Monitor ultrapanorámico 32:9 con curvatura 1000R y 240 Hz. Inmersión total para simulación y multitarea extrema.",
    tags: ["ultrawide","240hz","curvo"] },
  { sku: "MON-ASUS-27-165", name: "ASUS TUF Gaming 27\" 165Hz IPS", cat: "monitores", price: 249990, stock: 25, emoji: "🖥️", c1: "#f59e0b", c2: "#ef4444",
    desc: "Monitor QHD IPS de 165 Hz con 1 ms MPRT, compatible con FreeSync Premium y G-SYNC. Excelente equilibrio calidad/precio.",
    tags: ["ips","165hz","qhd"] },

  // Almacenamiento
  { sku: "SSD-SAMSUNG-990PRO-2TB", name: "Samsung 990 PRO 2TB NVMe Gen4", cat: "almacenamiento", price: 189990, was: 219990, stock: 30, emoji: "💾", c1: "#3b82f6", c2: "#10b981",
    desc: "SSD NVMe PCIe 4.0 con lecturas de hasta 7.450 MB/s. Disipador integrado y fiabilidad Samsung para gaming y trabajo profesional.",
    tags: ["nvme","pcie4","2tb"] },
  { sku: "SSD-CRUCIAL-X9-4TB", name: "Crucial X9 Pro 4TB SSD Portátil", cat: "almacenamiento", price: 159990, stock: 19, emoji: "📦", c1: "#64748b", c2: "#3b82f6",
    desc: "SSD externo con USB-C de 10 Gbps, resistente a golpes, polvo y agua. Ideal para llevar tu biblioteca de juegos a cualquier parte.",
    tags: ["portatil","usb-c","4tb"] },
  { sku: "HDD-SEAGATE-8TB", name: "Seagate Barracuda 8TB 7200RPM", cat: "almacenamiento", price: 129990, stock: 24, emoji: "🗃️", c1: "#10b981", c2: "#059669",
    desc: "Disco duro de 3.5\" con 256 MB de caché para almacenamiento masivo de juegos, backups y multimedia.",
    tags: ["hdd","8tb","7200rpm"] },

  // Audio
  { sku: "AUD-HYPERX-CLOUD3", name: "HyperX Cloud III Wireless", cat: "audio", price: 129990, was: 149990, stock: 26, emoji: "🎧", c1: "#ef4444", c2: "#f59e0b",
    desc: "Audífonos inalámbricos con 120 horas de batería, drivers de 53 mm y micrófono con cancelación de ruido. Comodidad para sesiones largas.",
    tags: ["inalambrico","120h","gaming"] },
  { sku: "AUD-SONY-WH1000XM5", name: "Sony WH-1000XM5", cat: "audio", price: 299990, stock: 17, emoji: "🎵", c1: "#3b82f6", c2: "#8b5cf6",
    desc: "El referente en cancelación activa de ruido. Sonido de alta resolución, 30 horas de autonomía y llamadas nítidas.",
    tags: ["anc","hires","bluetooth"] },
  { sku: "AUD-MIC-HYPERX-QUADCAST", name: "HyperX QuadCast S USB", cat: "audio", price: 119990, stock: 21, emoji: "🎙️", c1: "#8b5cf6", c2: "#ef4444",
    desc: "Micrófono USB con patrón de captación seleccionable, filtro antipop integrado y amortiguador antivibración. Listo para streaming.",
    tags: ["usb","streaming","rgb"] },
  { sku: "AUD-SPEAKER-LOGITECH-G560", name: "Logitech G560 RGB Gaming Speaker", cat: "audio", price: 149990, stock: 12, emoji: "🔊", c1: "#f59e0b", c2: "#ef4444",
    desc: "Parlantes 2.1 con 240 W de potencia e iluminación RGB sincronizada con el juego mediante LIGHTSYNC.",
    tags: ["2.1","rgb","240w"] },
];

/* ─── Ejecución ────────────────────────────────────────── */
function run() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  let catCount = 0, prodCount = 0, imgCount = 0;

  // Categorías
  const insCat = db.prepare(
    `INSERT INTO categories (name, slug, description, sort_order, is_active)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name`
  );
  const getCat = db.prepare("SELECT id FROM categories WHERE slug = ?");

  CATEGORIES.forEach((c, i) => {
    insCat.run(c.name, c.slug, `Categoría ${c.name}`, i);
    catCount++;
  });

  // Productos
  const insProd = db.prepare(
    `INSERT INTO products
       (sku, name, slug, description, category_id, price, compare_at_price,
        stock_quantity, stock_status, is_active, is_featured, is_new,
        tags, rating_avg, rating_count, total_sales, views, requires_shipping)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(sku) DO NOTHING`
  );

  const slugify = (s) => s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").trim()
    .replace(/\s+/g, "-").replace(/-+/g, "-");

  const insImg = db.prepare(
    `INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary)
     VALUES (?, ?, ?, ?, ?)`
  );
  const getProd = db.prepare("SELECT id FROM products WHERE sku = ?");

  PRODUCTS.forEach((p, i) => {
    const cat = getCat.get(p.cat);
    const slug = slugify(p.name);
    const stockStatus = p.stock === 0 ? "out_of_stock" : p.stock <= 5 ? "low_stock" : "in_stock";
    const rating = (3.9 + ((i * 7) % 11) / 10).toFixed(1);
    const ratingCount = 12 + ((i * 23) % 180);

    insProd.run(
      p.sku, p.name, slug, p.desc, cat ? cat.id : null,
      p.price, p.was || null, p.stock, stockStatus,
      i % 4 === 0 ? 1 : 0,          // featured
      i < 6 ? 1 : 0,                // new
      JSON.stringify(p.tags || []),
      Number(rating), ratingCount,
      20 + ((i * 17) % 300),        // total_sales
      100 + ((i * 53) % 900)        // views
    );

    const prod = getProd.get(p.sku);
    if (prod) {
      prodCount++;
      // Dos imágenes por producto: principal + variante
      const url1 = makeImage(slug, p.emoji, p.c1, p.c2, p.name);
      const url2 = makeImage(slug + "-2", p.emoji, p.c2, p.c1, p.name);
      const existing = db.prepare("SELECT COUNT(*) c FROM product_images WHERE product_id = ?").get(prod.id);
      if (existing.c === 0) {
        insImg.run(prod.id, url1, `${p.name} — vista principal`, 0, 1);
        insImg.run(prod.id, url2, `${p.name} — vista alternativa`, 1, 0);
        imgCount += 2;
      }
    }
  });

  const totals = {
    productos: db.prepare("SELECT COUNT(*) c FROM products").get().c,
    categorias: db.prepare("SELECT COUNT(*) c FROM categories").get().c,
    imagenes: db.prepare("SELECT COUNT(*) c FROM product_images").get().c,
  };

  console.log(`\n✅  Catálogo cargado`);
  console.log(`   Categorías procesadas: ${catCount}`);
  console.log(`   Productos insertados:  ${prodCount}`);
  console.log(`   Imágenes generadas:    ${imgCount}`);
  console.log(`\n📊  Totales en la base de datos:`);
  console.log(`   Productos:   ${totals.productos}`);
  console.log(`   Categorías:  ${totals.categorias}`);
  console.log(`   Imágenes:    ${totals.imagenes}\n`);

  db.close();
}

run();
