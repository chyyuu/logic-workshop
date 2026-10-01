export function parseProgramText(text: string): number[] {
  const tokens = text.trim() ? text.trim().split(/[\s,]+/) : [];
  if (tokens.length > 256) throw new Error('ROM 最多保存 256 个指令字。');
  return tokens.map((token, index) => {
    if (!/^(?:0x)?[0-9a-f]{1,4}$/i.test(token)) throw new Error(`第 ${index + 1} 个字无效，请输入 0000–FFFF 的十六进制数。`);
    return Number.parseInt(token.replace(/^0x/i, ''), 16);
  });
}
export function formatProgramText(words: number[]): string {
  return words.map(word => word.toString(16).toUpperCase().padStart(4, '0')).join('\n');
}
