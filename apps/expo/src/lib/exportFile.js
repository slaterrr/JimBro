// Save or share the Excel export. Web: browser download. Phone: write to the cache folder and open
// the share sheet (Files, Mail, Drive…). No credentials and no upload by JimBro itself.
import { Platform, Share } from 'react-native';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function saveBytes(bytes, filename) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { ok: true, where: 'Downloads' };
  }
  const { File, Paths } = await import('expo-file-system');
  const file = new File(Paths.cache, filename);
  try { file.create({ overwrite: true }); } catch { /* exists */ }
  await file.write(bytes);
  await Share.share({ url: file.uri, title: filename });
  return { ok: true, where: 'share sheet' };
}
