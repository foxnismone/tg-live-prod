#!/usr/bin/env node
/**
 * Genera base de datos SQLite con productos demo del e-commerce
 * Usa sql.js (WASM) para evitar problemas de compilación nativa
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "tecnogamer.db");

// Verificar si existe
if (fs.existsSync(DB_PATH)) {
  console.log("✅ Base de datos ya existe:", DB_PATH);
  console.log("   Tamaño:", fs.statSync(DB_PATH).size, "bytes");
  console.log("\nPuedes iniciar el servidor con:");
  console.log("   node scripts/start.js");
  process.exit(0);
}

// Intentar con sql.js (WASM — sin compilación nativa)
try {
  const initSqlJs = require("sql.js");
  initSqlJs().then(SQL => {
    const db = new SQL.Database();

    // ─── Schema ────────────────────────────────────────────────
    db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        parent_id INTEGER,
        image_url TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        category_id INTEGER REFERENCES categories(id),
        price REAL NOT NULL DEFAULT 0,
        compare_at_price REAL,
        stock_quantity INTEGER DEFAULT 0,
        stock_status TEXT DEFAULT 'in_stock',
        is_active INTEGER DEFAULT 1,
        is_featured INTEGER DEFAULT 0,
        is_new INTEGER DEFAULT 0,
        seo_title TEXT,
        seo_description TEXT,
        views INTEGER DEFAULT 0,
        total_sales INTEGER DEFAULT 0,
        rating_avg REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER DEFAULT 1,
        UNIQUE(session_id, product_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        name TEXT,
        role TEXT DEFAULT 'customer',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        order_number TEXT UNIQUE,
        status TEXT DEFAULT 'pending',
        total REAL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // ─── Seed: Categorías ────────────────────────────────────────
    const categories = [
      { name: "Hardware", slug: "hardware", description: "Componentes de PC, periféricos, almacenamiento, fuentes de poder" },
      { name: "Gaming", slug: "gaming", description: "Consolas, mouses, teclados, headsets y accesorios gamer" },
      { name: "Electrónica", slug: "electronica", description: "Smartphones, tablets, smart watches, cámaras y accesorios" },
      { name: "Juguetes", slug: "juguetes", description: "Juguetes gamer, LEGO, figuras coleccionables y más" },
      { name: "Computación", slug: "computacion", description: "Notebooks, desktops, all-in-one, monitores y accesorios" },
      { name: "Ofertas", slug: "ofertas", description: "Productos con descuento especial. Stock limitado." },
    ];

    const insertCat = db.prepare("INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)");
    categories.forEach(c => insertCat.run(c.name, c.slug, c.description));
    console.log("✅ Categorías creadas:", categories.length);

    // ─── Seed: Productos ─────────────────────────────────────────
    const products = [
      // ── HARDWARE ──
      { sku: "HW-CPU-001", name: "AMD Ryzen 5 7600X", category: "hardware",
        price: 389900, offerPrice: 349900, stock: 15, featured: 1, rating: 4.7, reviews: 124,
        description: "Procesador de 6 núcleos y 12 hilos para gaming y productividad. Frecuencia base 4.7 GHz, boost hasta 5.3 GHz. Compatible con PCIe 5.0 y DDR5. El equilibrio perfecto entre rendimiento y precio para tu PC gamer.",
        specs: "Socket AM5 | 6 núcleos / 12 hilos | 32MB L3 Cache | TDP 105W | DDR5-5200 | PCIe 5.0" },
      { sku: "HW-GPU-001", name: "NVIDIA GeForce RTX 4070 12GB", category: "hardware",
        price: 699900, offerPrice: 649900, stock: 8, featured: 1, rating: 4.9, reviews: 89,
        description: "GPU Ada Lovelace de 12GB GDDR6X. Rendimiento excepcional para gaming 1440p ultra, ray tracing y creación de contenido. DLSS 3.5 con Frame Generation. Ideal para juegos modernos y renderizado 3D.",
        specs: "12GB GDDR6X | 2310 MHz Boost | 200W TDP | 3x DP 1.4a, 1x HDMI 2.1 | Dual Ball Bearing" },
      { sku: "HW-RAM-001", name: "Corsair Vengeance DDR5 32GB (2x16) 6000MHz CL30", category: "hardware",
        price: 149900, offerPrice: 129900, stock: 22, featured: 0, rating: 4.6, reviews: 56,
        description: "Memoria RAM DDR5 de alto rendimiento con perfil XMP 3.0. 6000MHz y latencia CL30 representan el sweet spot ideal para gaming con procesadores Ryzen 7000 e Intel 13ª/14ª gen. Kit de 32GB dual channel con disipadores RGB opcionales.",
        specs: "32GB (2x16GB) DDR5 | 6000MHz CL30-38-38-96 | 1.35V | RGB / Non-RGB | XMP 3.0" },
      { sku: "HW-SSD-001", name: "Samsung 990 Pro 1TB NVMe M.2", category: "hardware",
        price: 189900, offerPrice: 159900, stock: 30, featured: 1, rating: 4.8, reviews: 203,
        description: "SSD NVMe de 1TB con velocidades de lectura de hasta 7450 MB/s y escritura de 6900 MB/s. Tecnología DRAM cache, controlador Elpis de Samsung y V-NAND 6e. El SSD más rápido para tu sistema operativo y juegos.",
        specs: "1TB | PCIe 4.0 x4 | 7450 MB/s lectura | 6900 MB/s escritura | DRAM Cache | V-NAND 6e | 5 años warranty" },
      { sku: "HW-COOLER-001", name: "Cooler Master Hyper 212 Halo DDR5", category: "hardware",
        price: 69900, offerPrice: 54900, stock: 18, featured: 0, rating: 4.5, reviews: 78,
        description: "Refrigerador de aire para procesadores con disipador AL30 de aluminio de 6 heatpipes de 6mm. Compatible con Intel LGA1700 y AMD AM5. Diseño Halo LED integrado para tu build sin costo extra.",
        specs: "6 heatpipes 6mm | Disipador AL30 | 120mm PWM fan | LGA1700/AM5/LGA1200/AM4 | 165mm altura" },
      { sku: "HW-PSU-001", name: "Seasonic Focus GX-750 750W 80 Plus Gold", category: "hardware",
        price: 129900, offerPrice: 109900, stock: 12, featured: 1, rating: 4.9, reviews: 145,
        description: "Fuente de poder de 750W con certificación 80 Plus Gold. Tecnología Atom PSU para control digital preciso, diseño Fully Modular y 10 años de garantía. La fuente de poder más recomendada para PCs de alto rendimiento.",
        specs: "750W | 80 Plus Gold | Fully Modular | +12V 62.5A | ATX 3.0 | 10 años warranty | 0dB Fan Mode" },
      // ── GAMING ──
      { sku: "GAM-PS5-001", name: "PlayStation 5 Digital Edition 1TB", category: "gaming",
        price: 899900, offerPrice: 799900, stock: 5, featured: 1, rating: 4.9, reviews: 312,
        description: "La PlayStation 5 Digital Edition te sumerge en la próxima generación sin lector de discos. SSD ultra-rápido de 1TB, ray tracing, resolutión 4K 120fps, accesorio DualSense con haptic feedback y compatibilidad con PS VR2.",
        specs: "1TB SSD | 4K 120Hz | Ray Tracing | 3D Audio Tempest | PS VR2 compatible | DualSense" },
      { sku: "GAM-XBOX-001", name: "Xbox Series X 1TB", category: "gaming",
        price: 749900, offerPrice: 689900, stock: 7, featured: 1, rating: 4.8, reviews: 187,
        description: "La consola más poderosa de Microsoft. 12 TFLOPS, SSD de 1TB, Game Pass Ultimate incluido 1 mes. Backward compatibility de 4 generaciones. Diseño minimalista con salida de video escalable hasta 4K 120Hz.",
        specs: "1TB SSD | 12 TFLOPS | 4K 120Hz | Game Pass 1 mes | HDMI 2.1 | Quantum HDR" },
      { sku: "GAM-SWITCH-001", name: "Nintendo Switch OLED — White", category: "gaming",
        price: 479900, offerPrice: 459900, stock: 10, featured: 0, rating: 4.7, reviews: 234,
        description: "Consola híbrida con pantalla OLED de 7 pulgadas, audio mejorado y contenido preinstalado. Juega en handheld, tabletop o docked. Joy-Con incluidos, 64GB internos + microSD.",
        specs: "Pantalla 7\" OLED | 1280x720 | 64GB + microSD | Joy-Con incluidos | 4.5h batería | IP no clasificada" },
      { sku: "GAM-MOUSE-001", name: "Logitech G Pro X Superlight 2", category: "gaming",
        price: 169900, offerPrice: 149900, stock: 15, featured: 1, rating: 4.8, reviews: 98,
        description: "Mouse pro-édito ultra ligero de 60g con sensor HERO 25K de 25600 DPI. Interruptores ópticos Lightforce de 70 millones de clics y batería de 70 horas. La elección de campeones de eSports mundiales.",
        specs: "60g | HERO 25K 25600 DPI | 70h batería | Inalámbrico 2.4GHz | Lightforce Optical Switches | 2 páginas SI" },
      { sku: "GAM-HEADSET-001", name: "Razer BlackShark V2 Pro — Wireless", category: "gaming",
        price: 89900, offerPrice: 69900, stock: 20, featured: 0, rating: 4.7, reviews: 156,
        description: "Headset gaming inalámbrico con drivers TriForce de 50mm, micrófono HyperClear removible de alta calidad y batería de 45 horas. Sonido surround simulado, cancelación de ruido y diseño ligero de 320g.",
        specs: "50mm TriForce Drivers | 45h batería | 320g | HyperClear Card Mic | 2.4GHz Wireless | USB-C charging" },
      { sku: "GAM-TECLADO-001", name: "Corsair K70 RGB PRO — Cherry MX Speed", category: "gaming",
        price: 129900, offerPrice: 99900, stock: 12, featured: 0, rating: 4.6, reviews: 87,
        description: "Teclado mecánico gaming con switches Cherry MX Speed Silver de 1.2mm de viaje para acciones ultra-rápidas. Malla de acero, retroiluminación RGB per-key con iCUE y construction duradera para gaming competitivo y oficina.",
        specs: "Cherry MX Speed Silver 1.2mm | Full-size | Steel frame | RGB per-key iCUE | USB-C | Aluzinc frame" },
      // ── ELECTRÓNICA ──
      { sku: "ELEC-TV-001", name: "Samsung TV Crystal UHD Smart 55\"", category: "electronica",
        price: 499900, offerPrice: 449900, stock: 10, featured: 0, rating: 4.5, reviews: 67,
        description: "Televisor Smart de 55 pulgadas con resolución 4K UHD y procesador Crystal. HDR10+ para mayor contraste, Tizen OS para acceso a Netflix, Disney+, YouTube y más. Diseño slim con stand incluido.",
        specs: "55\" | 4K UHD 3840x2160 | HDR10+ | Tizen OS | 3 HDMI 2.0 | 2 USB | Wi-Fi + Bluetooth | Slim design" },
      { sku: "ELEC-AUDIO-001", name: "Sony WH-1000XM5 — Cancelación de Ruido", category: "electronica",
        price: 279900, offerPrice: 239900, stock: 9, featured: 1, rating: 4.9, reviews: 287,
        description: "Auriculares over-ear con cancelación de ruido líder del mercado (95% de reducción), drivers de 30mm de fibra de carbón, batería de 30 horas con ANC, multipoint Bluetooth 5.2 y diseño plegable compacto.",
        specs: "30mm Carbon Fiber Drivers | ANC 95% | 30h batería (ANC on) | Multipoint BT 5.2 | IPX4 | 250g | Plegable" },
      { sku: "ELEC-AIRPODS-001", name: "AirPods Pro (2ª Gen) — MagSafe + USB-C", category: "electronica",
        price: 199900, offerPrice: 179900, stock: 18, featured: 1, rating: 4.8, reviews: 198,
        description: "AirPods Pro 2ª generación con MagSafe y cargador USB-C. Cancelación activa de ruido hasta 2x mejor, audio adaptativo, modo concentración, transparencia mejorada y IPX4. Sonido espacial con Dolby Atmos.",
        specs: "ANC adaptativa | Audio adaptativo | Modo transparencia | 6h batería (30h con caso) | IPX4 | MagSafe + USB-C" },
      { sku: "ELEC-WB-001", name: "Xiaomi Smart Band 8 Pro — AMOLED + GPS", category: "electronica",
        price: 49900, offerPrice: 39900, stock: 35, featured: 0, rating: 4.6, reviews: 112,
        description: "Banda inteligente con pantalla AMOLED de 1.47 pulgadas, GPS integrado, IP68 y monitor de salud 24/7 de frecuencia cardíaca, SpO2, sueño y estrés. 15 días de batería y más de 100 modos deportivos.",
        specs: "1.47\" AMOLED 466x466 | GPS/BDS/Glonass/Galileo | IP68 | 15d batería | FCG + SpO2 + Sleep + Stress | 100+ modos" },
      // ── JUGUETES ──
      { sku: "JUG-LEGO-001", name: "LEGO Star Wars Millennium Falcon UCS 75257", category: "juguetes",
        price: 899900, offerPrice: 799900, stock: 3, featured: 1, rating: 4.9, reviews: 45,
        description: "El set LEGO Ultimate Collector Series más ambicioso: 2024 piezas que reconstruyen la Millennium Falcon icónica del film Star Wars. Detalles interiores reproduceables, 5 minifiguras, motor de hélice retractil e inserciones LED opcionales. Mide 51x46x20 cm al completarse.",
        specs: "2024 piezas | 5 minifiguras | Tamano final 51x46x20 cm | Edad 18+ | Inspirado en Star Wars Ep. IV" },
      { sku: "JUG-MARIO-001", name: "Super Mario Bros Wonder — Nintendo Switch", category: "juguetes",
        price: 79900, offerPrice: 64900, stock: 25, featured: 1, rating: 4.9, reviews: 342,
        description: "La nueva aventura de Mario introduce Wonder Effects que transforman los niveles en tiempo real. Hasta 8 jugadores online o locales, Wonder Flower power-ups y diseño familiar brillante. La evolución más creativa de la saga Mario en décadas.",
        specs: "1-8 jugadores | Online + local | Wonder Effects | Nuevo mundo mushroom | Historia familiar | 30-40h" },
      { sku: "JUG-XBOXCTRL-001", name: "Xbox Wireless Controller — Color Veneziano", category: "gaming",
        price: 49900, offerPrice: 39900, stock: 30, featured: 0, rating: 4.7, reviews: 178,
        description: "Control Xbox Series X|S con diseño renovado: agarre delgado, triggers de turbina, texturas antideslizantes laterales y jack 3.5mm para headset. Compatible con Xbox Series X|S, Xbox One y PC (USB-C, Bluetooth o Adaptador).",
        specs: "Series X|S + Xbox One + PC | USB-C | Bluetooth | Jack 3.5mm | 30h+ batería AA | Diseño renovado" },
      { sku: "JUG-BARBIE-001", name: "Barbie Dreamhouse Supreme — Casa 3 en 1", category: "juguetes",
        price: 99900, offerPrice: 79900, stock: 8, featured: 0, rating: 4.6, reviews: 89,
        description: "La casa de Barbie más grande y jugable: 5 habitaciones, ascensor funcional, piscina en techo, garaje con puerta abatible, chimenea y muebles detallados. Compatible con todas las figuras Barbie estándar. Construcción simple y juguete duradero.",
        specs: "5 habitaciones + garaje | Ascensor funcional | Piscina techo | Puerta garaje | 48cm altura | Edad 3+ | Figuras: 1 Barbie incluida" },
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (sku, name, slug, description, category_id, price, compare_at_price, stock_quantity, stock_status, is_featured, is_new, seo_title, seo_description, rating_avg, rating_count)
      VALUES (?, ?, ?, ?, (SELECT id FROM categories WHERE slug = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    products.forEach((p, i) => {
      const catSlug = p.category;
      const offerP = p.offerPrice || null;
      const stockS = p.stock > 10 ? 'in_stock' : (p.stock > 0 ? 'low_stock' : 'out_of_stock');
      insertProd.run(
        p.sku, p.name, p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), p.description,
        catSlug, p.price, offerP, p.stock, stockS, p.featured ? 1 : 0, 1,
        `${p.name} — TecnoGamer.cl`, `${p.description.substring(0, 160)}...`,
        p.rating, p.reviews
      );
    });
    console.log("✅ Productos creados:", products.length);

    // ─── Save DB ─────────────────────────────────────────────────
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, buffer);
    db.close();

    console.log("\n✅ Base de datos generada exitosamente:");
    console.log("   📁", DB_PATH);
    console.log("   📊 Tamaño:", fs.statSync(DB_PATH).size.toLocaleString(), "bytes");
    console.log("\n🚀  Para iniciar el servidor:");
    console.log("   npm run dev      (modo desarrollo con watch)");
    console.log("   npm start        (modo producción)");
    console.log("\n📋  Para seed adicional o administración:");
    console.log("   node scripts/admin-cli.js");
  }).catch(err => {
    console.error("❌ Error inicializando sql.js:", err.message);
    console.log("\n💡  Alternativa: usa Python para generar la DB:");
    console.log("   python scripts/gen_database_py.py");
    process.exit(1);
  });
} catch (err) {
  console.error("❌ Error:", err.message);
  console.log("\n📦  Instalá sql.js primero:");
  console.log("   npm install sql.js");
  process.exit(1);
}
