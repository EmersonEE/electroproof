# ElectroProof

Portafolio privado de comprobantes de depósito para trabajos de electrónica.
Un cliente entra con un **código de un solo uso**, ve la galería durante
**5 minutos** y pierde el acceso al recargar, cerrar la pestaña o vencer el tiempo.

> Trabajos reales. Confianza real.

Sitio: https://emersonee.github.io/electroproof/

## Stack

- **Frontend:** HTML + CSS + JavaScript, publicado en GitHub Pages (HTTPS).
- **Backend:** Supabase Edge Functions (Deno).
- **Base de datos:** PostgreSQL con RLS.
- **Archivos:** bucket privado `evidence` en Supabase Storage.

## Estructura

```
public/                     Frontend estático (GitHub Pages)
  index.html                Ingreso de código + galería
  admin.html                Panel de administración
  css/  js/  assets/
supabase/
  config.toml               Configuración del proyecto y funciones
  migrations/               Esquema versionado de la base de datos
  functions/                Edge Functions (generate-code, redeem-code, ...)
  scripts/                  Scripts de operación puntual (bootstrap)
  .env                      Secretos locales (NO se versiona)
```

## Seguridad: reglas del proyecto

1. El cliente **nunca** habla con las tablas. Solo con Edge Functions.
2. `anon` no tiene ningún privilegio sobre `public`. Todo pasa por funciones
   con `service_role`, que vive únicamente en el servidor.
3. En la base solo se guardan **hashes** de códigos y de tokens de sesión.
4. El token de sesión vive solo en memoria de JavaScript: no hay cookies,
   `localStorage` ni `sessionStorage`.
5. El bucket `evidence` es privado. Las imágenes se entregan validando la
   sesión en **cada** solicitud.
6. Nada de esto impide una captura de pantalla mientras el acceso está activo.
   Es disuasión, no control absoluto.

## Secretos

| Clave | Dónde vive | ¿Se versiona? |
|---|---|---|
| `sb_publishable_...` (o anon key) | `public/js/config.js` | Sí, es pública por diseño |
| `SUPABASE_SERVICE_ROLE_KEY` | solo Supabase Edge Functions | **Nunca** |
| Contraseña de la base de datos | gestor de contraseñas | **Nunca** |
| `SUPABASE_DB_PASSWORD` | variable de entorno local | **Nunca** |

## Comandos

```bash
npm install                  # instala Supabase CLI local

npm run serve                # vista previa del frontend en :5173
npm run functions:deploy     # despliega todas las Edge Functions
npm run db:push              # aplica migraciones pendientes
```

## Estado

- [x] Etapa 1: proyecto Supabase
- [x] Etapa 2: esquema, RLS, bucket privado
- [x] Etapa 3: usuario admin + políticas de Storage
- [x] Etapa 4: repositorio y manejo de claves
- [x] Etapa 5: Edge Functions completas
- [x] Etapa 6: frontend
- [x] Etapa 7: marca de agua y tapado de datos
- [ ] Etapa 8: publicación y pruebas de seguridad
