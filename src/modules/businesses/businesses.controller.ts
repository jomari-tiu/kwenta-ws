import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './businesses.service.js';
import type {
  TCapitalBody,
  TCreateBusinessBody,
  TDrawingBody,
  TEntryBody,
  TListBusinessesQuery,
  TUpdateBusinessBody,
} from './businesses.schema.js';

export async function getBusinesses(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.list(queryOf<TListBusinessesQuery>(req)));
}

export async function getSummary(_req: Request, res: Response): Promise<void> {
  res.json(await service.summary());
}

export async function getBusiness(req: Request, res: Response): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function getEntries(req: Request, res: Response): Promise<void> {
  res.json(await service.entries(paramId(req)));
}

export async function postBusiness(req: Request, res: Response): Promise<void> {
  const created = await service.create(bodyOf<TCreateBusinessBody>(req));
  res.status(201).json(created);
}

export async function patchBusiness(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(
    await service.update(paramId(req), bodyOf<TUpdateBusinessBody>(req)),
  );
}

export async function deleteBusiness(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.remove(paramId(req)));
}

export async function postEntry(req: Request, res: Response): Promise<void> {
  const updated = await service.addEntry(paramId(req), bodyOf<TEntryBody>(req));
  res.status(201).json(updated);
}

export async function postCapital(req: Request, res: Response): Promise<void> {
  const updated = await service.addCapital(
    paramId(req),
    bodyOf<TCapitalBody>(req),
  );
  res.status(201).json(updated);
}

export async function postDrawing(req: Request, res: Response): Promise<void> {
  const updated = await service.addDrawing(
    paramId(req),
    bodyOf<TDrawingBody>(req),
  );
  res.status(201).json(updated);
}

export async function deleteEntry(req: Request, res: Response): Promise<void> {
  const { id, transactionId } = req.params as {
    id: string;
    transactionId: string;
  };
  res.json(await service.removeEntry(id, transactionId));
}
