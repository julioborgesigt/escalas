# Modelos do `@vladmandic/face-api`

Estes arquivos são copiados de `node_modules/@vladmandic/face-api/model/` e
ficam aqui para serem servidos diretamente pela CDN do Cloudflare Pages em
`/face-api/...`. Antes eram baixados de `cdn.jsdelivr.net`, o que adicionava:

- dependência de terceiro com possibilidade de rate limit / indisponibilidade,
- entrada extra na CSP (`connect-src https://cdn.jsdelivr.net`).

Hoje o `SignaturePad.svelte` usa `loadFromUri('/face-api/')`.

## Como atualizar

Caso atualize o pacote `@vladmandic/face-api`, rode (PowerShell):

```powershell
Copy-Item "node_modules/@vladmandic/face-api/model/tiny_face_detector_model-weights_manifest.json" "static/face-api/" -Force
Copy-Item "node_modules/@vladmandic/face-api/model/tiny_face_detector_model.bin" "static/face-api/" -Force
```

ou (bash/zsh):

```bash
cp node_modules/@vladmandic/face-api/model/tiny_face_detector_model-weights_manifest.json static/face-api/
cp node_modules/@vladmandic/face-api/model/tiny_face_detector_model.bin static/face-api/
```

Hoje só o `tinyFaceDetector` é usado. Se a UI passar a usar outros modelos
(`face_landmark_68`, `face_recognition`, `age_gender`, etc.), copie os pares
`*_manifest.json` + `*.bin` correspondentes da mesma pasta.
