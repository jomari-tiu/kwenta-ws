import { env } from '../../config/env.js';
import { badRequest, conflict } from '../../common/errors.js';
import * as repo from './data.repository.js';
import {
  EXPORT_FORMAT_VERSION,
  type TImportPayload,
  type TImportQuery,
} from './data.schema.js';

export type TExportFile = {
  formatVersion: number;
  exportedAt: string;
  appTimezone: string;
  counts: Record<repo.TTableKey, number>;
  data: repo.TDump;
};

export async function exportAll(): Promise<TExportFile> {
  const data = await repo.dumpAll();
  const counts = {} as Record<repo.TTableKey, number>;
  for (const { key } of repo.TABLES) counts[key] = data[key].length;

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    // An audit stamp on the file, not a value the app reads back.
    exportedAt: new Date().toISOString(),
    // Recorded so a restore into a differently-configured server is obvious:
    // every plain date in the file was written under THIS zone.
    appTimezone: env.APP_TIMEZONE,
    counts,
    data,
  };
}

export async function importAll(
  payload: TImportPayload,
  query: TImportQuery,
): Promise<{ mode: string; inserted: Record<repo.TTableKey, number> }> {
  if (payload.formatVersion !== EXPORT_FORMAT_VERSION) {
    throw badRequest(
      `This file is format version ${payload.formatVersion}, but this server reads version ${EXPORT_FORMAT_VERSION}.`,
    );
  }

  if (query.mode === 'empty' && !(await repo.isEmpty())) {
    throw conflict(
      'This database already has data. Re-send with mode=replace to overwrite it — that deletes everything currently stored.',
    );
  }

  const inserted = await repo.replaceAll(payload.data);
  return { mode: query.mode, inserted };
}
