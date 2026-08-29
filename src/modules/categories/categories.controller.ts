import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './categories.service.js';
import type {
  TCreateCategoryBody,
  TListCategoriesQuery,
  TUpdateCategoryBody,
} from './categories.schema.js';

export async function getCategories(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.list(queryOf<TListCategoriesQuery>(req)));
}

export async function getCategory(req: Request, res: Response): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postCategory(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.create(bodyOf<TCreateCategoryBody>(req)));
}

export async function patchCategory(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(
    await service.update(paramId(req), bodyOf<TUpdateCategoryBody>(req)),
  );
}

export async function deleteCategory(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.remove(paramId(req)));
}

export async function postRestoreCategory(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.restore(paramId(req)));
}
