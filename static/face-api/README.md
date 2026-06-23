# Modelos do `@vladmandic/face-api`

Estes arquivos são copiados de `node_modules/@vladmandic/face-api/model/` e
ficam aqui para serem servidos diretamente pela CDN do Cloudflare Pages em
`/face-api/...`. Antes eram baixados de `cdn.jsdelivr.net`, o que adicionava:

- dependência de terceiro com possibilidade de rate limit / indisponibilidade,
- entrada extra na CSP (`connect-src https://cdn.jsdelivr.net`).

Hoje o `SignaturePad.svelte` usa `loadFromUri('/face-api/')`.

## Modelos atuais

| Arquivo | Uso |
|---|---|
| `tiny_face_detector_*` | Detecção de presença de rosto (sempre carregado) |
| `face_landmark_68_*` | 68 landmarks faciais — mandíbula + ponta do nariz para o desafio **head_turn** (proxy 2D de guinada/yaw) |
| `face_expression_*` | Reconhecimento de expressões (smile challenge — happy probability > 0.7) |

Os 3 são usados pela **liveness ativa** (challenge-response) em
`SignaturePad.svelte` — sorria/vire-a-cabeça aleatório a cada assinatura para
barrar foto/vídeo pré-gravado. O desafio de **piscar (blink/EAR) foi aposentado**:
em celular o pipeline de landmarks (200-400 ms/frame) não amostra de forma
confiável a fase fechada da piscada (~100-150 ms). Os desafios atuais são
**sustentados** (≥ 1 s), imunes à amostragem lenta — ver
`src/lib/liveness-challenge.ts`.

## Como atualizar

Caso atualize o pacote `@vladmandic/face-api`, rode (bash/zsh):

```bash
cd $(git rev-parse --show-toplevel)
for m in tiny_face_detector face_landmark_68 face_expression; do
  cp node_modules/@vladmandic/face-api/model/${m}_model-weights_manifest.json static/face-api/
  cp node_modules/@vladmandic/face-api/model/${m}_model.bin static/face-api/
done
```

Se a UI passar a usar outros modelos (`face_recognition` para comparação 1:1
biométrica, `age_gender`, etc.), adicione os pares `*_manifest.json` + `*.bin`
correspondentes da mesma pasta `node_modules/@vladmandic/face-api/model/`.
