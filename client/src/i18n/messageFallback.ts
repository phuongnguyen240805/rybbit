export function withEnglishFallback(english: Record<string, string>, translated: Record<string, string>) {
  return {
    ...english,
    ...Object.fromEntries(Object.entries(translated).filter(([, message]) => message.trim().length > 0)),
  };
}
