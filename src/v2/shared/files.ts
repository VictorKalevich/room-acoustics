// Сохранение файла из браузера: ссылка на Blob с атрибутом download; ничего не отправляется наружу.
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadText = (name: string, text: string, type = 'application/json') => downloadBlob(name, new Blob([text], { type }));

/** Имя файла без символов, недопустимых в Windows и iOS. */
export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'room-acoustics';
