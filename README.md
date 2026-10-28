# EL GIGANTE SUPERMARKET — Sistema Inteligente de Gestión

Aplicación web para gestionar compras, facturas de proveedores (con OCR y visión artificial), productos, costos, inventario, pagos y reportes del supermercado EL GIGANTE.

- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · Supabase (PostgreSQL, Auth, Storage) · Zod · React Hook Form · Recharts · Claude (OCR/visión) · Vercel.
- **Idioma:** español. **Moneda:** configurable (USD por defecto).

---

## 1. Arquitectura y decisiones técnicas

| Tema | Decisión |
|---|---|
| Lecturas | Server Components con el cliente de Supabase **de la sesión del usuario**: toda consulta pasa por RLS. |
| Escrituras | Server Actions validadas con Zod en el servidor. Las operaciones críticas (confirmar/anular factura, guardar OC, recepciones, movimientos) son **funciones PL/pgSQL transaccionales** (`supabase/migrations/…003_business_logic.sql`) que vuelven a validar rol y datos. |
| Integridad | Índices únicos parciales impiden duplicar: factura confirmada por proveedor+número, historial de costo por línea, entrada de inventario por línea de documento y reverso por movimiento. Confirmar dos veces no duplica nada. |
| Inventario | El stock **sólo** cambia por `inventory_movements` (trigger). Los movimientos y la auditoría son inmutables; las correcciones son reversos/ajustes. |
| Anulaciones | `void_invoice` / `void_goods_receipt` revierten stock y marcan el historial de costos como anulado **sin borrarlo**, y recalculan el costo vigente. Requieren motivo y quedan auditadas. |
| Costos | El costo normalizado (`precio neto de línea / unidades de inventario`) se separa del **costo efectivo** según la política configurable (flete, descuentos, impuestos no recuperables, otros cargos). El precio de venta es un campo independiente. |
| Unidades | Unidades configurables con tipo (conteo, peso, volumen) y factor base. Cada línea guarda su factor de conversión explícito (ej. 1 caja = 12 botellas) — nunca se comparan presentaciones sin normalizar. |
| Archivos | Bucket **privado** `invoices` (límite 15 MB, sólo JPG/PNG/WEBP/PDF). El navegador sube directo a Storage con una URL firmada de un solo uso (evita el límite de 4,5 MB de Vercel). Se consultan con URLs firmadas de 5 minutos generadas por `/api/invoices/[id]/file`. El servidor verifica la firma binaria real (magic bytes) y el SHA-256. |
| OCR | `src/lib/ocr/` define una interfaz de proveedor; la implementación usa **Claude** (lee imágenes y PDF de varias páginas) con salida estructurada validada por Zod, confianza por campo/línea y advertencias. Si no hay clave, **no se simula**: la factura queda en "OCR fallido" y se captura manualmente. |
| Vinculación de productos | `match_product_candidates` (SQL, trigramas `pg_trgm`) + `src/lib/matching.ts`: 1) código de barras/SKU, 2) código del proveedor, 3) asociación confirmada, 4) marca+presentación, 5) nombre+unidad, 6) similitud. Sólo las coincidencias exactas se pre-confirman; las aproximadas exigen confirmación. Las asociaciones confirmadas se guardan al confirmar la factura. |
| Permisos | Roles `admin`, `purchasing`, `employee`. Se aplican en la interfaz (`src/lib/permissions.ts`), en cada Server Action/Route Handler (`requireAction`) y en la base de datos (RLS + `require_role` en las RPC). |
| Auditoría | Trigger genérico en tablas clave (`audit_logs`), con usuario, antes/después y cambios de estado. |

### Estructura

```
src/
  app/
    login/                       Inicio de sesión
    (app)/                       Área autenticada (menú lateral)
      page.tsx                   Panel principal (KPIs, gráficos, actividad)
      products/ suppliers/ purchase-orders/ invoices/ prices/
      inventory/ payments/ reports/ users/ settings/ audit/
    api/invoices/[id]/process    OCR (servidor, maxDuration 120 s)
    api/invoices/[id]/file       URL firmada del documento original
    api/reports/[key]            Exportación CSV
  components/ui/                 Componentes shadcn/ui
  components/common|charts|layout
  lib/                           auth, supabase, ocr, matching, units, reports, validaciones…
  proxy.ts                       Refresco de sesión y protección de rutas (Next 16)
supabase/
  migrations/                    Esquema, auth/auditoría, lógica, reportes, RLS, storage
  seed/demo_data.sql             Datos de demostración (opcional, marcados [DEMO])
  seed/remove_demo_data.sql
  tests/                         Prueba de integración SQL (Postgres local)
tests/unit.test.ts               Pruebas unitarias (conversiones, totales)
docs/demo/                       Factura de ejemplo para probar el OCR
```

---

## 2. Crear y configurar Supabase

1. Cree un proyecto en <https://supabase.com/dashboard>.
2. **Migraciones** (en orden). Opción A — SQL Editor: ejecute uno por uno los archivos de `supabase/migrations/` en orden numérico. Opción B — CLI:
   ```bash
   npx supabase init        # sólo si no existe supabase/config.toml (conserva migrations/)
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   Las migraciones crean tablas, índices, funciones, políticas RLS y el **bucket privado `invoices`** con sus políticas.
3. **Autenticación** (Authentication → Sign In / Providers):
   - Deje habilitado *Email* (correo + contraseña).
   - **Desactive "Allow new users to sign up"**. Las cuentas las crea el administrador desde `/users` (o desde el panel de Supabase). Esto evita registros no autorizados.
   - En *URL Configuration* ponga la URL de producción de Vercel como *Site URL*.
4. **Primer administrador:** cree el primer usuario en *Authentication → Users → Add user* (marque "Auto confirm"). **El primer perfil creado recibe el rol `admin` automáticamente**; los siguientes son `employee` salvo que el administrador indique otro rol. Hágalo inmediatamente después de las migraciones.
5. **Claves:** en *Project Settings → API Keys* copie la URL, la clave publicable (o `anon`) y la `service_role` (secreta).
6. (Opcional) **Datos de demostración:** ejecute `supabase/seed/demo_data.sql`. Todo lleva el prefijo `[DEMO]`/`DEMO-`. Elimínelos con `supabase/seed/remove_demo_data.sql` antes de operar con datos reales.

### Almacenamiento privado
La migración `…006_storage.sql` crea el bucket `invoices` con `public = false`, límite de 15 MB y tipos MIME permitidos. Sólo `admin` y `purchasing` pueden leer/subir; nadie puede borrar ni sobrescribir originales desde la API. Verifique en *Storage* que el bucket aparece como **Private**.

---

## 3. Configurar el OCR (Claude)

1. Cree una clave en <https://console.anthropic.com> → *API Keys*.
2. Defina en el servidor (nunca con prefijo `NEXT_PUBLIC_`):
   ```
   OCR_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   OCR_MODEL=claude-opus-5-5   # opcional
   ```
3. En `/settings` verá "OCR conectado". La solicitud usa salida estructurada y el modo de respaldo del servidor (`fallbacks: "default"`) para que un rechazo de clasificador no deje la factura sin procesar.

Comportamiento: imágenes > 3,5 MB o > 3000 px se reducen sólo para el OCR (el original queda intacto). PDF de varias páginas se envían completos. Cada intento queda en `invoice_processing_logs`. Si falla: botón **Procesar ahora / Reprocesar OCR** o captura manual.

---

## 4. Variables de entorno

Ver `.env.example`.

| Variable | Dónde | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | navegador + servidor | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `…ANON_KEY`) | navegador + servidor | Clave pública (protegida por RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **sólo servidor** | Crear usuarios / cambiar contraseñas en `/users` |
| `ANTHROPIC_API_KEY` | **sólo servidor** | OCR |
| `OCR_PROVIDER`, `OCR_MODEL` | servidor | Opcionales |

## 5. Desarrollo local

```bash
npm install
cp .env.example .env.local   # complete los valores
npm run dev                  # http://localhost:3000
```

## 6. Despliegue en Vercel

1. Suba el repositorio a GitHub e impórtelo en <https://vercel.com/new> (framework: Next.js, sin cambios de build).
2. En *Settings → Environment Variables* agregue las variables de la sección 4 para *Production* (y *Preview* si aplica).
3. Despliegue. Las funciones usan Node.js; la ruta de OCR declara `maxDuration = 120` (Fluid Compute, activo por defecto en proyectos nuevos).
4. En Supabase → *Authentication → URL Configuration* ponga el dominio de Vercel como *Site URL*.
5. Abra la URL en el teléfono: el menú lateral se convierte en menú desplegable y "Subir factura" ofrece **Tomar fotografía** con la cámara trasera.

La aplicación no guarda nada en el sistema de archivos de Vercel: datos en PostgreSQL y documentos en Supabase Storage.

---

## 7. Guía de pruebas

### Automáticas
```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # Pruebas unitarias (conversiones, presentaciones, totales)
npm run build       # Compilación de producción
# Base de datos: requiere un Postgres 15+ local con pg_trgm/unaccent (no Supabase)
PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:db
```
`test:db` aplica todas las migraciones sobre una base limpia (con un stub de `auth`/`storage`) y ejecuta `supabase/tests/integration_test.sql`, que verifica como usuarios reales con RLS: primer usuario admin, totales de OC, aprobación sólo admin, confirmación de factura (historial, costo $24/12 = $2 por botella, stock 5×12 = 60), bloqueo de totales descuadrados y excepción sólo admin, no duplicar confirmación ni facturas (número normalizado), detección de aumento de 8,33 %, recepción parcial sin duplicar stock, saldos de proveedor, restricciones del empleado (sin proveedores, facturas ni costos; no puede ajustar ni escalar su rol), anulación auditada que revierte stock y costo conservando el historial, e inmutabilidad de la auditoría.

### Manual (criterios de aceptación)
Usar `docs/demo/factura-demo-distribuidora-abc.png` (documento ficticio) y los datos `[DEMO]`.

1. **Iniciar sesión** con el administrador.
2. **Productos:** crear "Aceite vegetal 1 L", compra `caja`, inventario `botella`, contenido 12; editarlo.
3. **Proveedores:** registrar "Distribuidora ABC" con 30 días de crédito.
4. **Orden de compra:** crear, solicitar aprobación, aprobar, marcar enviada, descargar PDF e imprimir.
5. **Subir factura** desde el teléfono (Tomar fotografía) o la imagen de ejemplo.
6. **OCR real:** la factura pasa a "Pendiente de revisión" con las 3 líneas, confianza y advertencias.
7. **Revisar y corregir:** editar un precio → aparece la diferencia de totales y se bloquea la confirmación.
8. **Asociar:** "RICE LONG GRAIN 20LB" sugiere "Arroz grano largo…" (o use *Crear producto*); "Aceite vegetal 12/1" se vincula por código del proveedor `DEMO-ACE12`. Confirmar las coincidencias.
9. **Confirmar** la factura → inventario y costos actualizados.
10. **Historial:** en el producto, ver gráfico, tabla, último/anterior, diferencia, % y proveedor más económico.
11. **Variaciones:** registrar otra factura con precio distinto → `/prices` muestra aumento/disminución.
12. **Duplicados:** subir de nuevo la misma imagen → aviso de archivo duplicado; confirmar con el mismo número → bloqueado.
13. **Persistencia:** cerrar sesión, volver a entrar y consultar los registros.
14. **Vercel + teléfono:** repetir 5–9 desde el móvil.
15. **Permisos:** crear un usuario *Empleado*; verificar que no ve Facturas/Proveedores/Costos (menú y URL directa) y que la API responde sin datos.

---

## 8. Seguridad y fiabilidad
- RLS en todas las tablas; sin acceso anónimo. Tablas derivadas (historial, movimientos, auditoría, líneas de factura/OC) sin escritura directa: sólo vía funciones que validan rol.
- Validación Zod en el servidor en cada acción; límites de tamaño y tipo en el bucket y verificación de firma binaria.
- Claves secretas sólo en el servidor (`server-only`).
- Cabeceras de seguridad (`X-Frame-Options`, `nosniff`, `Referrer-Policy`).
- Errores de OCR registrados y reintentables; bloqueo optimista impide procesar la misma factura dos veces a la vez.

## 9. Limitaciones conocidas
- La conversión de moneda entre facturas en monedas distintas no está implementada: los reportes suman importes en la moneda registrada.
- La prueba manual del OCR requiere una `ANTHROPIC_API_KEY` válida.
- Los costos efectivos usan la política vigente al confirmar; cambiarla no recalcula facturas ya confirmadas (queda registrada en `cost_policy` de cada fila del historial).
