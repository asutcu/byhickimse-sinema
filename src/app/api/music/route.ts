import { handle } from "@/server/lib/api";
import { listLocalMusicFiles } from "@/server/services/longform";

export const runtime = "nodejs";

/** Paylasilan music/ klasorundeki parcalar (yeni proje formu icin). */
export async function GET() {
  return handle(async () => ({ files: listLocalMusicFiles() }));
}
