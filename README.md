# Rectingeniería · Órdenes de trabajo

App web (PWA) para gestionar las órdenes de trabajo (OT) de la rectificadora: recepción con fotos, diagnóstico en milímetros, cotización por versiones, aprobación o rechazo, producción, control de calidad, pagos, crédito, factura SIIGO (referencia), entrega y paz y salvo.

## Stack

- **Interfaz:** HTML + CSS + JavaScript (módulos ES) sin compilación, en `public/`. Pensada para tablet Android; funciona en PC y celular.
- **Hosting:** Cloudflare Workers (archivos estáticos), configuración en `wrangler.jsonc`. Cada push a `main` se publica solo (Workers Builds: `npm run build` + `npx wrangler deploy`).
- **Datos:** Supabase (Postgres + Auth + Storage). Proyecto `rectingenieria`.
- **Reglas del negocio:** en la base de datos (`supabase/migrations`). El navegador no puede cambiar estados, totales ni saldos directamente: todo pasa por funciones RPC que validan y escriben el historial.

## Estructura

```
public/                 Interfaz (se publica tal cual)
  js/app.js             Sesión, menú, rutas, tiempo real
  js/db.js              Acceso a Supabase y fotos
  js/views/*.js         Pantallas
  js/whatsapp.js        Textos de WhatsApp (PENDIENTE: textos definitivos del taller)
  js/quote-image.js     Cotización como imagen
supabase/migrations/    Esquema, almacenamiento y ajustes de seguridad
supabase/functions/     admin-users (crear y administrar usuarios)
supabase/tests/         Pruebas del esquema con PGlite (npm test)
```

## Roles

- **Administrador:** todo, y además crear usuarios, autorizar crédito, anular pagos y corregir estados.
- **Técnico:** recepción, fotos, diagnóstico, cotización, aprobación/rechazo, producción, calidad, pagos, factura y entrega.

## Reglas principales

- Recepción: obligatorios marca, referencia, mecánico y al menos una pieza.
- Una cotización enviada no es una aprobación. Las cotizaciones enviadas no se editan: se crea una versión nueva.
- Al aprobar, la entrega estimada se calcula en días hábiles (lunes a sábado, sin festivos de Colombia).
- Rechazo: la cotización original queda intacta y se crea una liquidación solo con lavado y/o diagnóstico (opcionales).
- El diagnóstico va incluido en el total si se aprueba; solo se cobra aparte en un rechazo.
- Entrega: sin saldo → paz y salvo. Con saldo → solo con crédito autorizado (empresas), vence a los 30 días.
- Clientes empresa: la referencia de factura SIIGO es obligatoria para entregar.
- Pagos: no se borran, se anulan con motivo. No se acepta un pago mayor que el saldo.

## Pruebas del esquema

```
cd supabase/tests && npm install && npm test
```

## Flujo de trabajo

- **Cambios pequeños:** directo a `main` (se publican solos).
- **Cambios grandes:** en una rama, y luego se fusionan a `main`.
