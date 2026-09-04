<div align="center">

# Promptario

<br>

<img src="assets/favicon.png" alt="Icono de Promptario" width="120" align="center">

<p>
  <a href="https://renzofernando.github.io/Promptario/">
    <img src="https://img.shields.io/badge/VER%20APLICACI%C3%93N%20WEB-24221e?style=for-the-badge" alt="Ver aplicación web">
  </a>
</p>

<strong>Gestión y organización de prompts.</strong>

</div>

<br>

<p>
  Promptario es una aplicación web pensada para centralizar y reutilizar prompts de forma ordenada. Permite crear, consultar, editar y eliminar contenido, organizarlo mediante categorías y favoritos, buscar rápidamente dentro de la colección y alternar entre distintas formas de visualización según la necesidad del usuario.
</p>

## Características

- Crear, consultar, editar y eliminar prompts.
- Buscar por título, contenido o categoría.
- Organizar prompts con categorías y favoritos.
- Ordenar por título, fecha, categoría o favoritos.
- Cambiar entre distintas vistas de la colección.
- Copiar prompts al portapapeles.

## Tecnologías

- HTML5
- CSS3
- JavaScript ES Modules
- Firebase Firestore
- Cloudflare Workers
- Cloudflare D1

## Seguridad de edición

La lectura de prompts es pública. Las escrituras pasan por un Cloudflare Worker que valida un PIN privado, aplica un bloqueo global después de 5 intentos fallidos y usa una cuenta de servicio de Firebase guardada como secreto de Cloudflare. Las reglas de Firestore bloquean todas las escrituras directas desde el navegador.

## Autor y licencia

[Renzo Fernando Mosquera Daza](https://github.com/RenzoFernando)

© 2026 — Renzo Fernando Mosquera Daza

Licencia MIT.