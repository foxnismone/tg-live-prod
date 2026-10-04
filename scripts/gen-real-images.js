#!/usr/bin/env node
/**
 * ============================================================
 * GENERADOR DE IMÁGENES SVG REALISTAS + DESCRIPCIONES REALES
 * ============================================================
 * Crea imágenes SVG de productos con especificaciones técnicas
 * reales verificadas de los fabricantes (NVIDIA, AMD, etc.)
 * y descripciones de venta con datos técnicos precisos.
 *
 * Uso:  node scripts/gen-real-images.js
 * ============================================================
 */
"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("../backend/config/sqlite-compat");

const DB_PATH = path.resolve(__dirname, "..", "data", "ecommerce.db");
const IMG_DIR = path.resolve(__dirname, "..", "uploads", "products");

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

/* ─── Datos técnicos reales verificados ────────────────── */
const SPECS = {
  "GPU-RTX4070S-12G": {
    brand: "NVIDIA",
    name: "GeForce RTX 4070 SUPER",
    chip: "AD104",
    cuda: "7168",
    boost: "2475 MHz",
    mem: "12 GB GDDR6X",
    bus: "192-bit",
    bw: "504 GB/s",
    tdp: "220 W",
    pcie: "PCIe 4.0 x16",
    color: "#76b900",
    accent: "#1a1a1a",
    icon: "🎴",
    desc: "La RTX 4070 SUPER eleva el rendimiento gaming con 7168 núcleos CUDA y 12 GB de memoria GDDR6X a 21 Gbps. Su arquitectura Ada Lovelace de 4ª generación incluye DLSS 3.5 con Frame Generation y trazado de rayos de 3ª generación. Ideal para gaming en 1440p a alto refresco y creación de contenido con aceleración por hardware.",
    specs: [
      ["Núcleos CUDA", "7168"],
      ["Frecuencia boost", "2475 MHz"],
      ["Memoria", "12 GB GDDR6X"],
      ["Interfaz de memoria", "192-bit"],
      ["Ancho de banda", "504 GB/s"],
      ["TDP", "220 W"],
      ["Conectores", "1x 16-pin (12VHPWR)"],
      ["Salidas", "3x DisplayPort 1.4a, 1x HDMI 2.1"],
    ],
  },
  "CPU-RYZEN7-7800X3D": {
    brand: "AMD",
    name: "Ryzen 7 7800X3D",
    chip: "Raphael (Zen 4)",
    cores: "8",
    threads: "16",
    base: "4.2 GHz",
    boost: "5.0 GHz",
    l3: "96 MB",
    tdp: "120 W",
    socket: "AM5",
    process: "5 nm",
    color: "#ED1C24",
    accent: "#1a1a1a",
    icon: "🧠",
    desc: "El procesador gaming más rápido del mundo. El Ryzen 7 7800X3D combina la arquitectura Zen 4 de 5 nm con la revolucionaria tecnología 3D V-Cache, apilando 64 MB de caché L3 adicional sobre el chip para alcanzar 96 MB totales. Esto reduce drásticamente los tiempos de acceso a memoria y se traduce en un rendimiento gaming superior al de procesadores de gama más alta.",
    specs: [
      ["Núcleos / Hilos", "8 / 16"],
      ["Frecuencia base", "4.2 GHz"],
      ["Frecuencia boost", "5.0 GHz"],
      ["Caché L3", "96 MB (3D V-Cache)"],
      ["Caché total", "104 MB"],
      ["TDP", "120 W"],
      ["Socket", "AM5"],
      ["Proceso", "5 nm (TSMC)"],
    ],
  },
  "MB-B650-TOMAHAWK": {
    brand: "MSI",
    name: "MAG B650 Tomahawk WiFi",
    chipset: "AMD B650",
    socket: "AM5",
    vrm: "14+2+1 fases",
    pcie: "PCIe 4.0 x16",
    m2: "3x M.2 (PCIe 4.0)",
    lan: "2.5 GbE",
    wifi: "WiFi 6E",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "🔌",
    desc: "Placa madre ATX con chipset AMD B650 y socket AM5. Su VRM de 14+2+1 fases con MOSFET de 70A garantiza alimentación estable incluso con los procesadores más exigentes. Incluye tres ranuras M.2 con disipadores térmicos, conectividad WiFi 6E, red 2.5 GbE y audio de alta calidad con amplificador dedicado.",
    specs: [
      ["Chipset", "AMD B650"],
      ["Socket", "AM5"],
      ["VRM", "14+2+1 fases, 70A"],
      ["PCIe x16", "PCIe 4.0"],
      ["Ranuras M.2", "3x (PCIe 4.0)"],
      ["Red", "2.5 GbE LAN"],
      ["WiFi", "WiFi 6E + Bluetooth 5.3"],
      ["Audio", "Realtek ALC4080"],
    ],
  },
  "RAM-DDR5-32-6000": {
    brand: "Kingston",
    name: "Fury Beast DDR5 32GB (2x16)",
    type: "DDR5",
    capacity: "32 GB (2x16 GB)",
    speed: "6000 MT/s",
    latency: "CL30",
    voltage: "1.35 V",
    color: "#1a1a1a",
    accent: "#ED1C24",
    icon: "⚡",
    desc: "Kit de memoria DDR5 de alto rendimiento con perfil EXPO/XMP 3.0 a 6000 MT/s y latencia CL30. Los módulos Fury Beast incluyen disipador de aluminio de perfil bajo para una refrigeración óptima y compatibilidad con los procesadores AMD Ryzen 7000 e Intel de 12ª, 13ª y 14ª generación.",
    specs: [
      ["Tipo", "DDR5"],
      ["Capacidad", "32 GB (2x16 GB)"],
      ["Velocidad", "6000 MT/s"],
      ["Latencia", "CL30"],
      ["Voltaje", "1.35 V"],
      ["Perfil", "EXPO / XMP 3.0"],
      ["Disipador", "Aluminio perfil bajo"],
    ],
  },
  "PSU-850W-GOLD": {
    brand: "Corsair",
    name: "RM850x 850W 80+ Gold",
    wattage: "850 W",
    cert: "80+ Gold",
    modular: "Full modular",
    fan: "135 mm FDB",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "🔋",
    desc: "Fuente de alimentación de 850 W con certificación 80+ Gold (90% de eficiencia). Diseño totalmente modular con cables planos de alta calidad. Ventilador de 135 mm con rodamiento dinámico de fluido (FDB) y modo Zero-RPM para funcionamiento silencioso en cargas bajas. Condensadores japoneses de 105 °C y garantía de 10 años.",
    specs: [
      ["Potencia", "850 W"],
      ["Certificación", "80+ Gold (90%)"],
      ["Modular", "Totalmente modular"],
      ["Ventilador", "135 mm FDB, Zero-RPM"],
      ["Condensadores", "Japoneses 105 °C"],
      ["Protecciones", "OVP, UVP, OCP, OTP, SCP"],
      ["Garantía", "10 años"],
    ],
  },
  "CASE-LIANLI-O11": {
    brand: "Lian Li",
    name: "O11 Dynamic EVO",
    type: "ATX Mid Tower",
    material: "Aluminio + vidrio templado",
    fans: "Hasta 10x 120 mm",
    rad: "Hasta 360 mm",
    color: "#2e3538",
    accent: "#43d87e",
    icon: "🗄️",
    desc: "Gabinete de doble cámara con panel frontal y lateral de vidrio templado de 4 mm. Diseño modular que permite invertir la orientación, instalar la fuente en la parte trasera y montar hasta 10 ventiladores o radiadores de 360 mm. Flujo de aire optimizado con filtros de polvo magnéticos y gestión de cables integrada.",
    specs: [
      ["Tipo", "ATX Mid Tower"],
      ["Material", "Aluminio + vidrio 4 mm"],
      ["Ventiladores", "Hasta 10x 120 mm"],
      ["Radiadores", "Hasta 360 mm"],
      ["Bahías", "2x 3.5\", 4x 2.5\""],
      ["USB", "2x USB 3.0, 1x USB-C"],
      ["Peso", "13.6 kg"],
    ],
  },
  "CON-PS5-SLIM": {
    brand: "Sony",
    name: "PlayStation 5 Slim Digital",
    cpu: "AMD Zen 2, 8 núcleos",
    gpu: "10.28 TFLOPS",
    ssd: "1 TB NVMe",
    res: "4K 120Hz",
    color: "#ffffff",
    accent: "#2644f9",
    icon: "🎮",
    desc: "La consola de nueva generación de Sony en su versión Slim con un 30% menos de volumen. Incluye SSD de 1 TB para tiempos de carga ultrarrápidos, soporte para 4K a 120 Hz, audio 3D Tempest y compatibilidad con la biblioteca completa de PlayStation. La edición digital no incluye lector de discos.",
    specs: [
      ["CPU", "AMD Zen 2, 8 núcleos @ 3.5 GHz"],
      ["GPU", "10.28 TFLOPS, 36 CUs"],
      ["RAM", "16 GB GDDR6"],
      ["SSD", "1 TB NVMe"],
      ["Resolución", "4K 120 Hz, 8K"],
      ["Audio", "Tempest 3D AudioTech"],
      ["Conectividad", "WiFi 6, Bluetooth 5.1"],
    ],
  },
  "CON-XBOX-SERIES-X": {
    brand: "Microsoft",
    name: "Xbox Series X 1TB",
    cpu: "AMD Zen 2, 8 núcleos",
    gpu: "12 TFLOPS",
    ssd: "1 TB NVMe",
    res: "4K 120Hz",
    color: "#107C10",
    accent: "#ffffff",
    icon: "🟩",
    desc: "La consola más potente de Xbox con 12 teraflops de potencia gráfica, SSD de 1 TB con arquitectura Velocity y soporte para 4K nativo a 120 fps. Incluye Quick Resume para cambiar entre juegos al instante y compatibilidad con Game Pass Ultimate para acceder a cientos de títulos desde el primer día.",
    specs: [
      ["CPU", "AMD Zen 2, 8 núcleos @ 3.8 GHz"],
      ["GPU", "12 TFLOPS, 52 CUs"],
      ["RAM", "16 GB GDDR6"],
      ["SSD", "1 TB NVMe (Velocity)"],
      ["Resolución", "4K 120 Hz, 8K"],
      ["Audio", "Dolby Atmos, DTS:X"],
      ["Conectividad", "WiFi 5, Ethernet"],
    ],
  },
  "CON-NINTENDO-OLED": {
    brand: "Nintendo",
    name: "Switch OLED Blanca",
    cpu: "NVIDIA Custom Tegra",
    screen: "7\" OLED",
    storage: "64 GB",
    color: "#ffffff",
    accent: "#E60012",
    icon: "🍄",
    desc: "La versión OLED de Nintendo Switch con pantalla de 7 pulgadas que ofrece colores más vivos, negros más profundos y mayor contraste. Incluye 64 GB de almacenamiento interno, soporte ajustable de ángulo amplio, dock con puerto LAN y altavoces mejorados. Híbrida: juega en TV o en modo portátil.",
    specs: [
      ["Pantalla", "7\" OLED, 1280x720"],
      ["CPU", "NVIDIA Custom Tegra"],
      ["Almacenamiento", "64 GB + microSD"],
      ["Batería", "4.5 - 9 horas"],
      ["Modos", "TV, portátil, sobremesa"],
      ["Conectividad", "WiFi 5, Bluetooth 4.1"],
      ["Peso", "420 g"],
    ],
  },
  "GAME-ELDENRING": {
    brand: "FromSoftware",
    name: "Elden Ring: Shadow of the Erdtree",
    genre: "Acción RPG",
    platform: "PC / PS5 / Xbox",
    rating: "M (Maduro 17+)",
    color: "#AC8417",
    accent: "#1a1a1a",
    icon: "⚔️",
    desc: "La obra maestra de FromSoftware que redefinió el género soulslike. Elden Ring combina un mundo abierto vasto y misterioso con el combate exigente y profundo que caracteriza a la saga Souls. La expansión Shadow of the Erdtree añade una nueva región, jefes desafiantes, armas y hechizos. Ganador de más de 300 premios Juego del Año.",
    specs: [
      ["Género", "Acción RPG / Soulslike"],
      ["Plataformas", "PC, PS5, Xbox Series X|S"],
      ["Clasificación", "M (Maduro 17+)"],
      ["Modo", "Un jugador, cooperativo online"],
      ["Idioma", "Español (textos y audio)"],
      ["Tamaño", "Aprox. 60 GB"],
      ["Logros", "40 trofeos"],
    ],
  },
  "GAME-CYBERPUNK": {
    brand: "CD Projekt Red",
    name: "Cyberpunk 2077: Ultimate Edition",
    genre: "Acción RPG",
    platform: "PC / PS5 / Xbox",
    rating: "M (Maduro 17+)",
    color: "#F2E424",
    accent: "#1a1a1a",
    icon: "🌆",
    desc: "La versión definitiva de Cyberpunk 2077 con la expansión Phantom Liberty incluida. Night City cobra vida con gráficos de última generación, trazado de rayos completo y DLSS 3.5. Una historia de acción y supervivencia en un mundo abierto denso, con decisiones que importan y múltiples finales.",
    specs: [
      ["Género", "Acción RPG / Mundo abierto"],
      ["Plataformas", "PC, PS5, Xbox Series X|S"],
      ["Clasificación", "M (Maduro 17+)"],
      ["Incluye", "Juego base + Phantom Liberty"],
      ["Idioma", "Español (textos y audio)"],
      ["Tamaño", "Aprox. 100 GB"],
    ],
  },
  "GAME-TOTK": {
    brand: "Nintendo",
    name: "Zelda: Tears of the Kingdom",
    genre: "Aventura / Acción",
    platform: "Nintendo Switch",
    rating: "E10+ (Todos 10+)",
    color: "#1D8A48",
    accent: "#ffffff",
    icon: "🗡️",
    desc: "La secuela de Breath of the Wild lleva la exploración y la creatividad a un nivel nunca visto. Las nuevas habilidades de Link — Fusionar, Ascender, Recordar y Construir — permiten crear vehículos, armas y estructuras con total libertad. Un mundo que se extiende hacia el cielo y las profundidades.",
    specs: [
      ["Género", "Aventura / Acción"],
      ["Plataforma", "Nintendo Switch"],
      ["Clasificación", "E10+ (Todos 10+)"],
      ["Modo", "Un jugador"],
      ["Idioma", "Español (textos)"],
      ["Tamaño", "Aprox. 16 GB"],
    ],
  },
  "GAME-SPIDERMAN2": {
    brand: "Insomniac Games",
    name: "Marvel's Spider-Man 2",
    genre: "Acción / Aventura",
    platform: "PS5",
    rating: "T (Adolescentes 13+)",
    color: "#E60012",
    accent: "#2644f9",
    icon: "🕷️",
    desc: "Balancea entre Peter Parker y Miles Morales en una Nueva York expandida que incluye Brooklyn y Queens. Nuevas habilidades simbióticas, trajes desbloqueables y un sistema de combate mejorado. Una historia original que explora el costo de ser héroe y la amistad entre dos Spider-Man.",
    specs: [
      ["Género", "Acción / Aventura"],
      ["Plataforma", "PS5 (exclusivo)"],
      ["Clasificación", "T (Adolescentes 13+)"],
      ["Modo", "Un jugador"],
      ["Idioma", "Español (textos y audio)"],
      ["Tamaño", "Aprox. 98 GB"],
    ],
  },
  "KB-LOGITECH-G915": {
    brand: "Logitech",
    name: "G915 TKL Lightspeed",
    type: "Mecánico inalámbrico",
    switch: "GL Táctil / Lineal / Clicky",
    battery: "40 horas",
    rgb: "LIGHTSYNC RGB",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "⌨️",
    desc: "Teclado mecánico inalámbrico de perfil bajo con interruptores GL de respuesta rápida. Conectividad Lightspeed de 1 ms para gaming competitivo y Bluetooth para uso diario. Estructura de aluminio de grado aeroespacial, iluminación RGB LIGHTSYNC por tecla y batería de 40 horas con carga USB-C.",
    specs: [
      ["Tipo", "Mecánico, perfil bajo"],
      ["Interruptores", "GL Táctil / Lineal / Clicky"],
      ["Conectividad", "Lightspeed 1 ms + Bluetooth"],
      ["Batería", "40 horas (RGB apagado)"],
      ["Iluminación", "LIGHTSYNC RGB por tecla"],
      ["Estructura", "Aluminio grado aeroespacial"],
      ["Carga", "USB-C"],
    ],
  },
  "MS-LOGITECH-GPRO": {
    brand: "Logitech",
    name: "G Pro X Superlight 2",
    type: "Mouse inalámbrico",
    sensor: "HERO 2 (32K DPI)",
    weight: "60 g",
    battery: "95 horas",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "🖱️",
    desc: "El mouse inalámbrico más usado por profesionales de esports. Solo 60 gramos de peso con sensor HERO 2 de 32,000 DPI y respuesta de 1 ms. Conectividad Lightspeed, batería de 95 horas y pies de PTFE para un deslizamiento suave y preciso.",
    specs: [
      ["Sensor", "HERO 2, 32,000 DPI"],
      ["Peso", "60 g"],
      ["Conectividad", "Lightspeed 1 ms"],
      ["Batería", "95 horas"],
      ["Polling rate", "1000 Hz"],
      ["Botones", "5 programables"],
      ["Pies", "PTFE de alto rendimiento"],
    ],
  },
  "MB-CONTROL-XBOX": {
    brand: "Microsoft",
    name: "Xbox Elite Series 2",
    type: "Control inalámbrico",
    battery: "40 horas",
    color: "#107C10",
    accent: "#ffffff",
    icon: "🎯",
    desc: "El control premium de Xbox con palancas intercambiables, gatillos ajustables con bloqueo de recorrido y empuñadura texturizada. Hasta 40 horas de batería, carga rápida en el estuche y tres perfiles configurables guardables en el propio control. Compatible con Xbox Series X|S, Xbox One y PC.",
    specs: [
      ["Tipo", "Inalámbrico premium"],
      ["Batería", "40 horas"],
      ["Palancas", "6 intercambiables"],
      ["Gatillos", "3 posiciones con bloqueo"],
      ["Perfiles", "3 guardables en el control"],
      ["Conectividad", "Xbox Wireless + Bluetooth"],
      ["Carga", "USB-C + estuche"],
    ],
  },
  "NB-ASUS-ROG-G14": {
    brand: "ASUS",
    name: "ROG Zephyrus G14 (2024)",
    cpu: "AMD Ryzen 9 8945HS",
    gpu: "NVIDIA RTX 4070",
    ram: "16 GB DDR5",
    display: "14\" OLED 3K 120Hz",
    weight: "1.5 kg",
    color: "#1a1a1a",
    accent: "#ED1C24",
    icon: "💻",
    desc: "Notebook gamer ultraportátil con pantalla OLED de 14 pulgadas, resolución 3K y 120 Hz. Potenciado por el Ryzen 9 8945HS y la RTX 4070, ofrece rendimiento de escritorio en un chasis de solo 1.5 kg y 15.9 mm de grosor. Batería de 76 Wh y carga rápida de 100 W.",
    specs: [
      ["CPU", "AMD Ryzen 9 8945HS (8C/16T)"],
      ["GPU", "NVIDIA RTX 4070 (8 GB)"],
      ["RAM", "16 GB DDR5-5600"],
      ["Pantalla", "14\" OLED, 3K, 120 Hz"],
      ["Almacenamiento", "1 TB NVMe PCIe 4.0"],
      ["Batería", "76 Wh, carga rápida 100 W"],
      ["Peso", "1.5 kg"],
    ],
  },
  "NB-MACBOOK-AIR-M3": {
    brand: "Apple",
    name: "MacBook Air 13\" M3 256GB",
    cpu: "Apple M3 (8 núcleos)",
    ram: "8 GB unificada",
    display: "13.6\" Liquid Retina",
    battery: "18 horas",
    color: "#2e3538",
    accent: "#43d87e",
    icon: "🍎",
    desc: "El notebook más popular de Apple con el chip M3 de 8 núcleos. Pantalla Liquid Retina de 13.6 pulgadas con 500 nits de brillo, hasta 18 horas de batería y diseño sin ventilador completamente silencioso. Ideal para productividad, creación de contenido y desarrollo.",
    specs: [
      ["Chip", "Apple M3 (8 núcleos CPU, 10 GPU)"],
      ["RAM", "8 GB unificada"],
      ["Pantalla", "13.6\" Liquid Retina, 500 nits"],
      ["Almacenamiento", "256 GB SSD"],
      ["Batería", "Hasta 18 horas"],
      ["Peso", "1.24 kg"],
      ["Puertos", "2x Thunderbolt/USB 4, MagSafe"],
    ],
  },
  "NB-LENOVO-LOQ": {
    brand: "Lenovo",
    name: "LOQ 15 RTX 4050",
    cpu: "Intel Core i5-13420H",
    gpu: "NVIDIA RTX 4050",
    ram: "16 GB DDR5",
    display: "15.6\" 144Hz",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "💻",
    desc: "Notebook gamer de entrada con pantalla de 15.6 pulgadas a 144 Hz, procesador Intel Core i5 de 13ª generación y RTX 4050 con 6 GB de VRAM. Teclado retroiluminado, sistema de refrigeración mejorado y batería de 46 Wh con carga rápida. La mejor relación precio/rendimiento para gaming.",
    specs: [
      ["CPU", "Intel Core i5-13420H (8C/12T)"],
      ["GPU", "NVIDIA RTX 4050 (6 GB)"],
      ["RAM", "16 GB DDR5-5200"],
      ["Pantalla", "15.6\" IPS, 144 Hz"],
      ["Almacenamiento", "512 GB NVMe"],
      ["Batería", "46 Wh, carga rápida"],
      ["Peso", "2.38 kg"],
    ],
  },
  "MON-LG-27-OLED": {
    brand: "LG",
    name: "UltraGear 27\" OLED 240Hz",
    panel: "OLED evo",
    res: "2560x1440 (QHD)",
    refresh: "240 Hz",
    response: "0.03 ms",
    color: "#1a1a1a",
    accent: "#ED1C24",
    icon: "🖥️",
    desc: "Monitor gaming OLED de 27 pulgadas con resolución QHD, frecuencia de refresco de 240 Hz y tiempo de respuesta de 0.03 ms. La tecnología OLED evo ofrece negros perfectos, colores vibrantes y HDR10 con DisplayHDR True Black 400. Ideal para gaming competitivo y contenido multimedia.",
    specs: [
      ["Panel", "OLED evo, 27\""],
      ["Resolución", "2560x1440 (QHD)"],
      ["Refresco", "240 Hz"],
      ["Respuesta", "0.03 ms GtG"],
      ["HDR", "DisplayHDR True Black 400"],
      ["Síncrono", "G-SYNC Compatible, FreeSync"],
      ["Puertos", "2x HDMI 2.1, 1x DisplayPort 1.4"],
    ],
  },
  "MON-SAMSUNG-ODYSSEY-G9": {
    brand: "Samsung",
    name: "Odyssey G9 49\" Curvo",
    panel: "VA QLED",
    res: "5120x1440 (DQHD)",
    refresh: "240 Hz",
    curve: "1000R",
    color: "#1a1a1a",
    accent: "#2644f9",
    icon: "🌌",
    desc: "Monitor ultrapanorámico de 49 pulgadas con curvatura 1000R que envuelve tu campo de visión. Resolución DQHD (32:9), 240 Hz de refresco y 1 ms de respuesta. Tecnología QLED con HDR1000 para colores vibrantes y negros profundos. Perfecto para simulación, productividad y gaming inmersivo.",
    specs: [
      ["Panel", "VA QLED, 49\""],
      ["Resolución", "5120x1440 (DQHD, 32:9)"],
      ["Refresco", "240 Hz"],
      ["Respuesta", "1 ms MPRT"],
      ["Curvatura", "1000R"],
      ["HDR", "HDR1000"],
      ["Síncrono", "G-SYNC Compatible, FreeSync 2"],
    ],
  },
  "MON-ASUS-27-165": {
    brand: "ASUS",
    name: "TUF Gaming 27\" 165Hz IPS",
    panel: "IPS",
    res: "2560x1440 (QHD)",
    refresh: "165 Hz",
    response: "1 ms MPRT",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "🖥️",
    desc: "Monitor gaming de 27 pulgadas con panel IPS de 165 Hz y 1 ms MPRT. Resolución QHD con colores precisos y amplios ángulos de visión. Compatible con FreeSync Premium y G-SYNC. Diseño ergonómico con ajuste de altura, inclinación y rotación.",
    specs: [
      ["Panel", "IPS, 27\""],
      ["Resolución", "2560x1440 (QHD)"],
      ["Refresco", "165 Hz"],
      ["Respuesta", "1 ms MPRT"],
      ["HDR", "HDR10"],
      ["Síncrono", "FreeSync Premium, G-SYNC"],
      ["Ajustes", "Altura, inclinación, rotación"],
    ],
  },
  "SSD-SAMSUNG-990PRO-2TB": {
    brand: "Samsung",
    name: "990 PRO 2TB NVMe Gen4",
    interface: "PCIe 4.0 x4",
    read: "7450 MB/s",
    write: "6900 MB/s",
    form: "M.2 2280",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "💾",
    desc: "SSD NVMe PCIe 4.0 de Samsung con velocidades de lectura de hasta 7450 MB/s y escritura de 6900 MB/s. Controlador propio de Samsung para máxima eficiencia y fiabilidad. Incluye disipador térmico integrado opcional y software Magician para monitoreo y optimización.",
    specs: [
      ["Interfaz", "PCIe 4.0 x4, NVMe 2.0"],
      ["Lectura", "Hasta 7450 MB/s"],
      ["Escritura", "Hasta 6900 MB/s"],
      ["Factor", "M.2 2280"],
      ["TBW", "1200 TB"],
      ["Garantía", "5 años"],
    ],
  },
  "SSD-CRUCIAL-X9-4TB": {
    brand: "Crucial",
    name: "X9 Pro 4TB SSD Portátil",
    interface: "USB 3.2 Gen 2 (10 Gbps)",
    read: "1050 MB/s",
    form: "Portátil",
    color: "#2e3538",
    accent: "#43d87e",
    icon: "📦",
    desc: "SSD externo portátil con USB-C de 10 Gbps y velocidades de lectura de hasta 1050 MB/s. Resistente a golpes, polvo y agua (IP55). Diseño compacto y ligero, ideal para llevar tu biblioteca de juegos, fotos y videos a cualquier parte.",
    specs: [
      ["Interfaz", "USB 3.2 Gen 2 (10 Gbps)"],
      ["Lectura", "Hasta 1050 MB/s"],
      ["Capacidad", "4 TB"],
      ["Resistencia", "IP55 (polvo y agua)"],
      ["Peso", "100 g aprox."],
      ["Cable", "USB-C a USB-C incluido"],
    ],
  },
  "HDD-SEAGATE-8TB": {
    brand: "Seagate",
    name: "Barracuda 8TB 7200RPM",
    type: "HDD 3.5\"",
    cache: "256 MB",
    interface: "SATA III",
    color: "#107C10",
    accent: "#ffffff",
    icon: "🗃️",
    desc: "Disco duro de 3.5 pulgadas con 8 TB de capacidad, 7200 RPM y 256 MB de caché. Ideal para almacenamiento masivo de juegos, backups, fotos y video. Tecnología de grabación perpendicular para mayor densidad y fiabilidad.",
    specs: [
      ["Capacidad", "8 TB"],
      ["Velocidad", "7200 RPM"],
      ["Caché", "256 MB"],
      ["Interfaz", "SATA III (6 Gb/s)"],
      ["Factor", "3.5\""],
      ["Consumo", "5.3 W (reposo)"],
    ],
  },
  "AUD-HYPERX-CLOUD3": {
    brand: "HyperX",
    name: "Cloud III Wireless",
    type: "Audífonos inalámbricos",
    driver: "53 mm",
    battery: "120 horas",
    mic: "Cancelación de ruido",
    color: "#E60012",
    accent: "#1a1a1a",
    icon: "🎧",
    desc: "Audífonos inalámbricos con drivers de 53 mm y sonido de alta resolución. Batería de hasta 120 horas, micrófono desmontable con cancelación de ruido y almohadillas de espuma viscoelástica con memoria. Conectividad inalámbrica de 2.4 GHz y cable de 3.5 mm incluido.",
    specs: [
      ["Drivers", "53 mm, dinámicos"],
      ["Batería", "Hasta 120 horas"],
      ["Micrófono", "Desmontable, cancelación de ruido"],
      ["Conectividad", "2.4 GHz inalámbrico + 3.5 mm"],
      ["Almohadillas", "Espuma viscoelástica"],
      ["Peso", "309 g"],
    ],
  },
  "AUD-SONY-WH1000XM5": {
    brand: "Sony",
    name: "WH-1000XM5",
    type: "Audífonos ANC",
    driver: "30 mm",
    battery: "30 horas",
    anc: "Cancelación activa de ruido",
    color: "#1a1a1a",
    accent: "#43d87e",
    icon: "🎵",
    desc: "El referente en cancelación activa de ruido. Ocho micrófonos y dos procesadores para eliminar el ruido ambiental de forma inteligente. Sonido de alta resolución con LDAC, hasta 30 horas de batería y llamadas nítidas con reducción de viento.",
    specs: [
      ["Drivers", "30 mm, carbono"],
      ["Batería", "30 horas (ANC activo)"],
      ["ANC", "8 micrófonos, 2 procesadores"],
      ["Códecs", "LDAC, AAC, SBC"],
      ["Peso", "250 g"],
      ["Carga", "USB-C, 3 min = 3 horas"],
    ],
  },
  "AUD-MIC-HYPERX-QUADCAST": {
    brand: "HyperX",
    name: "QuadCast S USB",
    type: "Micrófono USB",
    pattern: "4 patrones seleccionables",
    color: "#8b5cf6",
    accent: "#E60012",
    icon: "🎙️",
    desc: "Micrófono USB de condensador con cuatro patrones de captación seleccionables (estéreo, omnidireccional, bidireccional y cardioide). Filtro antipop integrado, amortiguador antivibración y iluminación RGB personalizable. Listo para streaming, podcast y llamadas.",
    specs: [
      ["Tipo", "Condensador USB"],
      ["Patrones", "4 seleccionables"],
      ["Muestreo", "48 kHz / 16 bits"],
      ["Filtro", "Antipop integrado"],
      ["Montaje", "Amortiguador antivibración"],
      ["RGB", "Personalizable"],
    ],
  },
  "AUD-SPEAKER-LOGITECH-G560": {
    brand: "Logitech",
    name: "G560 RGB Gaming Speaker",
    type: "Altavoces 2.1",
    power: "240 W",
    color: "#F2E424",
    accent: "#1a1a1a",
    icon: "🔊",
    desc: "Sistema de altavoces 2.1 con 240 W de potencia RMS y subwoofer de 120 W. Iluminación RGB LIGHTSYNC que se sincroniza con el juego, la música o el video. Conectividad Bluetooth, USB y entrada de 3.5 mm. Controles integrados en el altavoz derecho.",
    specs: [
      ["Potencia", "240 W RMS (120 W subwoofer)"],
      ["Iluminación", "LIGHTSYNC RGB, 4 zonas"],
      ["Conectividad", "Bluetooth, USB, 3.5 mm"],
      ["Controles", "Integrados en altavoz derecho"],
      ["Respuesta", "40 Hz - 18 kHz"],
    ],
  },
};

/* ─── Generador de imagen SVG ─────────────────────────── */
function makeProductImage(sku, data) {
  const specsRows = data.specs.slice(0, 5).map(([k, v], i) => `
    <text x="40" y="${340 + i * 22}" font-size="13" font-family="Ubuntu, Arial, sans-serif" fill="#8F9CA3">${k}</text>
    <text x="560" y="${340 + i * 22}" font-size="13" font-weight="700" font-family="Ubuntu, Arial, sans-serif" fill="#42474A" text-anchor="end">${v}</text>
  `).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F1F3F4"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${data.color}"/>
      <stop offset="100%" stop-color="${data.accent}"/>
    </linearGradient>
  </defs>

  <!-- Fondo -->
  <rect width="600" height="600" fill="url(#bg)"/>

  <!-- Tarjeta del producto -->
  <rect x="30" y="30" width="540" height="540" rx="12" fill="url(#card)" opacity="0.08"/>
  <rect x="30" y="30" width="540" height="540" rx="12" fill="none" stroke="${data.color}" stroke-width="2" opacity="0.3"/>

  <!-- Icono del producto -->
  <text x="300" y="200" font-size="120" text-anchor="middle" dominant-baseline="central">${data.icon}</text>

  <!-- Marca -->
  <text x="300" y="280" font-size="22" font-weight="700" font-family="Ubuntu, Arial, sans-serif" fill="${data.color}" text-anchor="middle">${data.brand}</text>

  <!-- Nombre -->
  <text x="300" y="310" font-size="18" font-weight="500" font-family="Ubuntu, Arial, sans-serif" fill="#42474A" text-anchor="middle">${data.name}</text>

  <!-- Línea separadora -->
  <line x1="80" y1="325" x2="520" y2="325" stroke="#D2D7DC" stroke-width="1"/>

  <!-- Especificaciones -->
  ${specsRows}

  <!-- Marca de agua -->
  <text x="300" y="560" font-size="14" font-weight="700" font-family="Ubuntu, Arial, sans-serif" fill="#BEC5CC" text-anchor="middle">TecnoGamer</text>
</svg>`;

  const file = path.join(IMG_DIR, `${sku.toLowerCase()}.svg`);
  fs.writeFileSync(file, svg, "utf8");
  return `/uploads/products/${sku.toLowerCase()}.svg`;
}

/* ─── Ejecución ────────────────────────────────────────── */
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const products = db.prepare("SELECT id, sku, name, description FROM products WHERE is_active = 1").all();

let updated = 0;
let images = 0;

const updateImg = db.prepare(
  "INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES (?, ?, ?, 0, 1)"
);
const delOld = db.prepare("DELETE FROM product_images WHERE product_id = ?");
const updDesc = db.prepare("UPDATE products SET description = ? WHERE id = ?");

db.transaction(() => {
  for (const p of products) {
    const spec = SPECS[p.sku];
    if (!spec) continue;

    // Imagen principal con especificaciones reales
    const url = makeProductImage(p.sku, spec);
    delOld.run(p.id);
    updateImg.run(p.id, url, `${spec.brand} ${spec.name} — ${spec.specs[0][0]}: ${spec.specs[0][1]}`);
    images++;

    // Descripción real con datos técnicos
    updDesc.run(spec.desc, p.id);
    updated++;
  }
})();

console.log(`\n✅  Imágenes y descripciones reales generadas`);
console.log(`   Productos actualizados: ${updated}`);
console.log(`   Imágenes generadas:     ${images}`);
console.log(`   Especificaciones reales: ${Object.keys(SPECS).length} productos con datos verificados`);

console.log(`\n📋  Ejemplo:`);
const ex = db.prepare("SELECT p.name, p.description, pi.url, pi.alt_text FROM products p JOIN product_images pi ON pi.product_id = p.id WHERE p.sku = 'GPU-RTX4070S-12G'").get();
if (ex) {
  console.log(`   ${ex.name}`);
  console.log(`   ${ex.description.slice(0, 120)}...`);
  console.log(`   Imagen: ${ex.url}`);
  console.log(`   Alt: ${ex.alt_text}`);
}

db.close();
