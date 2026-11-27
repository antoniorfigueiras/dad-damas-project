// Geometria do tabuleiro de Damas Portuguesas (FPD Art. 2.2)
// Casas escuras numeradas de 1 a 32; casa 1 = canto inferior direito das Brancas.

export const SQUARE = Array.from({ length: 8 }, () => Array(8).fill(0))

for (let r = 0; r < 8; r++) {
  let i = 0
  for (let c = 7; c >= 0; c--) {
    if ((r + c) % 2 === 1) {
      SQUARE[r][c] = r * 4 + ++i
    }
  }
}

export function squareAt(r, c) {
  if (r < 0 || r > 7 || c < 0 || c > 7) return 0
  return SQUARE[r][c]
}
