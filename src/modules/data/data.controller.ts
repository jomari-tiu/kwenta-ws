import type { Request, Response } from 'express';
import { bodyOf, queryOf } from '../../common/validate.js';
import * as service from './data.service.js';
import type { TImportPayload, TImportQuery } from './data.schema.js';

export async function getExport(_req: Request, res: Response): Promise<void> {
  const file = await service.exportAll();
  const stamp = file.exportedAt.slice(0, 10);
  // Content-Disposition so a browser saves it rather than rendering JSON.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="kwenta-backup-${stamp}.json"`,
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(file, null, 2));
}

export async function postImport(req: Request, res: Response): Promise<void> {
  res.json(
    await service.importAll(
      bodyOf<TImportPayload>(req),
      queryOf<TImportQuery>(req),
    ),
  );
}
