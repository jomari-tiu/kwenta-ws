export type TPaginationMeta = {
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type TPaginatedResult<T> = {
  data: T[];
  meta: TPaginationMeta;
};

export type TApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
};
