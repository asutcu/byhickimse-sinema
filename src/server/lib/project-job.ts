/**
 * Ayni proje icin bolme / film plani ust uste binmesin.
 * Ikinci tiklama 9 dk daha OpenAI yakmaz; eski klipleri de yolda silmez.
 */

export class ProjectJobBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectJobBusyError";
  }
}

type JobKind = "split" | "film-plan";

interface RunningJob {
  job: JobKind;
  promise: Promise<unknown>;
}

const running = new Map<string, RunningJob>();

export async function runExclusiveProjectJob<T>(
  projectId: string,
  job: JobKind,
  fn: () => Promise<T>
): Promise<T> {
  const current = running.get(projectId);
  if (current) {
    // Ayni is tekrar: ilk istegin sonucunu paylas (cift tik / overlay yok).
    if (current.job === job) return current.promise as Promise<T>;
    // Bolme zaten film planini da yazar; bitmesini bekle, sonra plani calistir.
    if (current.job === "split" && job === "film-plan") {
      await current.promise.catch(() => undefined);
      return runExclusiveProjectJob(projectId, job, fn);
    }
    throw new ProjectJobBusyError(
      current.job === "split"
        ? "Hikaye hâlâ kliplere bölünüyor. Bitince film planı zaten yazılacak — Yenile’ye tekrar basmayın."
        : "Film planı zaten çalışıyor. Bitmesini bekleyin; ikinci tıklama işi ikiye katlar."
    );
  }

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      running.delete(projectId);
    });
  running.set(projectId, { job, promise });
  return promise as Promise<T>;
}
