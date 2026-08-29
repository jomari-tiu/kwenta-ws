import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './recurring.service.js';
import type {
  TCreateRuleBody,
  TDeleteRuleQuery,
  TListRulesQuery,
  TUpdateRuleBody,
  TUpdateRuleQuery,
} from './recurring.schema.js';

export async function getRules(req: Request, res: Response): Promise<void> {
  res.json(await service.list(queryOf<TListRulesQuery>(req)));
}

export async function getRule(req: Request, res: Response): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postRule(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.create(bodyOf<TCreateRuleBody>(req)));
}

export async function patchRule(req: Request, res: Response): Promise<void> {
  res.json(
    await service.update(
      paramId(req),
      bodyOf<TUpdateRuleBody>(req),
      queryOf<TUpdateRuleQuery>(req),
    ),
  );
}

export async function deleteRule(req: Request, res: Response): Promise<void> {
  res.json(await service.remove(paramId(req), queryOf<TDeleteRuleQuery>(req)));
}

export async function postPause(req: Request, res: Response): Promise<void> {
  res.json(await service.setActive(paramId(req), false));
}

export async function postResume(req: Request, res: Response): Promise<void> {
  res.json(await service.setActive(paramId(req), true));
}

export async function postMaterialize(
  _req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.materialize());
}
